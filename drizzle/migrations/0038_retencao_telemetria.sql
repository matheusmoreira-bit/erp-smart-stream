-- Retenção de telemetria: 30–90 dias, junto da poda diária existente.
CREATE OR REPLACE FUNCTION public.prune_old_integration_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.integration_log WHERE created_at < now() - interval '90 days';
  DELETE FROM public.whatsapp_login_alerts WHERE created_at < now() - interval '60 days';
  DELETE FROM public.whatsapp_approval_alerts WHERE created_at < now() - interval '60 days';
  -- Telemetria operacional (não é trilha de auditoria)
  DELETE FROM public.hana_health_probes WHERE created_at < now() - interval '30 days';
  DELETE FROM public.edge_function_metrics WHERE started_at < now() - interval '30 days';
  DELETE FROM public.overdue_reminder_log WHERE sent_at < now() - interval '90 days';
  DELETE FROM public.notification_send_runs WHERE sent_at < now() - interval '90 days';
END;
$function$;