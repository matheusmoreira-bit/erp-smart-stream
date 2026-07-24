CREATE TABLE public.edge_function_metrics (
  id BIGSERIAL PRIMARY KEY,
  function_name TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms INTEGER NOT NULL,
  status_code INTEGER,
  ok BOOLEAN NOT NULL DEFAULT true,
  company_db TEXT,
  error_code TEXT,
  meta JSONB
);

CREATE INDEX idx_edge_function_metrics_fn_time
  ON public.edge_function_metrics (function_name, started_at DESC);
CREATE INDEX idx_edge_function_metrics_time
  ON public.edge_function_metrics (started_at DESC);

GRANT SELECT ON public.edge_function_metrics TO authenticated;
GRANT ALL ON public.edge_function_metrics TO service_role;

ALTER TABLE public.edge_function_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_edge_metrics"
  ON public.edge_function_metrics FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Writes happen only via service_role from edge functions; no INSERT policy for authenticated.

CREATE OR REPLACE FUNCTION public.get_edge_function_metrics(_hours INTEGER DEFAULT 24)
RETURNS TABLE (
  function_name TEXT,
  total BIGINT,
  errors BIGINT,
  error_rate NUMERIC,
  avg_ms NUMERIC,
  p50_ms NUMERIC,
  p95_ms NUMERIC,
  p99_ms NUMERIC,
  last_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    m.function_name,
    COUNT(*)::BIGINT AS total,
    COUNT(*) FILTER (WHERE NOT m.ok)::BIGINT AS errors,
    ROUND(100.0 * COUNT(*) FILTER (WHERE NOT m.ok) / NULLIF(COUNT(*), 0), 2) AS error_rate,
    ROUND(AVG(m.duration_ms)::NUMERIC, 0) AS avg_ms,
    ROUND(PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY m.duration_ms)::NUMERIC, 0) AS p50_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY m.duration_ms)::NUMERIC, 0) AS p95_ms,
    ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY m.duration_ms)::NUMERIC, 0) AS p99_ms,
    MAX(m.started_at) AS last_at
  FROM public.edge_function_metrics m
  WHERE m.started_at >= now() - make_interval(hours => GREATEST(_hours, 1))
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY m.function_name
  ORDER BY total DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_edge_function_metrics(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_edge_function_metrics(INTEGER) TO authenticated;

-- Retention: keep 14 days. Cheap cleanup via a scheduled prune.
CREATE OR REPLACE FUNCTION public.prune_edge_function_metrics()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.edge_function_metrics
   WHERE started_at < now() - INTERVAL '14 days';
$$;
REVOKE EXECUTE ON FUNCTION public.prune_edge_function_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_edge_function_metrics() TO service_role;