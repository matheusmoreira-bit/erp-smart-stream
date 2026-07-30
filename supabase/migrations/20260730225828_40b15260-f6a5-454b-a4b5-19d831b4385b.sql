CREATE TABLE IF NOT EXISTS public.integration_health_alert_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  window_minutes integer NOT NULL DEFAULT 30,
  min_samples integer NOT NULL DEFAULT 5,
  p95_threshold_ms integer NOT NULL DEFAULT 15000,
  error_rate_threshold numeric NOT NULL DEFAULT 10,
  cooldown_minutes integer NOT NULL DEFAULT 60,
  notify_email boolean NOT NULL DEFAULT true,
  notify_slack boolean NOT NULL DEFAULT false,
  recipient_emails text[] NOT NULL DEFAULT '{}',
  slack_channel text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_health_alert_settings TO authenticated;
GRANT ALL ON public.integration_health_alert_settings TO service_role;
ALTER TABLE public.integration_health_alert_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ihas_admin_select" ON public.integration_health_alert_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "ihas_admin_insert" ON public.integration_health_alert_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "ihas_admin_update" ON public.integration_health_alert_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "ihas_admin_delete" ON public.integration_health_alert_settings
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_ihas_updated_at BEFORE UPDATE ON public.integration_health_alert_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.integration_health_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  total integer,
  errors integer,
  error_rate numeric,
  p95_ms numeric,
  window_minutes integer,
  channels text[] NOT NULL DEFAULT '{}',
  delivery_ok boolean,
  delivery_detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_iha_provider_created ON public.integration_health_alerts (provider, created_at DESC);

GRANT SELECT ON public.integration_health_alerts TO authenticated;
GRANT ALL ON public.integration_health_alerts TO service_role;
ALTER TABLE public.integration_health_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "iha_admin_select" ON public.integration_health_alerts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.integration_health_alert_settings (provider) VALUES
  ('sap_sl'), ('hana'), ('pagcorp'), ('mastertax')
ON CONFLICT (provider) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_integration_health_snapshot(_minutes integer DEFAULT 30)
RETURNS TABLE (
  provider text,
  total bigint,
  errors bigint,
  error_rate numeric,
  p95_ms numeric,
  last_at timestamptz,
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
      m.duration_ms, m.ok, m.started_at, m.error_code
    FROM public.edge_function_metrics m
    WHERE m.started_at >= now() - make_interval(mins => GREATEST(_minutes, 1))
  )
  SELECT
    s.provider,
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE NOT s.ok)::bigint,
    ROUND(100.0 * COUNT(*) FILTER (WHERE NOT s.ok) / NULLIF(COUNT(*),0), 2),
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.duration_ms)::numeric, 0),
    MAX(s.started_at),
    (ARRAY_AGG(s.error_code ORDER BY s.started_at DESC) FILTER (WHERE NOT s.ok AND s.error_code IS NOT NULL))[1]
  FROM scoped s
  WHERE s.provider <> 'other'
  GROUP BY s.provider;
$$;

REVOKE EXECUTE ON FUNCTION public.get_integration_health_snapshot(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_integration_health_snapshot(integer) TO service_role;