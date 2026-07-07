
UPDATE public.expenses
SET sap_doc_entry = 7,
    sap_doc_num = NULL,
    sap_sync_state = 'ok',
    sap_sync_attempts = 0,
    sap_sync_next_retry_at = NULL
WHERE id = 'e7f1ecff-0c39-49dc-b97f-3d2f82a1b479';

INSERT INTO public.expense_approval_log (
  expense_id, decision, approver_name, approver_email, remarks, decided_at
) VALUES (
  'e7f1ecff-0c39-49dc-b97f-3d2f82a1b479',
  'integrated',
  'Sistema (correção manual)',
  'system@lovable',
  'Pedido de compra equivalente no SAP realocado de DocEntry 69 (DocNum 14) para DocEntry 7. Motivo: o pedido foi lançado em duplicidade no SAP; DocEntry 69 é o duplicado e DocEntry 7 é o registro correto.',
  now()
);
