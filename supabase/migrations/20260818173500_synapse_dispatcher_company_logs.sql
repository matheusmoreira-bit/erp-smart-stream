ALTER TABLE public.synapse_execution_log
  ADD COLUMN IF NOT EXISTS company_db text;

CREATE INDEX IF NOT EXISTS idx_synapse_execution_log_company_integration_created
  ON public.synapse_execution_log (company_db, integration_key, created_at DESC);

DROP POLICY IF EXISTS "Anon can read synapse_execution_log" ON public.synapse_execution_log;
REVOKE ALL ON public.synapse_execution_log FROM anon;
GRANT SELECT ON public.synapse_execution_log TO authenticated;
GRANT ALL ON public.synapse_execution_log TO service_role;
