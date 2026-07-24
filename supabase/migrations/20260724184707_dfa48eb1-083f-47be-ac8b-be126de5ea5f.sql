
CREATE TABLE IF NOT EXISTS public.edge_metrics_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  kind text NOT NULL,
  window_bucket timestamptz NOT NULL,
  p95_ms numeric,
  error_rate numeric,
  total bigint,
  errors bigint,
  message text,
  sent_to text,
  ok boolean,
  response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (function_name, kind, window_bucket)
);

GRANT SELECT ON public.edge_metrics_alerts TO authenticated;
GRANT ALL ON public.edge_metrics_alerts TO service_role;

ALTER TABLE public.edge_metrics_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read edge_metrics_alerts"
  ON public.edge_metrics_alerts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_edge_metrics_alerts_created ON public.edge_metrics_alerts (created_at DESC);
