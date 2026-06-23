
UPDATE public.expenses
SET status = 'cancelado',
    sap_integration_error = 'Cancelado no ERP Flow: pedido já criado manualmente no SAP',
    updated_at = now()
WHERE id IN (
  '7ebb14dc-4454-4cf3-9906-07f5e266a767',
  '7a5fd4d9-9de6-446a-b74e-9ace928bbbf3',
  'd7a804eb-30ea-4fae-ae5f-bacba8f32f06'
);

SELECT public.insert_audit_log(
  'expense_cancelled_manual_sap',
  'expense',
  id::text,
  NULL,
  'SBO_CACTUS',
  jsonb_build_object('reason','Pedido criado manualmente no SAP — removido do ERP Flow','supplier',supplier_name,'amount',total_amount)
)
FROM public.expenses
WHERE id IN (
  '7ebb14dc-4454-4cf3-9906-07f5e266a767',
  '7a5fd4d9-9de6-446a-b74e-9ace928bbbf3',
  'd7a804eb-30ea-4fae-ae5f-bacba8f32f06'
);
