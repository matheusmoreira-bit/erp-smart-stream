
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagcorp_integration_log TO authenticated;
GRANT ALL ON public.pagcorp_integration_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
GRANT EXECUTE ON FUNCTION public.insert_audit_log(text, text, text, text, text, jsonb) TO authenticated, service_role;
