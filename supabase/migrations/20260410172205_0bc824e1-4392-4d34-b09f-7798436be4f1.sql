
CREATE POLICY "Allow all access to system_credentials"
  ON public.system_credentials FOR ALL
  USING (true)
  WITH CHECK (true);
