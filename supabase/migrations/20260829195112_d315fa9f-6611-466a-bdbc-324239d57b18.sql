REVOKE EXECUTE ON FUNCTION public.is_email_allowed_for_company(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_email_allowed_for_omie_company(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_email_allowed_for_company(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_email_allowed_for_omie_company(text, text) TO authenticated, service_role;