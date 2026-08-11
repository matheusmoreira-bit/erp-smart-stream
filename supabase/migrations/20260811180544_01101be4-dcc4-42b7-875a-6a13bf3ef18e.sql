CREATE TABLE public.api_keys (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  service TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  is_legacy BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  use_count BIGINT NOT NULL DEFAULT 0,
  revoked_at TIMESTAMPTZ,
  revoked_by TEXT,
  revoke_reason TEXT
);

GRANT ALL ON public.api_keys TO service_role;

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "api_keys service role only select" ON public.api_keys FOR SELECT TO service_role USING (true);
CREATE POLICY "api_keys service role only insert" ON public.api_keys FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "api_keys service role only update" ON public.api_keys FOR UPDATE TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "api_keys service role only delete" ON public.api_keys FOR DELETE TO service_role USING (true);

CREATE INDEX idx_api_keys_service ON public.api_keys (service);
CREATE INDEX idx_api_keys_hash ON public.api_keys (key_hash);

CREATE TRIGGER update_api_keys_updated_at
BEFORE UPDATE ON public.api_keys
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();