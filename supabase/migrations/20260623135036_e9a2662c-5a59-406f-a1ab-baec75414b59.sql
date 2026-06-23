
-- Audit: revert 3 expenses lançadas no SAP sem aprovação (SBO_CACTUS, CC 1.80.1.8)
-- DocNums 1739/1740/1741 (DocEntry 4779/4781/4783)
UPDATE public.expenses
SET status = 'pendente_aprovacao',
    sap_doc_entry = NULL,
    sap_doc_num = NULL,
    sap_purchase_order_status = NULL,
    sap_attachment_entry = NULL,
    sap_attachment_status = NULL,
    sap_attachment_link_status = NULL,
    sap_integration_error = 'Revertido por auditoria: PC lançado sem passar por aprovação (CC 1.80.1.8 sem regra). Cancelar no SAP antes de re-integrar.',
    sap_integration_last_attempt_at = now(),
    current_approver = NULL,
    approval_rule_id = NULL,
    updated_at = now()
WHERE id IN (
  '7ebb14dc-4454-4cf3-9906-07f5e266a767',
  '7a5fd4d9-9de6-446a-b74e-9ace928bbbf3',
  'd7a804eb-30ea-4fae-ae5f-bacba8f32f06'
);

INSERT INTO public.expense_approval_log (expense_id, decision, approver_name, remarks)
SELECT id, 'cancelled', 'system-audit',
       'PC ' || sap_doc_num::text || ' revertido — bypass de aprovação detectado em auditoria'
FROM public.expenses
WHERE id IN (
  '7ebb14dc-4454-4cf3-9906-07f5e266a767',
  '7a5fd4d9-9de6-446a-b74e-9ace928bbbf3',
  'd7a804eb-30ea-4fae-ae5f-bacba8f32f06'
);

INSERT INTO public.audit_log (action, entity_type, entity_id, company_db, details)
VALUES
 ('expense_reverted_audit', 'expense', '7ebb14dc-4454-4cf3-9906-07f5e266a767', 'SBO_CACTUS',
  jsonb_build_object('doc_num',1741,'doc_entry',4783,'reason','bypass_approval_cc_sem_regra')),
 ('expense_reverted_audit', 'expense', '7a5fd4d9-9de6-446a-b74e-9ace928bbbf3', 'SBO_CACTUS',
  jsonb_build_object('doc_num',1740,'doc_entry',4781,'reason','bypass_approval_cc_sem_regra')),
 ('expense_reverted_audit', 'expense', 'd7a804eb-30ea-4fae-ae5f-bacba8f32f06', 'SBO_CACTUS',
  jsonb_build_object('doc_num',1739,'doc_entry',4779,'reason','bypass_approval_cc_sem_regra'));
