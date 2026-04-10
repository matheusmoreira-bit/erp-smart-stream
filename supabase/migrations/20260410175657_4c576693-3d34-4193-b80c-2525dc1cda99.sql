CREATE POLICY "Anon can insert pagcorp_integration_log"
  ON public.pagcorp_integration_log FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon can read pagcorp_integration_log"
  ON public.pagcorp_integration_log FOR SELECT
  TO anon
  USING (true);