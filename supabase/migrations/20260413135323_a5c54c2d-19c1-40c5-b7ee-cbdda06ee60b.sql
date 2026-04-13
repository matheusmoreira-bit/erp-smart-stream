
-- Allow anon to read synapse tables
CREATE POLICY "Anon can read synapse_integrations"
  ON public.synapse_integrations FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon can read synapse_execution_log"
  ON public.synapse_execution_log FOR SELECT
  TO anon
  USING (true);

-- Allow anon to read audit_log
CREATE POLICY "Anon can read audit_log"
  ON public.audit_log FOR SELECT
  TO anon
  USING (true);

-- Allow anon to insert audit_log (via direct insert, not just RPC)
CREATE POLICY "Anon can insert audit_log"
  ON public.audit_log FOR INSERT
  TO anon
  WITH CHECK (true);
