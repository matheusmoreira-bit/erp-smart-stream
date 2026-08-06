-- 1. Série temporal de latência das edge functions -----------------------------
CREATE OR REPLACE FUNCTION public.get_edge_metrics_timeseries(
  _hours integer DEFAULT 24,
  _bucket_minutes integer DEFAULT 60,
  _function text DEFAULT NULL
)
RETURNS TABLE(
  bucket timestamptz,
  total bigint,
  errors bigint,
  avg_ms numeric,
  p95_ms numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    to_timestamp(
      floor(extract(epoch from m.started_at) / (GREATEST(COALESCE(_bucket_minutes, 60), 5) * 60))
      * (GREATEST(COALESCE(_bucket_minutes, 60), 5) * 60)
    ) AS bucket,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE NOT m.ok)::bigint,
    ROUND(AVG(m.duration_ms)::numeric, 0),
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY m.duration_ms)::numeric, 0)
  FROM public.edge_function_metrics m
  WHERE m.started_at >= now() - make_interval(hours => GREATEST(COALESCE(_hours, 24), 1))
    AND (_function IS NULL OR m.function_name = _function)
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY 1
  ORDER BY 1;
$$;

-- 2. Métricas do expense-read, por tela ----------------------------------------
CREATE OR REPLACE FUNCTION public.get_expense_read_metrics(_hours integer DEFAULT 24)
RETURNS TABLE(
  screen text,
  total bigint,
  errors bigint,
  avg_ms numeric,
  p50_ms numeric,
  p95_ms numeric,
  max_ms integer,
  avg_rows numeric,
  last_at timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE(NULLIF(m.screen, ''), 'desconhecida'),
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE NOT m.ok)::bigint,
    ROUND(AVG(m.duration_ms)::numeric, 0),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.duration_ms)::numeric, 0),
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY m.duration_ms)::numeric, 0),
    MAX(m.duration_ms),
    ROUND(AVG(m.row_count)::numeric, 1),
    MAX(m.started_at)
  FROM public.db_query_metrics m
  WHERE m.started_at >= now() - make_interval(hours => GREATEST(COALESCE(_hours, 24), 1))
    AND (m.target ILIKE '%expense-read%' OR m.target ILIKE '%expenses%')
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- 3. Tempo por etapa do fluxo de documentos ------------------------------------
CREATE OR REPLACE FUNCTION public.get_flow_stage_metrics(_days integer DEFAULT 30)
RETURNS TABLE(
  stage text,
  stage_order integer,
  docs bigint,
  avg_hours numeric,
  p50_hours numeric,
  p95_hours numeric,
  max_hours numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT
      e.id,
      e.created_at,
      (SELECT MIN(l.decided_at) FROM public.expense_approval_log l
        WHERE l.expense_id = e.id AND l.decision ILIKE 'aprov%') AS first_approval,
      (SELECT MAX(l.decided_at) FROM public.expense_approval_log l
        WHERE l.expense_id = e.id AND l.decision ILIKE 'aprov%') AS last_approval,
      CASE WHEN e.sap_doc_num IS NOT NULL THEN e.sap_integration_last_attempt_at END AS integrated_at,
      (SELECT MIN(n.created_at) FROM public.nf_entrada_imports n
        WHERE n.expense_id = e.id) AS nf_at
    FROM public.expenses e
    WHERE e.created_at >= now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1))
      AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ),
  stages AS (
    SELECT 'Criação → 1ª aprovação'::text AS stage, 1 AS stage_order,
           EXTRACT(epoch FROM (first_approval - created_at)) / 3600 AS hrs
      FROM base WHERE first_approval IS NOT NULL AND first_approval >= created_at
    UNION ALL
    SELECT '1ª aprovação → aprovação final', 2,
           EXTRACT(epoch FROM (last_approval - first_approval)) / 3600
      FROM base WHERE last_approval IS NOT NULL AND first_approval IS NOT NULL
        AND last_approval >= first_approval
    UNION ALL
    SELECT 'Aprovação final → integração no ERP', 3,
           EXTRACT(epoch FROM (integrated_at - last_approval)) / 3600
      FROM base WHERE integrated_at IS NOT NULL AND last_approval IS NOT NULL
        AND integrated_at >= last_approval
    UNION ALL
    SELECT 'Integração → NF de entrada', 4,
           EXTRACT(epoch FROM (nf_at - integrated_at)) / 3600
      FROM base WHERE nf_at IS NOT NULL AND integrated_at IS NOT NULL AND nf_at >= integrated_at
    UNION ALL
    SELECT 'Ciclo completo (criação → NF)', 5,
           EXTRACT(epoch FROM (nf_at - created_at)) / 3600
      FROM base WHERE nf_at IS NOT NULL AND nf_at >= created_at
  )
  SELECT
    s.stage,
    s.stage_order,
    COUNT(*)::bigint,
    ROUND(AVG(s.hrs)::numeric, 2),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.hrs)::numeric, 2),
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.hrs)::numeric, 2),
    ROUND(MAX(s.hrs)::numeric, 2)
  FROM stages s
  GROUP BY s.stage, s.stage_order
  ORDER BY s.stage_order;
$$;

REVOKE ALL ON FUNCTION public.get_edge_metrics_timeseries(integer, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_expense_read_metrics(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_flow_stage_metrics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_edge_metrics_timeseries(integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expense_read_metrics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_flow_stage_metrics(integer) TO authenticated;