
-- =========================================================================
-- FASE 1 — Fundação do novo modelo de permissões
-- Idempotente e não-quebrante: enquanto sap_group_mapping estiver vazio,
-- has_module_action retorna o comportamento atual (permite o que ver hoje).
-- =========================================================================

-- 1) Novas colunas de AÇÃO em permission_group_modules ---------------------
ALTER TABLE public.permission_group_modules
  ADD COLUMN IF NOT EXISTS can_approve   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_integrate boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_export    boolean NOT NULL DEFAULT true;

-- 2) feature_flags ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  scope       text NOT NULL DEFAULT 'global',   -- 'global' | 'company'
  company_db  text,                              -- null = global
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

GRANT SELECT ON public.feature_flags TO authenticated;
GRANT ALL ON public.feature_flags TO service_role;

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feature_flags read authenticated" ON public.feature_flags;
CREATE POLICY "feature_flags read authenticated"
  ON public.feature_flags FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "feature_flags admin write" ON public.feature_flags;
CREATE POLICY "feature_flags admin write"
  ON public.feature_flags FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.feature_flags (key, enabled, description)
VALUES ('permissions_v2_enforced', false,
        'Quando ligado, has_module_action bloqueia ações não permitidas em vez de apenas registrar.')
ON CONFLICT (key) DO NOTHING;

-- 3) sap_groups_cache (grupos SAP conhecidos por empresa) -----------------
CREATE TABLE IF NOT EXISTS public.sap_groups_cache (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db     text NOT NULL,
  sap_group_code text NOT NULL,
  sap_group_name text,
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, sap_group_code)
);
CREATE INDEX IF NOT EXISTS idx_sap_groups_cache_company ON public.sap_groups_cache(company_db);

GRANT SELECT ON public.sap_groups_cache TO authenticated;
GRANT ALL ON public.sap_groups_cache TO service_role;

ALTER TABLE public.sap_groups_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sap_groups_cache read authenticated" ON public.sap_groups_cache;
CREATE POLICY "sap_groups_cache read authenticated"
  ON public.sap_groups_cache FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sap_groups_cache admin write" ON public.sap_groups_cache;
CREATE POLICY "sap_groups_cache admin write"
  ON public.sap_groups_cache FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) sap_group_mapping (SAP group ↔ módulo × ação, por empresa) -----------
CREATE TABLE IF NOT EXISTS public.sap_group_mapping (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db     text NOT NULL,
  sap_group_code text NOT NULL,
  sap_group_name text,
  module_key     text NOT NULL,
  can_view       boolean NOT NULL DEFAULT true,
  can_create     boolean NOT NULL DEFAULT false,
  can_edit       boolean NOT NULL DEFAULT false,
  can_delete     boolean NOT NULL DEFAULT false,
  can_approve    boolean NOT NULL DEFAULT false,
  can_integrate  boolean NOT NULL DEFAULT false,
  can_export     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  UNIQUE (company_db, sap_group_code, module_key)
);
CREATE INDEX IF NOT EXISTS idx_sap_group_mapping_company_module
  ON public.sap_group_mapping(company_db, module_key);

GRANT SELECT ON public.sap_group_mapping TO authenticated;
GRANT ALL ON public.sap_group_mapping TO service_role;

ALTER TABLE public.sap_group_mapping ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sap_group_mapping read authenticated" ON public.sap_group_mapping;
CREATE POLICY "sap_group_mapping read authenticated"
  ON public.sap_group_mapping FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sap_group_mapping admin write" ON public.sap_group_mapping;
CREATE POLICY "sap_group_mapping admin write"
  ON public.sap_group_mapping FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5) Triggers de updated_at ------------------------------------------------
DROP TRIGGER IF EXISTS trg_feature_flags_updated_at ON public.feature_flags;
CREATE TRIGGER trg_feature_flags_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sap_groups_cache_updated_at ON public.sap_groups_cache;
CREATE TRIGGER trg_sap_groups_cache_updated_at
  BEFORE UPDATE ON public.sap_groups_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_sap_group_mapping_updated_at ON public.sap_group_mapping;
CREATE TRIGGER trg_sap_group_mapping_updated_at
  BEFORE UPDATE ON public.sap_group_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6) has_module_action -----------------------------------------------------
