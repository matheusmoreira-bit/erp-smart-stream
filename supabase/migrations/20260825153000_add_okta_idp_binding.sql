-- Okta mappings are active IdP bindings under the same enforcement policy as JumpCloud.
CREATE OR REPLACE FUNCTION public.is_sap_code_idp_linked(_sap_user_code text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.idp_user_mapping m
    WHERE lower(coalesce(m.sap_user_code, '')) = lower(coalesce(_sap_user_code, ''))
      AND (
        (m.idp_provider IN ('jumpcloud', 'okta') AND m.status = 'linked')
        OR m.idp_provider IN ('google', 'local')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_sap_code_idp_linked(text) TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.is_idp_linked(_email text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.idp_user_mapping m
    WHERE lower(coalesce(m.idp_email, '')) = lower(coalesce(_email, ''))
      AND (
        (m.idp_provider IN ('jumpcloud', 'okta') AND m.status = 'linked')
        OR m.idp_provider = 'google'
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_idp_linked(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_idp_linked(text) TO anon, authenticated, service_role;

UPDATE public.feature_flags
SET description = 'Quando ligado, bloqueia login de usuarios sem vinculo ativo em idp_user_mapping (JumpCloud, Okta ou Google). Admins de backoffice sempre passam.'
WHERE key = 'require_idp_binding';
