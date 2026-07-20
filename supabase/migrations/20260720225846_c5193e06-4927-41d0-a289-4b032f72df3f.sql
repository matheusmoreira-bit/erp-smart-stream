
-- 1) Shadow log
CREATE TABLE IF NOT EXISTS public.permission_shadow_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id UUID,
  actor_identifier TEXT,
  company_db TEXT,
  module_key TEXT NOT NULL,
  action TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('allow','deny')),
  mode TEXT NOT NULL CHECK (mode IN ('shadow','enforce')),
  reason TEXT,
  context JSONB
);

GRANT SELECT ON public.permission_shadow_log TO authenticated;
GRANT ALL ON public.permission_shadow_log TO service_role;

ALTER TABLE public.permission_shadow_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read shadow log" ON public.permission_shadow_log;
CREATE POLICY "admins read shadow log"
  ON public.permission_shadow_log FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_shadow_log_ts ON public.permission_shadow_log (ts DESC);
CREATE INDEX IF NOT EXISTS idx_shadow_log_company_module ON public.permission_shadow_log (company_db, module_key, action);
CREATE INDEX IF NOT EXISTS idx_shadow_log_actor ON public.permission_shadow_log (actor_identifier);

-- 2) Enforcement scope por empresa
CREATE TABLE IF NOT EXISTS public.permissions_enforcement_scope (
  company_db TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT ON public.permissions_enforcement_scope TO authenticated;
GRANT ALL ON public.permissions_enforcement_scope TO service_role;

ALTER TABLE public.permissions_enforcement_scope ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage enforcement scope" ON public.permissions_enforcement_scope;
CREATE POLICY "admins manage enforcement scope"
  ON public.permissions_enforcement_scope FOR ALL
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "authenticated read enforcement scope" ON public.permissions_enforcement_scope;
CREATE POLICY "authenticated read enforcement scope"
  ON public.permissions_enforcement_scope FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 3) Feature flags globais (upsert por key)
INSERT INTO public.feature_flags (key, scope, enabled)
VALUES ('permissions_v2', 'global', false)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.feature_flags (key, scope, enabled)
VALUES ('permissions_v2_kill', 'global', false)
ON CONFLICT (key) DO NOTHING;

-- 4) Modo de operação
CREATE OR REPLACE FUNCTION public.permissions_enforcement_mode(_company_db TEXT DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kill boolean;
  v_enforced boolean;
  v_v2 boolean;
BEGIN
  SELECT enabled INTO v_kill FROM public.feature_flags WHERE key='permissions_v2_kill';
  IF COALESCE(v_kill,false) THEN
    RETURN 'off';
  END IF;

  IF _company_db IS NOT NULL THEN
    SELECT enabled INTO v_enforced
      FROM public.permissions_enforcement_scope
     WHERE company_db = _company_db;
    IF COALESCE(v_enforced,false) THEN
      RETURN 'enforce';
    END IF;
  END IF;

  SELECT enabled INTO v_v2 FROM public.feature_flags WHERE key='permissions_v2';
  IF COALESCE(v_v2,false) THEN
    RETURN 'shadow';
  END IF;

  RETURN 'shadow';
END;
$$;

-- 5) Log de negativas
CREATE OR REPLACE FUNCTION public.log_permission_shadow(
  _company_db TEXT,
  _module TEXT,
  _action TEXT,
  _decision TEXT,
  _mode TEXT,
  _reason TEXT DEFAULT NULL,
  _identifier TEXT DEFAULT NULL,
  _context JSONB DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _decision NOT IN ('allow','deny') THEN
    RAISE EXCEPTION 'invalid decision %', _decision;
  END IF;
  IF _mode NOT IN ('shadow','enforce') THEN
    RAISE EXCEPTION 'invalid mode %', _mode;
  END IF;
  IF _decision = 'deny' THEN
    INSERT INTO public.permission_shadow_log
      (actor_id, actor_identifier, company_db, module_key, action, decision, mode, reason, context)
    VALUES
      (auth.uid(),
       COALESCE(_identifier, (auth.jwt() ->> 'email')),
       _company_db, _module, _action, _decision, _mode, _reason,
       COALESCE(_context,'{}'::jsonb));
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.log_permission_shadow(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_permission_shadow(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.permissions_enforcement_mode(TEXT) TO authenticated;
