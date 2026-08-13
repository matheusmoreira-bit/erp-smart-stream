CREATE TABLE public.erp_session_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  company_db text NOT NULL,
  sap_user text NOT NULL,
  session_id text NOT NULL,
  route_id text NOT NULL DEFAULT '',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_db)
);

GRANT ALL ON public.erp_session_cache TO service_role;

ALTER TABLE public.erp_session_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "erp_session_cache service only"
  ON public.erp_session_cache
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_erp_session_cache_expires ON public.erp_session_cache (expires_at);

CREATE TRIGGER update_erp_session_cache_updated_at
  BEFORE UPDATE ON public.erp_session_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();