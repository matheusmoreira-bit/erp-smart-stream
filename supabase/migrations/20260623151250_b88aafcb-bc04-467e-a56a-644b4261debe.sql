
UPDATE public.expenses
SET status = 'cancelado',
    sap_integration_error = 'Cancelado no ERP Flow: pedido já criado manualmente no SAP',
    updated_at = now()
WHERE id IN (
  'a81a7237-dc75-45f3-84a5-15cf92de95ed',
  '07df83c2-06cf-4a06-8286-a604821af8b5'
);

SELECT public.insert_audit_log(
  'expense_cancelled_manual_sap',
  'expense',
  id::text,
  NULL,
  company_db,
  jsonb_build_object('reason','Pedido criado manualmente no SAP — removido do ERP Flow','supplier',supplier_name,'amount',total_amount)
)
FROM public.expenses
WHERE id IN (
  'a81a7237-dc75-45f3-84a5-15cf92de95ed',
  '07df83c2-06cf-4a06-8286-a604821af8b5'
);
