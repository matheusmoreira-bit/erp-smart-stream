-- Funções chamadas apenas por edge functions (service_role): deixam de ser
-- executáveis por usuários logados / anônimos.
REVOKE EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_csrf_token(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_notification_event(text, text, text, text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_integration_health_snapshot(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sap_user_has_module(text, text) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.is_erp_session_revoked(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_erp_user_deprovisioned(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_nfse_recipients() FROM anon;

GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_csrf_token(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_event(text, text, text, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_integration_health_snapshot(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.sap_user_has_module(text, text) TO service_role;