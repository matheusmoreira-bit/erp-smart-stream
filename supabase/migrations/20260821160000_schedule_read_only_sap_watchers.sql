-- Mantém os caches e estados fiscais/financeiros atualizados. Estes jobs fazem
-- somente leitura no SAP; escritas externas continuam nas ações explícitas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente; watchers SAP não foram agendados.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
    WHERE name = 'email_queue_service_role_key'
      AND decrypted_secret IS NOT NULL
  ) THEN
    RAISE NOTICE 'Service role ausente no Vault; watchers SAP não foram agendados.';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN (
    'sap-po-cache-sync-every-5min',
    'sap-nf-entrada-sync-every-5min',
    'sap-vendor-payment-cache-sync-every-10min',
    'nf-entrada-sap-watcher-every-5min',
    'expense-sap-status-sync-every-5min',
    'sap-fluxo-analise-sync-every-10min'
  );

  PERFORM cron.schedule(
    'sap-po-cache-sync-every-5min',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/sap-po-cache-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key' LIMIT 1
          )
        ),
        body := '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );

  PERFORM cron.schedule(
    'sap-nf-entrada-sync-every-5min',
    '1-59/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/sap-nf-entrada-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key' LIMIT 1
          )
        ),
        body := '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );

  PERFORM cron.schedule(
    'sap-vendor-payment-cache-sync-every-10min',
    '2-59/10 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/sap-vendor-payment-cache-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key' LIMIT 1
          )
        ),
        body := '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );

  PERFORM cron.schedule(
    'nf-entrada-sap-watcher-every-5min',
    '3-59/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/nf-entrada-sap-watcher',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key' LIMIT 1
          )
        ),
        body := '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );

  PERFORM cron.schedule(
    'expense-sap-status-sync-every-5min',
    '4-59/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-sap-status-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key' LIMIT 1
          )
        ),
        body := '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );

  PERFORM cron.schedule(
    'sap-fluxo-analise-sync-every-10min',
    '6-59/10 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/sap-fluxo-analise-sync',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key' LIMIT 1
          )
        ),
        body := '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );
END $$;
