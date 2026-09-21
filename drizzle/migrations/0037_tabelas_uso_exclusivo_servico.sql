-- Tabelas de uso exclusivo do serviço: acesso declarado explicitamente.
ALTER TABLE public.expense_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_caller_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.expense_audit_log FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.auth_caller_cache FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.edge_rate_limits FROM PUBLIC, anon, authenticated;

GRANT ALL ON public.expense_audit_log TO service_role;
GRANT ALL ON public.auth_caller_cache TO service_role;
GRANT ALL ON public.edge_rate_limits TO service_role;

COMMENT ON TABLE public.expense_audit_log IS 'Uso exclusivo do serviço (edge functions). Sem acesso via API pública: nenhuma política e nenhum GRANT para anon/authenticated.';
COMMENT ON TABLE public.auth_caller_cache IS 'Uso exclusivo do serviço (cache interno de autenticação). Sem acesso via API pública.';
COMMENT ON TABLE public.edge_rate_limits IS 'Uso exclusivo do serviço (limite de requisições). Sem acesso via API pública.';