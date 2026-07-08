
UPDATE public.expenses
SET status = 'aprovado',
    updated_at = now()
WHERE id = '12a172ac-f440-4cac-b62c-f00099011c5d'
  AND status = 'pendente_aprovacao';

INSERT INTO public.expense_audit_log (expense_id, action, decision, level_order, actor_identity, actor_source, company_db, remarks)
VALUES ('12a172ac-f440-4cac-b62c-f00099011c5d', 'approve', 'approved', 1, 'system:reconciliation', 'cloud_admin', 'open_gaming_sa', 'Aprovação já registrada em 2026-07-07 por ketlhenn.monteiro; status estava travado em pendente_aprovacao por falha de integração SAP. Marcado como aprovado após desacoplar aprovação da integração.');
