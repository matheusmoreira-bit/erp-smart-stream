
-- user_profiles: escopar leitura e escrita ao dono (por e-mail) ou admin
DROP POLICY IF EXISTS "Authenticated read user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Authenticated insert user_profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Authenticated update user_profiles" ON public.user_profiles;

CREATE POLICY "Users read own profile"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR lower(COALESCE(email,'')) = lower(COALESCE((auth.jwt() ->> 'email'), ''))
  );

CREATE POLICY "Users insert own profile"
  ON public.user_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR lower(COALESCE(email,'')) = lower(COALESCE((auth.jwt() ->> 'email'), ''))
  );

CREATE POLICY "Users update own profile"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR lower(COALESCE(email,'')) = lower(COALESCE((auth.jwt() ->> 'email'), ''))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR lower(COALESCE(email,'')) = lower(COALESCE((auth.jwt() ->> 'email'), ''))
  );

-- Storage: remover INSERT genérico do bucket expense-attachments.
-- Uploads são feitos por edge functions (service_role), que ignoram RLS.
DROP POLICY IF EXISTS "auth can upload own expense files" ON storage.objects;

-- Storage: leitura do bucket nf-entrada-files apenas para admins.
DROP POLICY IF EXISTS "nf_entrada read" ON storage.objects;
CREATE POLICY "nf_entrada read admin"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'nf-entrada-files'
    AND public.has_role(auth.uid(), 'admin')
  );
