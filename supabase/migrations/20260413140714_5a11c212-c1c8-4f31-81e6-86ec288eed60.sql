-- Allow anon to insert and update synapse_integrations (needed for SAP-authenticated users)
CREATE POLICY "Anon can insert synapse_integrations"
  ON public.synapse_integrations FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anon can update synapse_integrations"
  ON public.synapse_integrations FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);