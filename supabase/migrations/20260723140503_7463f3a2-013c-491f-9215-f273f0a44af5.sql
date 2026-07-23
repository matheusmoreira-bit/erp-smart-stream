UPDATE public.expenses 
SET doc_date = CURRENT_DATE, 
    due_date = CURRENT_DATE + INTERVAL '9 days',
    sap_integration_error = NULL,
    sap_purchase_order_status = NULL,
    sap_sync_next_retry_at = NULL,
    sap_integration_locked_at = NULL
WHERE id='d06797a1-095c-4a28-85b7-858d3822120a';