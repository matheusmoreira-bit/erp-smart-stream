CREATE TABLE IF NOT EXISTS public.auth_caller_cache (
  cache_key text PRIMARY KEY,
  payload jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.auth_caller_cache TO service_role;
ALTER TABLE public.auth_caller_cache ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS auth_caller_cache_expires_idx ON public.auth_caller_cache (expires_at);