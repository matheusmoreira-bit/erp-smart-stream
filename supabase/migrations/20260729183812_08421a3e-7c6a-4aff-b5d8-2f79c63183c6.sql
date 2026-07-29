REVOKE EXECUTE ON FUNCTION public.can_manage_nfse_recipients() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.can_manage_nfse_recipients() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.nfse_recipients_max_brands() FROM anon, public;