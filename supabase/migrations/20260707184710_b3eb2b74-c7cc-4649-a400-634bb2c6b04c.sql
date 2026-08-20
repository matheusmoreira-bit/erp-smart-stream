
-- Reagenda o cron do expense-sap-status-sync para rodar a cada 5 minutos
-- (antes era a cada 30). Mantém o mesmo comando/URL/headers.
SELECT cron.unschedule('expense-sap-status-sync-every-30min');

SELECT cron.schedule(
  'expense-sap-status-sync-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url:='https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-sap-status-sync',
    headers:=jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='email_queue_service_role_key')
    ),
    body:=concat('{"scheduled_at": "', now(), '"}')::jsonb
  ) as request_id;
  $$
);
