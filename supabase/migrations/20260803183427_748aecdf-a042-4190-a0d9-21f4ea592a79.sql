ALTER TABLE public.idp_user_mapping
  ADD COLUMN IF NOT EXISTS deprovisioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS deprovision_reason text;

CREATE TABLE public.idp_deprovision_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text,
  idp_provider text,
  idp_user_id text,
  sap_user_code text,
  email text,
  user_key text,
  reason text NOT NULL,
  source text NOT NULL DEFAULT 'idp_sync',
  sap_locked boolean NOT NULL DEFAULT false,
  groups_revoked integer NOT NULL DEFAULT 0,
  substitutions_revoked integer NOT NULL DEFAULT 0,
  credentials_revoked integer NOT NULL DEFAULT 0,
  push_devices_revoked integer NOT NULL DEFAULT 0,
  cost_centers_revoked integer NOT NULL DEFAULT 0,
  approval_rules_orphaned integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_idp_deprovision_log_created ON public.idp_deprovision_log (created_at DESC);
CREATE INDEX idx_idp_deprovision_log_user ON public.idp_deprovision_log (user_key);

GRANT SELECT ON public.idp_deprovision_log TO authenticated;
GRANT ALL ON public.idp_deprovision_log TO service_role;

ALTER TABLE public.idp_deprovision_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view deprovision log"
ON public.idp_deprovision_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.is_erp_user_deprovisioned(_user_key text, _company_db text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.idp_user_mapping m
     WHERE m.deprovisioned_at IS NOT NULL
       AND public.canonical_user_key(coalesce(m.sap_user_code, m.sap_email)) IS NOT DISTINCT FROM public.canonical_user_key(_user_key)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_erp_user_deprovisioned(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_erp_user_deprovisioned(text, text) TO authenticated, service_role;