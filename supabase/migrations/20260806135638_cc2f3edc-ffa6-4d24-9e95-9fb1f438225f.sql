DELETE FROM public.approval_rule_levels WHERE rule_id = '457a807e-8b6b-426c-ad1f-a4d20d5316af';

INSERT INTO public.approval_rule_levels (rule_id, level_order, approver_name, approver_email) VALUES
  ('457a807e-8b6b-426c-ad1f-a4d20d5316af', 1, 'Diogo Faria', 'diogo.faria@anagaming.com.br'),
  ('457a807e-8b6b-426c-ad1f-a4d20d5316af', 1, 'Santiago Macedo', 'santiago.macedo@opengaming.com.br'),
  ('457a807e-8b6b-426c-ad1f-a4d20d5316af', 2, 'Marco Tulio', 'marco.tulio@anagaming.com.br');

UPDATE public.expenses
   SET current_approver = NULL,
       original_approver = NULL,
       current_level_order = 1,
       updated_at = now()
 WHERE id = '2ab81dc0-0617-415b-8410-d9af556408ff';