
-- 1) Tokens anti-CSRF de uso único (defesa em profundidade na troca de senha)
CREATE TABLE IF NOT EXISTS public.security_csrf_tokens (
  token_hash text PRIMARY KEY,
  purpose text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

GRANT ALL ON public.security_csrf_tokens TO service_role;
ALTER TABLE public.security_csrf_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "csrf tokens are backend only"
  ON public.security_csrf_tokens FOR ALL
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS security_csrf_tokens_expires_idx
  ON public.security_csrf_tokens (expires_at);

-- Consumo atômico: só sucede uma vez, dentro da validade e para o mesmo sujeito.
CREATE OR REPLACE FUNCTION public.consume_csrf_token(_token_hash text, _purpose text, _subject text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ok boolean := false;
BEGIN
  UPDATE public.security_csrf_tokens
     SET used_at = now()
   WHERE token_hash = _token_hash
     AND purpose = _purpose
     AND lower(subject) = lower(_subject)
     AND used_at IS NULL
     AND expires_at > now()
  RETURNING true INTO _ok;

  DELETE FROM public.security_csrf_tokens WHERE expires_at < now() - interval '1 day';
  RETURN COALESCE(_ok, false);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_csrf_token(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_csrf_token(text, text, text) TO service_role;

-- 2) Revogação de sessões ERP (sessões SAP ficam inválidas após troca de senha)
CREATE TABLE IF NOT EXISTS public.erp_session_revocations (
  sid_hash text PRIMARY KEY,
  user_key text NOT NULL,
  company_db text,
  reason text,
  revoked_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.erp_session_revocations TO service_role;
ALTER TABLE public.erp_session_revocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "session revocations are backend only"
  ON public.erp_session_revocations FOR ALL
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS erp_session_revocations_user_idx
  ON public.erp_session_revocations (user_key, revoked_at DESC);

CREATE OR REPLACE FUNCTION public.is_erp_session_revoked(_sid_hash text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.erp_session_revocations
     WHERE sid_hash = _sid_hash
       AND revoked_at > now() - interval '2 days'
  );
$$;

REVOKE ALL ON FUNCTION public.is_erp_session_revoked(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_erp_session_revoked(text) TO service_role;
