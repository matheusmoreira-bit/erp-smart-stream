
-- Integration configurations
CREATE TABLE public.synapse_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT false,
  interval_minutes integer NOT NULL DEFAULT 360,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_run_at timestamptz,
  last_run_status text,
  last_run_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.synapse_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to synapse_integrations"
  ON public.synapse_integrations FOR ALL
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_synapse_integrations_updated_at
  BEFORE UPDATE ON public.synapse_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Execution log
CREATE TABLE public.synapse_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key text NOT NULL,
  status text NOT NULL DEFAULT 'success',
  details jsonb DEFAULT '{}'::jsonb,
  affected_count integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.synapse_execution_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to synapse_execution_log"
  ON public.synapse_execution_log FOR ALL
  USING (true) WITH CHECK (true);
