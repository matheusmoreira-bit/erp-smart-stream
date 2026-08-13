update public.expenses
set current_approver = 'Jose Victor',
    approval_rule_id = '1ee6138d-87d9-4b7c-9b9a-cb315fdefb79',
    current_level_order = 1,
    updated_at = now()
where id = 'a4ef57e9-0eb8-49b1-8791-83b53b34ebcf'
  and status = 'pendente_aprovacao';