
-- ============================================================
-- FASE 1 — Console de Auditoria (Silent Specter) — Fundação
-- ============================================================

-- Enums
DO $$ BEGIN
  CREATE TYPE public.audit_console_severity AS ENUM ('low','medium','high','critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.audit_console_run_status AS ENUM ('pending','running','completed','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.audit_console_divergence_type AS ENUM (
    'missing_order','missing_grpo','missing_ap','value_mismatch','vendor_mismatch',
    'payment_terms_mismatch','document_mismatch','date_anomaly','duplicate_suspected',
    'fraud_flag','missing_request','missing_quotation','missing_approval',
    'missing_invoice','missing_payment'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- Helper: a user has access to a company_db if admin OR
-- there is a user_group_assignment for that company_db (or null).
-- We piggyback on existing is_sap_user_admin / has_role.
-- For simplicity, regular authenticated reads are allowed when:
--   has_role(auth.uid(),'admin') OR EXISTS assignment for company_db
-- Writes are reserved to service_role (the audit engine).
-- ------------------------------------------------------------

-- Reusable function: can current auth user see audit console rows for company_db?
CREATE OR REPLACE FUNCTION public.can_access_audit_console(_company_db text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.user_group_assignments uga
      JOIN auth.users u ON lower(u.email) = lower(uga.sap_email)
      WHERE u.id = auth.uid()
        AND (uga.company_db = _company_db OR uga.company_db IS NULL)
    );
$$;

-- ============================================================
-- 1. audit_console_runs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_console_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  status public.audit_console_run_status NOT NULL DEFAULT 'pending',
  scope text,
  date_from date,
  date_to date,
  current_step text,
  progress_pct numeric NOT NULL DEFAULT 0,
  total_docs_analyzed integer NOT NULL DEFAULT 0,
  total_divergences integer NOT NULL DEFAULT 0,
  total_fraud_flags integer NOT NULL DEFAULT 0,
  fetch_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  triggered_by text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_runs TO authenticated;
GRANT ALL ON public.audit_console_runs TO service_role;
ALTER TABLE public.audit_console_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_runs_read" ON public.audit_console_runs FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "audit_runs_admin_write" ON public.audit_console_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_audit_runs_company ON public.audit_console_runs(company_db);
CREATE INDEX IF NOT EXISTS idx_audit_runs_started ON public.audit_console_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_runs_status ON public.audit_console_runs(status);

-- ============================================================
-- 2. audit_console_divergences
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_console_divergences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id uuid REFERENCES public.audit_console_runs(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  divergence_type public.audit_console_divergence_type NOT NULL,
  severity public.audit_console_severity NOT NULL DEFAULT 'medium',
  description text NOT NULL,
  expected_value numeric,
  actual_value numeric,
  delta_value numeric,
  is_fraud_flag boolean NOT NULL DEFAULT false,
  is_reviewed boolean NOT NULL DEFAULT false,
  reviewer_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  card_code text,
  source_table text,
  source_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_divergences TO authenticated;
GRANT ALL ON public.audit_console_divergences TO service_role;
ALTER TABLE public.audit_console_divergences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_divs_read" ON public.audit_console_divergences FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "audit_divs_review" ON public.audit_console_divergences FOR UPDATE TO authenticated
  USING (public.can_access_audit_console(company_db))
  WITH CHECK (public.can_access_audit_console(company_db));
CREATE POLICY "audit_divs_admin_all" ON public.audit_console_divergences FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_audit_divs_run ON public.audit_console_divergences(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_divs_company ON public.audit_console_divergences(company_db);
CREATE INDEX IF NOT EXISTS idx_audit_divs_severity ON public.audit_console_divergences(severity);
CREATE INDEX IF NOT EXISTS idx_audit_divs_fraud ON public.audit_console_divergences(is_fraud_flag) WHERE is_fraud_flag = true;
CREATE INDEX IF NOT EXISTS idx_audit_divs_open ON public.audit_console_divergences(is_reviewed) WHERE is_reviewed = false;

-- ============================================================
-- 3. audit_console_rules (regras configuráveis)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_console_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text,
  name text NOT NULL,
  divergence_type public.audit_console_divergence_type NOT NULL,
  default_severity public.audit_console_severity NOT NULL DEFAULT 'medium',
  tolerance numeric,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_rules TO authenticated;
GRANT ALL ON public.audit_console_rules TO service_role;
ALTER TABLE public.audit_console_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_rules_read" ON public.audit_console_rules FOR SELECT TO authenticated
  USING (company_db IS NULL OR public.can_access_audit_console(company_db));
CREATE POLICY "audit_rules_admin" ON public.audit_console_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER trg_audit_rules_updated_at
  BEFORE UPDATE ON public.audit_console_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 4. audit_console_accounts_payable (snapshot SAP)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_console_accounts_payable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  sap_doc_entry integer NOT NULL,
  card_code text,
  doc_date date,
  due_date date,
  total_amount numeric,
  payment_terms_code text,
  linked_grpo_id text,
  linked_invoice_id text,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_db, sap_doc_entry)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_accounts_payable TO authenticated;
GRANT ALL ON public.audit_console_accounts_payable TO service_role;
ALTER TABLE public.audit_console_accounts_payable ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_ap_read" ON public.audit_console_accounts_payable FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "audit_ap_admin" ON public.audit_console_accounts_payable FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS idx_audit_ap_company ON public.audit_console_accounts_payable(company_db);
CREATE INDEX IF NOT EXISTS idx_audit_ap_card ON public.audit_console_accounts_payable(card_code);

-- ============================================================
-- 5. audit_console_approval_requests (snapshot)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_console_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  sap_request_id integer NOT NULL,
  status text,
  doc_object_type text,
  doc_entry integer,
  doc_date_sap date,
  update_date_sap date,
  originator_user_id integer,
  template_id integer,
  remarks text,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(company_db, sap_request_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_approval_requests TO authenticated;
GRANT ALL ON public.audit_console_approval_requests TO service_role;
ALTER TABLE public.audit_console_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_apprq_read" ON public.audit_console_approval_requests FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "audit_apprq_admin" ON public.audit_console_approval_requests FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 6. audit_console_approval_decisions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_console_approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_request_id uuid REFERENCES public.audit_console_approval_requests(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  step_number integer,
  status text,
  approver_user_id integer,
  decided_at timestamptz,
  remarks text,
  raw_data jsonb,
  synced_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_approval_decisions TO authenticated;
GRANT ALL ON public.audit_console_approval_decisions TO service_role;
ALTER TABLE public.audit_console_approval_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_apdec_read" ON public.audit_console_approval_decisions FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "audit_apdec_admin" ON public.audit_console_approval_decisions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 7. audit_console_insights (AI)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_console_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id uuid REFERENCES public.audit_console_runs(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  category text,
  headline text NOT NULL,
  body text,
  severity public.audit_console_severity NOT NULL DEFAULT 'medium',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_insights TO authenticated;
GRANT ALL ON public.audit_console_insights TO service_role;
ALTER TABLE public.audit_console_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_insights_read" ON public.audit_console_insights FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "audit_insights_admin" ON public.audit_console_insights FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 8. audit_console_workflow_steps / runs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_console_workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text,
  name text NOT NULL,
  step_order integer NOT NULL DEFAULT 0,
  handler text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_workflow_steps TO authenticated;
GRANT ALL ON public.audit_console_workflow_steps TO service_role;
ALTER TABLE public.audit_console_workflow_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_wfsteps_read" ON public.audit_console_workflow_steps FOR SELECT TO authenticated
  USING (company_db IS NULL OR public.can_access_audit_console(company_db));
CREATE POLICY "audit_wfsteps_admin" ON public.audit_console_workflow_steps FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_audit_wfsteps_updated_at
  BEFORE UPDATE ON public.audit_console_workflow_steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.audit_console_workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id uuid REFERENCES public.audit_console_runs(id) ON DELETE CASCADE,
  step_id uuid REFERENCES public.audit_console_workflow_steps(id) ON DELETE SET NULL,
  company_db text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  started_at timestamptz,
  finished_at timestamptz,
  output jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_console_workflow_runs TO authenticated;
GRANT ALL ON public.audit_console_workflow_runs TO service_role;
ALTER TABLE public.audit_console_workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_wfruns_read" ON public.audit_console_workflow_runs FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "audit_wfruns_admin" ON public.audit_console_workflow_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 9. audit_console_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_console_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id uuid REFERENCES public.audit_console_runs(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_console_logs TO authenticated;
GRANT ALL ON public.audit_console_logs TO service_role;
ALTER TABLE public.audit_console_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_read" ON public.audit_console_logs FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "audit_logs_admin" ON public.audit_console_logs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS idx_audit_logs_run ON public.audit_console_logs(audit_run_id, created_at DESC);
