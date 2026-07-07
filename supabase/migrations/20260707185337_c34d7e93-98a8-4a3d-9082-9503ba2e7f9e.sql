
CREATE OR REPLACE FUNCTION public.get_sap_sync_health(_last_n integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cron_active boolean;
  v_cron_schedule text;
  v_cron_jobname text;
  v_last_run record;
  v_stats record;
  v_now timestamptz := now();
BEGIN
  -- Só admins podem consultar healthcheck.
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT jobname, schedule, active
    INTO v_cron_jobname, v_cron_schedule, v_cron_active
  FROM cron.job
  WHERE jobname LIKE 'expense-sap-status-sync%'
  ORDER BY jobid DESC
  LIMIT 1;

  SELECT id, started_at, finished_at, duration_ms, status, trigger,
         processed_count, updated_count, error_count, error_message
    INTO v_last_run
  FROM public.expense_sap_sync_runs
  ORDER BY started_at DESC
  LIMIT 1;

  SELECT
    count(*) AS total_runs,
    count(*) FILTER (WHERE status = 'ok') AS ok_runs,
    count(*) FILTER (WHERE status = 'error') AS error_runs,
    count(*) FILTER (WHERE status = 'running') AS running_runs,
    coalesce(avg(duration_ms) FILTER (WHERE duration_ms IS NOT NULL), 0)::bigint AS avg_duration_ms,
    coalesce(max(duration_ms), 0)::bigint AS max_duration_ms,
    coalesce(sum(processed_count), 0)::bigint AS total_processed,
    coalesce(sum(updated_count), 0)::bigint AS total_updated,
    coalesce(sum(error_count), 0)::bigint AS total_item_errors
  INTO v_stats
  FROM (
    SELECT * FROM public.expense_sap_sync_runs
    ORDER BY started_at DESC
    LIMIT _last_n
  ) t;

  RETURN jsonb_build_object(
    'cron', jsonb_build_object(
      'jobname', v_cron_jobname,
      'schedule', v_cron_schedule,
      'active', coalesce(v_cron_active, false)
    ),
    'last_run', CASE WHEN v_last_run.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_last_run.id,
      'started_at', v_last_run.started_at,
      'finished_at', v_last_run.finished_at,
      'duration_ms', v_last_run.duration_ms,
      'status', v_last_run.status,
      'trigger', v_last_run.trigger,
      'processed_count', v_last_run.processed_count,
      'updated_count', v_last_run.updated_count,
      'error_count', v_last_run.error_count,
      'error_message', v_last_run.error_message,
      'age_seconds', extract(epoch FROM (v_now - v_last_run.started_at))::bigint
    ) END,
    'window', jsonb_build_object(
      'size', _last_n,
      'total_runs', v_stats.total_runs,
      'ok_runs', v_stats.ok_runs,
      'error_runs', v_stats.error_runs,
      'running_runs', v_stats.running_runs,
      'error_rate', CASE WHEN v_stats.total_runs > 0
                         THEN round((v_stats.error_runs::numeric / v_stats.total_runs) * 100, 2)
                         ELSE 0 END,
      'avg_duration_ms', v_stats.avg_duration_ms,
      'max_duration_ms', v_stats.max_duration_ms,
      'total_processed', v_stats.total_processed,
      'total_updated', v_stats.total_updated,
      'total_item_errors', v_stats.total_item_errors
    ),
    'generated_at', v_now
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_sap_sync_health(integer) TO authenticated;
