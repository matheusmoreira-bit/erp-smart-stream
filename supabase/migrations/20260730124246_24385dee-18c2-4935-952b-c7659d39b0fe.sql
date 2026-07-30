UPDATE public.expenses
SET approval_rule_id = '69acc204-5596-4d1d-a22a-f9f9f4ec2400',
    current_approver = 'Jose Victor'
WHERE id = '866a0ad7-1e66-43f2-ba08-d3793609ea5b'
  AND status = 'pendente_aprovacao';