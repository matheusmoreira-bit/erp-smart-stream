update public.expenses
set current_approver = 'Artur Angelo',
    approval_rule_id = '97e148b1-7d8d-484f-a081-f0b58bc544fe',
    current_level_order = 1,
    updated_at = now()
where id = 'c42f69c5-8dcb-46fc-a557-10f7c7e7b069'
  and status = 'pendente_aprovacao';