
CREATE TABLE public.expense_sap_sync_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  status text NOT NULL DEFAULT 'running',
  trigger text NOT NULL DEFAULT 'cron',
  processed_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text
);

CREATE INDEX idx_expense_sap_sync_runs_started_at
  ON public.expense_sap_sync_runs (started_at DESC);

GRANT SELECT ON public.expense_sap_sync_runs TO authenticated;
GRANT ALL ON public.expense_sap_sync_runs TO service_role;

ALTER TABLE public.expense_sap_sync_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view expense sap sync runs"
  ON public.expense_sap_sync_runs FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
