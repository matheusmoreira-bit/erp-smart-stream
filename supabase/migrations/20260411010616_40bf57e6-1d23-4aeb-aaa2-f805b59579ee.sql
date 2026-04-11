ALTER TABLE public.pagcorp_integration_log
  ADD COLUMN sap_payload jsonb DEFAULT NULL,
  ADD COLUMN sap_response jsonb DEFAULT NULL;

-- Allow anon to update (for cancel)
CREATE POLICY "Anon can update pagcorp_integration_log"
  ON public.pagcorp_integration_log
  FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);