REVOKE ALL ON FUNCTION public.current_auth_email() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_registration_agent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_auth_email() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_registration_agent() TO authenticated;