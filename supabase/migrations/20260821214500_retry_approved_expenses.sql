-- Reabre pedidos aprovados no ERP Flow que ficaram sem disparo de integração.
-- Locks recentes são preservados para não concorrer com uma execução ativa.
UPDATE public.expenses
SET doc_type = 'purchase',
    sap_integration_last_attempt_at = NULL,
    sap_integration_locked_at = NULL
WHERE status = 'aprovado'
  AND coalesce(nullif(trim(doc_type), ''), 'purchase') = 'purchase'
  AND sap_doc_entry IS NULL
  AND lower(trim(coalesce(origin, 'manual'))) NOT IN ('sap', 'erp', 'sap_erp')
  AND (
    sap_integration_locked_at IS NULL
    OR sap_integration_locked_at < now() - interval '15 minutes'
  );

-- O scanner é a garantia durável: cobre tanto os pedidos acima quanto uma
-- eventual falha/timeout no disparo imediato feito pela função de aprovação.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente; retry de pedidos aprovados não foi agendado.';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'email_queue_service_role_key'
      AND decrypted_secret IS NOT NULL
  ) THEN
    RAISE NOTICE 'Service role ausente no Vault; retry de pedidos aprovados não foi agendado.';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname IN (
    'expense-integration-retry-every-10min',
    'expense-integration-retry-every-5min'
  );

  PERFORM cron.schedule(
    'expense-integration-retry-every-5min',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://ryxlofwbyhkqcvzavbwn.supabase.co/functions/v1/expense-integration-retry',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'email_queue_service_role_key'
            LIMIT 1
          )
        ),
        body := '{"trigger":"cron","reason":"approved_without_erp_document"}'::jsonb
      );
    $cron$
  );
END $$;
