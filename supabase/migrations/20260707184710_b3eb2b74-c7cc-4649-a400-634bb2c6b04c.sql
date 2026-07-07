
-- Reagenda o cron do expense-sap-status-sync para rodar a cada 5 minutos
-- (antes era a cada 30). Mantém o mesmo comando/URL/headers.
SELECT cron.unschedule('expense-sap-status-sync-every-30min');

SELECT cron.schedule(
  'expense-sap-status-sync-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url:='https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-sap-status-sync',
    headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5eGxvZndieWhrcWN2emF2YnduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDI0NjksImV4cCI6MjA5MTMxODQ2OX0.HaUmemW3ZFIcADFKYuGYX569p6ksNlFhtHQ5fMi-inU"}'::jsonb,
    body:=concat('{"scheduled_at": "', now(), '"}')::jsonb
  ) as request_id;
  $$
);
