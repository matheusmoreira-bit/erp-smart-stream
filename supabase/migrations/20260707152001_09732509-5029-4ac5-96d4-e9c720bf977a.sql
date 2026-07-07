
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  user_code TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  email TEXT,
  phone TEXT,
  notify_whatsapp_overdue BOOLEAN NOT NULL DEFAULT TRUE,
  notify_whatsapp_approvals BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email_overdue BOOLEAN NOT NULL DEFAULT TRUE,
  notify_email_approvals BOOLEAN NOT NULL DEFAULT TRUE,
  sap_synced_at TIMESTAMPTZ,
  dismissed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, user_code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_profiles TO service_role;

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access user_profiles"
  ON public.user_profiles FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users read own profile"
  ON public.user_profiles FOR SELECT
  TO authenticated
  USING (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
    OR lower(email) = lower(auth.jwt() ->> 'email')
  );

CREATE POLICY "Users insert own profile"
  ON public.user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
    OR lower(email) = lower(auth.jwt() ->> 'email')
  );

CREATE POLICY "Users update own profile"
  ON public.user_profiles FOR UPDATE
  TO authenticated
  USING (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
    OR lower(email) = lower(auth.jwt() ->> 'email')
  )
  WITH CHECK (
    lower(user_code) IN (
      SELECT lower(sap_user_code) FROM public.idp_user_mapping
      WHERE lower(idp_email) = lower(auth.jwt() ->> 'email')
         OR lower(sap_email) = lower(auth.jwt() ->> 'email')
    )
    OR lower(email) = lower(auth.jwt() ->> 'email')
  );

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
