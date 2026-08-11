UPDATE public.approval_rule_levels
   SET approver_name = 'Ketlhenn Monteiro'
 WHERE approver_email ILIKE 'ketlhenn.monteiro@%'
   AND approver_name <> 'Ketlhenn Monteiro';

UPDATE public.expenses
   SET current_approver = 'Ketlhenn Monteiro'
 WHERE current_approver ILIKE 'Kethlenn Monteiro';

UPDATE public.expenses
   SET original_approver = 'Ketlhenn Monteiro'
 WHERE original_approver ILIKE 'Kethlenn Monteiro';

UPDATE public.expense_approval_segments
   SET current_approver = 'Ketlhenn Monteiro'
 WHERE current_approver ILIKE 'Kethlenn Monteiro';