
-- Allow anon to read synapse_integrations
CREATE POLICY "Anon can read synapse_integrations"
  ON public.synapse_integrations FOR SELECT
  TO anon
  USING (true);

-- Allow anon to insert synapse_integrations
CREATE POLICY "Anon can insert synapse_integrations"
  ON public.synapse_integrations FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anon to update synapse_integrations
CREATE POLICY "Anon can update synapse_integrations"
  ON public.synapse_integrations FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

-- Allow anon to insert audit_log
CREATE POLICY "Anon can insert audit_log"
  ON public.audit_log FOR INSERT
  TO anon
  WITH CHECK (true);

-- Allow anon to read audit_log
CREATE POLICY "Anon can read audit_log"
  ON public.audit_log FOR SELECT
  TO anon
  USING (true);

-- Allow anon to read synapse_execution_log
CREATE POLICY "Anon can read synapse_execution_log"
  ON public.synapse_execution_log FOR SELECT
  TO anon
  USING (true);
