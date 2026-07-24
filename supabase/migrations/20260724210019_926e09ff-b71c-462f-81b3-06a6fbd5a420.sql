CREATE TABLE IF NOT EXISTS public.user_sap_credentials (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  sap_user text NOT NULL,
  sap_password_encrypted text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_db)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_sap_credentials TO authenticated;
GRANT ALL ON public.user_sap_credentials TO service_role;

ALTER TABLE public.user_sap_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sap_creds_select_own" ON public.user_sap_credentials
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "sap_creds_insert_own" ON public.user_sap_credentials
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sap_creds_update_own" ON public.user_sap_credentials
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sap_creds_delete_own" ON public.user_sap_credentials
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_sap_credentials_user ON public.user_sap_credentials(user_id);

DROP TRIGGER IF EXISTS trg_user_sap_credentials_updated_at ON public.user_sap_credentials;
CREATE TRIGGER trg_user_sap_credentials_updated_at
  BEFORE UPDATE ON public.user_sap_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();