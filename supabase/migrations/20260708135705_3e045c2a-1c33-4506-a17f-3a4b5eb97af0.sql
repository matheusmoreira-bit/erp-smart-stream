
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- desagenda se já existir (idempotente)
    BEGIN
      PERFORM cron.unschedule('expense-integration-retry-every-10min');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;

    PERFORM cron.schedule(
      'expense-integration-retry-every-10min',
      '*/10 * * * *',
      $cron$
      select net.http_post(
        url:='https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-integration-retry',
        headers:='{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5eGxvZndieWhrcWN2emF2YnduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU3NDI0NjksImV4cCI6MjA5MTMxODQ2OX0.HaUmemW3ZFIcADFKYuGYX569p6ksNlFhtHQ5fMi-inU"}'::jsonb,
        body:=concat('{"scheduled_at": "', now(), '"}')::jsonb
      ) as request_id;
      $cron$
    );
  END IF;
END $$;
