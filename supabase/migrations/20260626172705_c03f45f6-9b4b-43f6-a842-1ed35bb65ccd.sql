
CREATE TABLE public.external_api_allowlist (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  user_code TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  last_failure_reason TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, user_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_api_allowlist TO authenticated;
GRANT ALL ON public.external_api_allowlist TO service_role;

ALTER TABLE public.external_api_allowlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage external api allowlist"
ON public.external_api_allowlist
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_external_api_allowlist_updated_at
BEFORE UPDATE ON public.external_api_allowlist
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_external_api_allowlist_lookup
ON public.external_api_allowlist (company_db, user_code);

-- RPCs for the edge function (uses service_role, but expose helpers for atomic counter)
CREATE OR REPLACE FUNCTION public.check_external_api_access(_company_db TEXT, _user_code TEXT)
RETURNS TABLE(allowed BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.external_api_allowlist%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.external_api_allowlist
  WHERE company_db = _company_db AND lower(user_code) = lower(_user_code)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'usuário não está na allowlist da API externa';
    RETURN;
  END IF;

  IF NOT v_row.enabled THEN
    RETURN QUERY SELECT false, 'usuário desabilitado para a API externa';
    RETURN;
  END IF;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN QUERY SELECT false, 'usuário temporariamente bloqueado por excesso de falhas (circuit breaker)';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_external_api_failure(_company_db TEXT, _user_code TEXT, _reason TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count INTEGER;
BEGIN
  UPDATE public.external_api_allowlist
  SET failed_attempts = failed_attempts + 1,
      last_failure_at = now(),
      last_failure_reason = left(coalesce(_reason, ''), 500),
      locked_until = CASE WHEN failed_attempts + 1 >= 3 THEN now() + interval '15 minutes' ELSE locked_until END,
      updated_at = now()
  WHERE company_db = _company_db AND lower(user_code) = lower(_user_code)
  RETURNING failed_attempts INTO v_new_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_external_api_success(_company_db TEXT, _user_code TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.external_api_allowlist
  SET failed_attempts = 0,
      locked_until = NULL,
      last_failure_reason = NULL,
      updated_at = now()
  WHERE company_db = _company_db AND lower(user_code) = lower(_user_code);
END;
$$;
