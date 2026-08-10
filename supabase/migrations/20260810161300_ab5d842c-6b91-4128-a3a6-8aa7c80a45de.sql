CREATE TABLE IF NOT EXISTS public.hana_health_probes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  base_url text NOT NULL,
  company_db text,
  view_name text,
  ok boolean NOT NULL DEFAULT false,
  http_status integer,
  duration_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hana_health_probes TO authenticated;
GRANT ALL ON public.hana_health_probes TO service_role;

ALTER TABLE public.hana_health_probes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hhp_admin_select ON public.hana_health_probes;
CREATE POLICY hhp_admin_select ON public.hana_health_probes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_hhp_created ON public.hana_health_probes (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hhp_base_created ON public.hana_health_probes (base_url, created_at DESC);

INSERT INTO public.integration_health_alert_settings
  (provider, enabled, window_minutes, min_samples, p95_threshold_ms, error_rate_threshold, cooldown_minutes, notify_email, notify_slack)
VALUES ('hanaapi_v2', true, 15, 2, 20000, 20, 30, true, false)
ON CONFLICT (provider) DO NOTHING;