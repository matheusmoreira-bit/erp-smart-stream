UPDATE public.expenses
SET current_approver = 'Gustavo Coelho',
    current_level_order = 2
WHERE id = '87c4fca7-e578-49fc-8b81-2a21afe4d41d'
  AND status = 'pendente_aprovacao';