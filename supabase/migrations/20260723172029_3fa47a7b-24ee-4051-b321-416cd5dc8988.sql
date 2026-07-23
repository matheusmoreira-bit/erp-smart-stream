-- Bumpa last_attempt dos docs em bases TST% para o watcher priorizar os reais.
UPDATE public.expenses
SET sap_integration_last_attempt_at = now()
WHERE status = 'aprovado'
  AND doc_type = 'purchase'
  AND sap_doc_entry IS NULL
  AND (sap_purchase_order_status IS DISTINCT FROM 'success')
  AND company_db LIKE 'TST%'
  AND (sap_integration_last_attempt_at IS NULL
       OR sap_integration_last_attempt_at < now() - interval '30 minutes');

-- Garante que as duas despesas do Instituto ANA estão liberadas para o watcher.
UPDATE public.expenses
SET sap_integration_locked_at = NULL,
    sap_integration_last_attempt_at = NULL,
    sap_sync_next_retry_at = NULL,
    sap_purchase_order_status = 'failed'
WHERE id IN ('2efb5c9d-b4bc-4514-aeba-883ea1fa0cb2',
             'e1572e1e-8998-420c-ac7a-bdf856702051');