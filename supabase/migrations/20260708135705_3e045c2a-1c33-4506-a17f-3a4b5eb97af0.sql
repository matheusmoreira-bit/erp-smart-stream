
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
        headers:=jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='email_queue_service_role_key')
        ),
        body:=concat('{"scheduled_at": "', now(), '"}')::jsonb
      ) as request_id;
      $cron$
    );
  END IF;
END $$;
