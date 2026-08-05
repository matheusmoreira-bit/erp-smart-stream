UPDATE public.expenses
SET approval_rule_id = 'dcd8c96c-a75e-4efc-9bf5-22bc5f2b11d7',
    current_approver = 'Felipe Coelho',
    current_level_order = 1,
    updated_at = now()
WHERE id IN (
  'a38f5bf9-ed6d-4989-a260-98a6dfc0f479',
  'f17aeabe-4d84-4b3e-bfdd-a9b91c5786de',
  '39936b8d-781b-4f2d-933b-65316e9e88a3'
)
AND status = 'pendente_aprovacao';

INSERT INTO public.expense_approval_log (expense_id, decision, approver_name, approver_email, level_order, remarks)
SELECT id, 'submitted', 'sistema', NULL, 1,
       'Roteamento reprocessado: regra "1.12 PRODUTOS | 1.12.1.1 | 0-100k" aplicada; aprovador corrigido de Juliana Gavineli (contingência da matriz) para Felipe Coelho.'
FROM public.expenses
WHERE id IN (
  'a38f5bf9-ed6d-4989-a260-98a6dfc0f479',
  'f17aeabe-4d84-4b3e-bfdd-a9b91c5786de',
  '39936b8d-781b-4f2d-933b-65316e9e88a3'
);