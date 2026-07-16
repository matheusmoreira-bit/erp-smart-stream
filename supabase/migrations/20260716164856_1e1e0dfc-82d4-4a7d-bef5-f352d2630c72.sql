
-- =========================================================
-- Integração JumpCloud -> SAP EmployeesInfo (fase 1: bases TST%)
-- =========================================================

-- Helper function: base SAP permitida nesta fase
CREATE OR REPLACE FUNCTION public.is_employee_sync_company_allowed(_company_db text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _company_db IS NOT NULL AND upper(_company_db) LIKE 'TST%';
$$;

-- Helper: usuário pode gerenciar integração?
CREATE OR REPLACE FUNCTION public.can_manage_employee_integration(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(_user_id, 'admin')
      OR EXISTS (
        SELECT 1
        FROM public.user_group_assignments uga
        JOIN auth.users u ON lower(u.email) = lower(uga.sap_email)
        JOIN public.permission_group_modules pgm ON pgm.group_id = uga.group_id
        WHERE u.id = _user_id
          AND pgm.module_key IN (
            'employee_integration.view',
            'employee_integration.manage',
            'employee_integration.execute',
            'employee_integration.view_logs'
          )
          AND COALESCE(pgm.can_view, true) = true
      );
$$;

-- =========================================================
-- Tabela: employee_integration_config
-- =========================================================
CREATE TABLE public.employee_integration_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  company_db text NOT NULL,
  jumpcloud_organization_id text,
  schedule_type text NOT NULL DEFAULT 'manual'
    CHECK (schedule_type IN ('manual', 'hourly', 'every_6h', 'every_12h', 'daily')),
  preferred_hour smallint CHECK (preferred_hour IS NULL OR (preferred_hour BETWEEN 0 AND 23)),
  is_active boolean NOT NULL DEFAULT false,
  sync_inactive_users boolean NOT NULL DEFAULT true,
  sync_managers boolean NOT NULL DEFAULT true,
  default_department_code text,
  default_branch_code text,
  last_execution_at timestamptz,
  last_execution_status text,
  last_execution_message text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_integration_config_company_db_only_tst
    CHECK (public.is_employee_sync_company_allowed(company_db)),
  CONSTRAINT employee_integration_config_unique_company UNIQUE (company_db)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_integration_config TO authenticated;
GRANT ALL ON public.employee_integration_config TO service_role;

ALTER TABLE public.employee_integration_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_config_manage"
  ON public.employee_integration_config
  FOR ALL TO authenticated
  USING (public.can_manage_employee_integration(auth.uid()))
  WITH CHECK (public.can_manage_employee_integration(auth.uid()));

CREATE TRIGGER trg_employee_integration_config_updated
  BEFORE UPDATE ON public.employee_integration_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Tabela: employee_sync_execution
-- =========================================================
CREATE TABLE public.employee_sync_execution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_config_id uuid NOT NULL REFERENCES public.employee_integration_config(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  execution_type text NOT NULL CHECK (execution_type IN ('manual', 'scheduled', 'simulate')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'error', 'cancelled')),
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  triggered_by_email text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms bigint,
  total_source integer NOT NULL DEFAULT 0,
  total_matched integer NOT NULL DEFAULT 0,
  total_created integer NOT NULL DEFAULT 0,
  total_updated integer NOT NULL DEFAULT 0,
  total_unchanged integer NOT NULL DEFAULT 0,
  total_inactivated integer NOT NULL DEFAULT 0,
  total_pending integer NOT NULL DEFAULT 0,
  total_errors integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_sync_execution_company_only_tst
    CHECK (public.is_employee_sync_company_allowed(company_db))
);

CREATE INDEX idx_employee_sync_execution_config ON public.employee_sync_execution (integration_config_id, started_at DESC);
CREATE INDEX idx_employee_sync_execution_company ON public.employee_sync_execution (company_db, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_sync_execution TO authenticated;
GRANT ALL ON public.employee_sync_execution TO service_role;

ALTER TABLE public.employee_sync_execution ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_exec_manage"
  ON public.employee_sync_execution
  FOR ALL TO authenticated
  USING (public.can_manage_employee_integration(auth.uid()))
  WITH CHECK (public.can_manage_employee_integration(auth.uid()));

CREATE TRIGGER trg_employee_sync_execution_updated
  BEFORE UPDATE ON public.employee_sync_execution
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Tabela: employee_sync_item
-- =========================================================
CREATE TABLE public.employee_sync_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id uuid NOT NULL REFERENCES public.employee_sync_execution(id) ON DELETE CASCADE,
  integration_config_id uuid NOT NULL REFERENCES public.employee_integration_config(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  jumpcloud_user_id text,
  sap_employee_id integer,
  employee_name text,
  employee_email text,
  department_source text,
  department_target text,
  manager_jc_id text,
  result text NOT NULL CHECK (result IN (
    'created', 'updated', 'unchanged', 'inactivated', 'pending', 'error',
    'would_create', 'would_update', 'would_inactivate', 'would_skip'
  )),
  message text,
  error_code text,
  changed_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_payload jsonb,
  normalized_payload jsonb,
  sap_payload jsonb,
  hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_employee_sync_item_execution ON public.employee_sync_item (execution_id);
CREATE INDEX idx_employee_sync_item_jc ON public.employee_sync_item (integration_config_id, jumpcloud_user_id);
CREATE INDEX idx_employee_sync_item_result ON public.employee_sync_item (execution_id, result);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_sync_item TO authenticated;
GRANT ALL ON public.employee_sync_item TO service_role;

ALTER TABLE public.employee_sync_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_item_manage"
  ON public.employee_sync_item
  FOR ALL TO authenticated
  USING (public.can_manage_employee_integration(auth.uid()))
  WITH CHECK (public.can_manage_employee_integration(auth.uid()));

-- =========================================================
-- Tabela: employee_department_mapping
-- =========================================================
CREATE TABLE public.employee_department_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_config_id uuid NOT NULL REFERENCES public.employee_integration_config(id) ON DELETE CASCADE,
  jumpcloud_department text NOT NULL,
  sap_department_code text,
  sap_department_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_department_mapping_unique
    UNIQUE (integration_config_id, jumpcloud_department)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_department_mapping TO authenticated;
GRANT ALL ON public.employee_department_mapping TO service_role;

ALTER TABLE public.employee_department_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_dept_map_manage"
  ON public.employee_department_mapping
  FOR ALL TO authenticated
  USING (public.can_manage_employee_integration(auth.uid()))
  WITH CHECK (public.can_manage_employee_integration(auth.uid()));

CREATE TRIGGER trg_employee_department_mapping_updated
  BEFORE UPDATE ON public.employee_department_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Tabela: employee_pending_relation
-- =========================================================
CREATE TABLE public.employee_pending_relation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_config_id uuid NOT NULL REFERENCES public.employee_integration_config(id) ON DELETE CASCADE,
  employee_jc_id text NOT NULL,
  manager_jc_id text NOT NULL,
  resolved_at timestamptz,
  last_attempt_at timestamptz,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_pending_relation_unique
    UNIQUE (integration_config_id, employee_jc_id)
);

CREATE INDEX idx_employee_pending_relation_open
  ON public.employee_pending_relation (integration_config_id) WHERE resolved_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_pending_relation TO authenticated;
GRANT ALL ON public.employee_pending_relation TO service_role;

ALTER TABLE public.employee_pending_relation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "employee_pending_manage"
  ON public.employee_pending_relation
  FOR ALL TO authenticated
  USING (public.can_manage_employee_integration(auth.uid()))
  WITH CHECK (public.can_manage_employee_integration(auth.uid()));

CREATE TRIGGER trg_employee_pending_relation_updated
  BEFORE UPDATE ON public.employee_pending_relation
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Cron: tick a cada 15 minutos
-- =========================================================
DO $$
DECLARE
  v_key_exists boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key')
    INTO v_key_exists;
  IF NOT v_key_exists THEN
    RAISE NOTICE 'Vault secret email_queue_service_role_key ausente; cron não será agendado agora.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'employees-sync-tick') THEN
    PERFORM cron.schedule(
      'employees-sync-tick',
      '*/15 * * * *',
      $cron$
      SELECT net.http_post(
        url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/employees-sync-cron',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
          )
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  END IF;
END $$;