-- Retorna TRUE quando:
--   a) usuário é admin de backoffice, OU
--   b) empresa é OMIE (bypass documentado), OU
--   c) grupo global do ERP Flow do usuário permite (module, action)
--      E (mapeamento SAP para a empresa está vazio  -- shadow mode
--         OU algum grupo SAP do usuário na empresa permite (module, action))
--
-- Enquanto sap_group_mapping estiver vazio para a empresa, o resultado é
-- idêntico ao motor atual (só olha permission_group_modules).
CREATE OR REPLACE FUNCTION public.has_module_action(
  _user_id    uuid,
  _company_db text,
  _module     text,
  _action     text
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email        text;
  v_local        text;
  v_erp_ok       boolean := false;
  v_sap_has_map  boolean := false;
  v_sap_ok       boolean := false;
  v_company_type text;
BEGIN
  IF _user_id IS NULL OR _module IS NULL OR _action IS NULL THEN
    RETURN false;
  END IF;

  -- (a) admin de backoffice sempre pode
  IF public.has_role(_user_id, 'admin') THEN
    RETURN true;
  END IF;

  -- (b) OMIE: módulos abertos (regra de negócio já existente)
  IF _company_db IS NOT NULL THEN
    SELECT lower(coalesce(erp_type, '')) INTO v_company_type
    FROM public.companies WHERE company_db = _company_db LIMIT 1;
    IF v_company_type = 'omie' THEN
      RETURN true;
    END IF;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = _user_id LIMIT 1;
  IF v_email IS NULL THEN
    RETURN false;
  END IF;
  v_local := split_part(v_email, '@', 1);

  -- (c1) grupo global do ERP Flow permite a ação?
  SELECT EXISTS (
    SELECT 1
    FROM public.user_group_assignments uga
    JOIN public.permission_group_modules pgm ON pgm.group_id = uga.group_id
    WHERE lower(uga.sap_email) IN (lower(v_email), lower(v_local))
      AND pgm.module_key = _module
      AND CASE _action
            WHEN 'view'      THEN coalesce(pgm.can_view, true)
            WHEN 'create'    THEN coalesce(pgm.can_create, false)
            WHEN 'edit'      THEN coalesce(pgm.can_edit, false)
            WHEN 'delete'    THEN coalesce(pgm.can_delete, false)
            WHEN 'approve'   THEN coalesce(pgm.can_approve, false)
            WHEN 'integrate' THEN coalesce(pgm.can_integrate, false)
            WHEN 'export'    THEN coalesce(pgm.can_export, false)
            ELSE false
          END
  ) INTO v_erp_ok;

  IF NOT v_erp_ok THEN
    RETURN false;
  END IF;

  -- (c2) mapeamento SAP existe para esta empresa+módulo?
  IF _company_db IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.sap_group_mapping
      WHERE company_db = _company_db AND module_key = _module
    ) INTO v_sap_has_map;
  END IF;

  IF NOT v_sap_has_map THEN
    -- Shadow / transição: se ainda não mapearam SAP para este módulo/empresa,
    -- o grupo do ERP Flow é suficiente. Não bloqueia nada.
    RETURN true;
  END IF;

  -- (c3) algum grupo SAP do usuário na empresa concede a ação?
  SELECT EXISTS (
    SELECT 1
    FROM public.sap_cache sc
    JOIN public.sap_group_mapping m
      ON m.company_db = _company_db
     AND m.module_key = _module
    WHERE sc.company_db = _company_db
      AND (lower(sc.data ->> 'eMail') = lower(v_email)
           OR lower(sc.data ->> 'UserCode') = lower(v_local))
      AND m.sap_group_code = ANY (
        SELECT jsonb_array_elements_text(coalesce(sc.data -> 'Groups', '[]'::jsonb))
      )
      AND CASE _action
            WHEN 'view'      THEN m.can_view
            WHEN 'create'    THEN m.can_create
            WHEN 'edit'      THEN m.can_edit
            WHEN 'delete'    THEN m.can_delete
            WHEN 'approve'   THEN m.can_approve
            WHEN 'integrate' THEN m.can_integrate
            WHEN 'export'    THEN m.can_export
            ELSE false
          END
  ) INTO v_sap_ok;

  RETURN v_sap_ok;
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_module_action(uuid, text, text, text) TO authenticated, service_role;

-- 7) Habilita auditoria nas novas tabelas ---------------------------------
SELECT public.enable_audit_on('feature_flags');
SELECT public.enable_audit_on('sap_group_mapping');
SELECT public.enable_audit_on('sap_groups_cache');
