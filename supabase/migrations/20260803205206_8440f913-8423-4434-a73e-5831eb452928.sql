UPDATE public.expenses
SET current_approver = 'Santiago Macedo',
    approval_rule_id = 'c0107bcf-904c-4926-97ad-54b7b1b71b48',
    updated_at = now()
WHERE id = '68ce1f8c-959f-4379-a762-1d61c11369e4'
  AND status = 'pendente_aprovacao';

INSERT INTO public.expense_approval_log (expense_id, decision, approver_name, approver_email, level_order, remarks)
VALUES ('68ce1f8c-959f-4379-a762-1d61c11369e4', 'submitted', 'Sistema', NULL, 1,
  'Auto-aprovação evitada: solicitante era o aprovador da faixa 0-10k — escalonado para a faixa superior (10k-300k) → Santiago Macedo.');