UPDATE public.synapse_integrations
SET parameters = COALESCE(parameters, '{}'::jsonb) || jsonb_build_object('upload_receipts', 'true')
WHERE integration_key = 'pagcorp_erp_sync'
  AND NOT (parameters ? 'upload_receipts');