UPDATE public.expenses
   SET sap_purchase_order_status = NULL,
       sap_integration_error = NULL,
       sap_integration_locked_at = NULL,
       sap_integration_last_attempt_at = NULL,
       sap_sync_state = NULL,
       sap_sync_attempts = 0,
       sap_sync_next_retry_at = now()
 WHERE id = '5374c405-b7af-42c9-a9c7-07001365c258';

UPDATE public.sap_retry_queue
   SET next_attempt_at = now(),
       attempts = 0,
       last_error = NULL,
       updated_at = now()
 WHERE ref_id = '5374c405-b7af-42c9-a9c7-07001365c258'
   AND status = 'pending';