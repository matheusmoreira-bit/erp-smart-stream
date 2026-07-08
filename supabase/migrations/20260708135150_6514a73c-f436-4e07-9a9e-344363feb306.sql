
UPDATE public.expense_items
SET project = 'OPEN GAMING'
WHERE expense_id = '12a172ac-f440-4cac-b62c-f00099011c5d'
  AND (project IS NULL OR project = '');
