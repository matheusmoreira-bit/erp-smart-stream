
-- 1) Unified integration_log
CREATE TABLE IF NOT EXISTS public.integration_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  system_name text NOT NULL,
  action text NOT NULL,
  company_db text,
  status text NOT NULL DEFAULT 'ok',
  http_status integer,
  error_message text,
  duration_ms integer,
  request_meta jsonb DEFAULT '{}'::jsonb,
  response_meta jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.integration_log TO authenticated;
GRANT ALL ON public.integration_log TO service_role;

ALTER TABLE public.integration_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins_view_integration_log" ON public.integration_log;
CREATE POLICY "admins_view_integration_log" ON public.integration_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_integration_log_created_at ON public.integration_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_integration_log_system_company ON public.integration_log (system_name, company_db, created_at DESC);

-- 2) Prune old data
CREATE OR REPLACE FUNCTION public.prune_old_integration_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.integration_log WHERE created_at < now() - interval '90 days';
  DELETE FROM public.whatsapp_login_alerts WHERE created_at < now() - interval '60 days';
  DELETE FROM public.whatsapp_approval_alerts WHERE created_at < now() - interval '60 days';
END;
$$;

-- Schedule daily prune
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('prune-integration-data') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune-integration-data');
    PERFORM cron.schedule(
      'prune-integration-data',
      '15 3 * * *',
      $cron$ SELECT public.prune_old_integration_data(); $cron$
    );
  END IF;
END $$;

-- 3) Check applicable approval rules before submission
CREATE OR REPLACE FUNCTION public.check_applicable_approval_rules(
  _company_db text,
  _total_amount numeric,
  _cost_center text DEFAULT NULL,
  _category text DEFAULT NULL
)
RETURNS TABLE(has_rule boolean, rule_count integer, sample_rule_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_sample uuid;
BEGIN
  SELECT COUNT(*), MIN(id)
  INTO v_count, v_sample
  FROM public.approval_rules ar
  WHERE ar.is_active = true
    AND (ar.company_db IS NULL OR ar.company_db = _company_db)
    AND (ar.min_amount IS NULL OR _total_amount >= ar.min_amount)
    AND (ar.max_amount IS NULL OR _total_amount <= ar.max_amount)
    AND (ar.cost_center IS NULL OR _cost_center IS NULL OR ar.cost_center = _cost_center)
    AND (ar.category IS NULL OR _category IS NULL OR ar.category = _category);

  RETURN QUERY SELECT (v_count > 0), COALESCE(v_count, 0), v_sample;
END;
$$;
