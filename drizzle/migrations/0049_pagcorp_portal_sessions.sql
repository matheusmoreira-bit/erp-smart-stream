CREATE TABLE public.pagcorp_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  owner_key text NOT NULL,
  portal_user text,
  cookie_enc text NOT NULL,
  csrf_token_enc text NOT NULL,
  xsrf_token_enc text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, owner_key)
);

-- Tabela sensível: contém material de sessão do portal PagCorp.
-- Nenhum acesso direto pelo cliente; somente edge functions (service_role).
GRANT ALL ON public.pagcorp_portal_sessions TO service_role;
ALTER TABLE public.pagcorp_portal_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_manages_pagcorp_portal_sessions"
ON public.pagcorp_portal_sessions
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TRIGGER pagcorp_portal_sessions_updated_at
BEFORE UPDATE ON public.pagcorp_portal_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();