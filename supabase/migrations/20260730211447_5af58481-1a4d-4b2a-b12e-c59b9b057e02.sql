CREATE OR REPLACE FUNCTION public.get_integration_health(_hours integer DEFAULT 24)
RETURNS TABLE (
  provider text,
  function_name text,
  total bigint,
  errors bigint,
  error_rate numeric,
  avg_ms numeric,
  p50_ms numeric,
  p95_ms numeric,
  last_at timestamptz,
  last_error_at timestamptz,
  last_error_code text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      CASE
        WHEN m.function_name LIKE '%-hana%' OR m.function_name LIKE 'hana%' THEN 'hana'
        WHEN m.function_name LIKE 'pagcorp%' THEN 'pagcorp'
        WHEN m.function_name LIKE 'mastertax%' OR m.function_name LIKE '%master-tax%' THEN 'mastertax'
        WHEN m.function_name LIKE 'sap%'
          OR m.function_name LIKE '%-to-sap'
          OR m.function_name IN ('baixa-recebimento','sales-nfse-emit','nfse-xml-fetch','sales-nfse-reconcile','nf-entrada-invoice-draft','intercompany')
          THEN 'sap_sl'
        ELSE 'other'
      END AS provider,
      m.function_name,
      m.duration_ms,
      m.ok,
      m.started_at,
      m.error_code
    FROM public.edge_function_metrics m
    WHERE m.started_at >= now() - make_interval(hours => GREATEST(_hours, 1))
      AND public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  SELECT
    s.provider,
    s.function_name,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE NOT s.ok)::bigint,
    ROUND(100.0 * COUNT(*) FILTER (WHERE NOT s.ok) / NULLIF(COUNT(*),0), 2),
    ROUND(AVG(s.duration_ms)::numeric, 0),
    ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.duration_ms)::numeric, 0),
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms)::numeric, 0),
    MAX(s.started_at),
    MAX(s.started_at) FILTER (WHERE NOT s.ok),
    (ARRAY_AGG(s.error_code ORDER BY s.started_at DESC) FILTER (WHERE NOT s.ok AND s.error_code IS NOT NULL))[1]
  FROM scoped s
  WHERE s.provider <> 'other'
  GROUP BY s.provider, s.function_name
  ORDER BY s.provider, COUNT(*) DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_integration_health(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_integration_health(integer) TO authenticated;