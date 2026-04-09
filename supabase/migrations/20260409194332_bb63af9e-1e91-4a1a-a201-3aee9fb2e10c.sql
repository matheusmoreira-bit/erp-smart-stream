
CREATE TABLE public.sap_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL,
  company_db text NOT NULL,
  data jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cache_key, company_db)
);

ALTER TABLE public.sap_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access to sap_cache"
  ON public.sap_cache FOR SELECT
  USING (true);

CREATE POLICY "Allow all write access to sap_cache"
  ON public.sap_cache FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER update_sap_cache_updated_at
  BEFORE UPDATE ON public.sap_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
