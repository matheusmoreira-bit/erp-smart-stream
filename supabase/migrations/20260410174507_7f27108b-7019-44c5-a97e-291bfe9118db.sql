
CREATE POLICY "Public can read active companies"
  ON public.companies FOR SELECT
  TO anon
  USING (is_active = true);
