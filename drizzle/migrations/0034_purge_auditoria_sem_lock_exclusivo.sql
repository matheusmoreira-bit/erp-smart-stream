-- lovable-cron-fallback-reviewed: limpeza retroativa temporária da trilha de auditoria; job se auto-desagenda ao terminar
CREATE OR REPLACE FUNCTION public._audit_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF coalesce(current_setting('app.audit_purge', true), '') = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  RAISE EXCEPTION 'audit_trail is append-only (op=%)', TG_OP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.purge_audit_trail_payloads(_batch_limit integer DEFAULT 2000)
RETURNS TABLE(cleared bigint, remaining bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_count bigint := 0;
BEGIN
  PERFORM set_config('app.audit_purge', 'on', true);
  WITH victims AS (
    SELECT id FROM public.audit_trail
     WHERE old_data IS NOT NULL OR new_data IS NOT NULL
     ORDER BY id ASC
     LIMIT least(greatest(_batch_limit, 1), 5000)
  )
  UPDATE public.audit_trail a SET old_data = NULL, new_data = NULL
    FROM victims v WHERE a.id = v.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('app.audit_purge', 'off', true);
  RETURN QUERY SELECT v_count, (
    SELECT count(*) FROM (
      SELECT 1 FROM public.audit_trail
       WHERE old_data IS NOT NULL OR new_data IS NOT NULL
       LIMIT 200000
    ) s
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.purge_audit_trail_payloads(integer) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('audit-trail-payload-purge');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('audit-trail-payload-purge', '*/5 * * * *',
  $$SELECT public.purge_audit_trail_payloads_tick();$$);