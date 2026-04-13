
-- Allow anon to read pagcorp mappings and integration log
CREATE POLICY "Anon can read pagcorp_account_mapping"
  ON public.pagcorp_account_mapping FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can read pagcorp_item_mapping"
  ON public.pagcorp_item_mapping FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can read pagcorp_integration_log"
  ON public.pagcorp_integration_log FOR SELECT
  TO anon
  USING (true);

-- Also allow anon to insert into pagcorp_integration_log (needed for logging integrations)
CREATE POLICY "Anon can insert pagcorp_integration_log"
  ON public.pagcorp_integration_log FOR INSERT
  TO anon
  WITH CHECK (true);
