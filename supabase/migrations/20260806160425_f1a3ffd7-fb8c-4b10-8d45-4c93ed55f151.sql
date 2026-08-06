CREATE TABLE IF NOT EXISTS public.db_query_metrics (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  screen TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'rest',
  target TEXT NOT NULL,
  operation TEXT NOT NULL DEFAULT 'select',
  duration_ms INTEGER NOT NULL,
  ok BOOLEAN NOT NULL DEFAULT true,
  status_code INTEGER,
  row_count INTEGER,
  company_db TEXT,
  user_id UUID
);

CREATE INDEX IF NOT EXISTS idx_db_query_metrics_time ON public.db_query_metrics (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_query_metrics_screen_time ON public.db_query_metrics (screen, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_db_query_metrics_slow ON public.db_query_metrics (duration_ms DESC, started_at DESC);

GRANT SELECT ON public.db_query_metrics TO authenticated;
GRANT ALL ON public.db_query_metrics TO service_role;

ALTER TABLE public.db_query_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_read_db_query_metrics" ON public.db_query_metrics;
CREATE POLICY "admins_read_db_query_metrics"
  ON public.db_query_metrics FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Ingestão em lote (sem política de INSERT: só entra por esta função)
CREATE OR REPLACE FUNCTION public.record_db_query_metrics(_events JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inserted INTEGER := 0;
BEGIN
  IF _events IS NULL OR jsonb_typeof(_events) <> 'array' THEN
    RETURN 0;
  END IF;

  INSERT INTO public.db_query_metrics
    (screen, source, target, operation, duration_ms, ok, status_code, row_count, company_db, user_id)
  SELECT
    LEFT(COALESCE(NULLIF(e->>'screen', ''), 'desconhecida'), 120),
    LEFT(COALESCE(NULLIF(e->>'source', ''), 'rest'), 20),
    LEFT(COALESCE(NULLIF(e->>'target', ''), 'desconhecido'), 160),
    LEFT(COALESCE(NULLIF(e->>'operation', ''), 'select'), 20),
    LEAST(GREATEST(COALESCE((e->>'duration_ms')::INTEGER, 0), 0), 600000),
    COALESCE((e->>'ok')::BOOLEAN, true),
    NULLIF(e->>'status_code', '')::INTEGER,
    NULLIF(e->>'row_count', '')::INTEGER,
    LEFT(NULLIF(e->>'company_db', ''), 60),
    auth.uid()
  FROM jsonb_array_elements(_events) AS e
  LIMIT 200;

  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_db_query_metrics(JSONB) TO authenticated, anon, service_role;

-- Resumo por tela
CREATE OR REPLACE FUNCTION public.get_db_query_metrics_by_screen(_hours INTEGER DEFAULT 24)
RETURNS TABLE(
  screen TEXT, total BIGINT, errors BIGINT, error_rate NUMERIC,
  avg_ms NUMERIC, p50_ms NUMERIC, p95_ms NUMERIC, p99_ms NUMERIC,
  max_ms INTEGER, slow_count BIGINT, total_ms NUMERIC, last_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    m.screen,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE NOT m.ok)::BIGINT,
    ROUND(100.0 * COUNT(*) FILTER (WHERE NOT m.ok) / NULLIF(COUNT(*), 0), 2),
    ROUND(AVG(m.duration_ms)::NUMERIC, 0),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.duration_ms)::NUMERIC, 0),
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY m.duration_ms)::NUMERIC, 0),
    ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY m.duration_ms)::NUMERIC, 0),
    MAX(m.duration_ms),
    COUNT(*) FILTER (WHERE m.duration_ms >= 1000)::BIGINT,
    SUM(m.duration_ms)::NUMERIC,
    MAX(m.started_at)
  FROM public.db_query_metrics m
  WHERE m.started_at >= now() - make_interval(hours => GREATEST(COALESCE(_hours, 24), 1))
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY m.screen
  ORDER BY 11 DESC;
$$;

-- Resumo por consulta (tabela/rpc), opcionalmente filtrado por tela
CREATE OR REPLACE FUNCTION public.get_db_query_metrics_by_target(_hours INTEGER DEFAULT 24, _screen TEXT DEFAULT NULL)
RETURNS TABLE(
  target TEXT, source TEXT, operation TEXT, screens BIGINT, total BIGINT, errors BIGINT,
  avg_ms NUMERIC, p50_ms NUMERIC, p95_ms NUMERIC, p99_ms NUMERIC,
  max_ms INTEGER, total_ms NUMERIC, last_at TIMESTAMPTZ
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    m.target, m.source, m.operation,
    COUNT(DISTINCT m.screen)::BIGINT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE NOT m.ok)::BIGINT,
    ROUND(AVG(m.duration_ms)::NUMERIC, 0),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.duration_ms)::NUMERIC, 0),
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY m.duration_ms)::NUMERIC, 0),
    ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY m.duration_ms)::NUMERIC, 0),
    MAX(m.duration_ms),
    SUM(m.duration_ms)::NUMERIC,
    MAX(m.started_at)
  FROM public.db_query_metrics m
  WHERE m.started_at >= now() - make_interval(hours => GREATEST(COALESCE(_hours, 24), 1))
    AND (_screen IS NULL OR m.screen = _screen)
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY m.target, m.source, m.operation
  ORDER BY 12 DESC;
$$;

-- Amostras recentes de consultas lentas
CREATE OR REPLACE FUNCTION public.get_db_slow_query_samples(
  _hours INTEGER DEFAULT 24, _min_ms INTEGER DEFAULT 1000, _limit INTEGER DEFAULT 50
)
RETURNS TABLE(
  started_at TIMESTAMPTZ, screen TEXT, source TEXT, target TEXT, operation TEXT,
  duration_ms INTEGER, ok BOOLEAN, status_code INTEGER, row_count INTEGER, company_db TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.started_at, m.screen, m.source, m.target, m.operation,
         m.duration_ms, m.ok, m.status_code, m.row_count, m.company_db
  FROM public.db_query_metrics m
  WHERE m.started_at >= now() - make_interval(hours => GREATEST(COALESCE(_hours, 24), 1))
    AND m.duration_ms >= GREATEST(COALESCE(_min_ms, 1000), 0)
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY m.duration_ms DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
$$;

-- Consultas lentas do próprio Postgres (pg_stat_statements)
CREATE OR REPLACE FUNCTION public.get_pg_slow_queries(_limit INTEGER DEFAULT 20)
RETURNS TABLE(
  query TEXT, calls BIGINT, total_ms NUMERIC, mean_ms NUMERIC, max_ms NUMERIC, rows_total BIGINT
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
  SELECT
    LEFT(s.query, 400),
    s.calls,
    ROUND(s.total_exec_time::NUMERIC, 0),
    ROUND(s.mean_exec_time::NUMERIC, 1),
    ROUND(s.max_exec_time::NUMERIC, 0),
    s.rows
  FROM extensions.pg_stat_statements s
  JOIN pg_database d ON d.oid = s.dbid AND d.datname = current_database()
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND s.query NOT ILIKE '%pg_stat_statements%'
  ORDER BY s.total_exec_time DESC
  LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.prune_db_query_metrics()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  DELETE FROM public.db_query_metrics WHERE started_at < now() - INTERVAL '14 days';
$$;

SELECT cron.schedule('prune-db-query-metrics', '17 4 * * *', $$SELECT public.prune_db_query_metrics();$$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-db-query-metrics');