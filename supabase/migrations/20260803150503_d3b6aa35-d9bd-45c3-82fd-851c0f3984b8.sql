UPDATE public.expenses
SET approval_rule_id = 'e8caf14e-215a-4fbd-bea1-8b02021572c5',
    current_approver = 'Santiago Macedo',
    current_level_order = 1,
    updated_at = now()
WHERE id = '21cae8b6-121c-4c38-9483-f73fd76eb8f8'
  AND status = 'pendente_aprovacao';