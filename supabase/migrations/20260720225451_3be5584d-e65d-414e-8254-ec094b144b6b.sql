
-- Adiciona verificação de vínculo IdP por sap_user_code (usado no login SAP local)
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
        (m.idp_provider = 'jumpcloud' AND m.status = 'linked')
        OR m.idp_provider IN ('google', 'local')
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_sap_code_idp_linked(text) TO authenticated, anon, service_role;
