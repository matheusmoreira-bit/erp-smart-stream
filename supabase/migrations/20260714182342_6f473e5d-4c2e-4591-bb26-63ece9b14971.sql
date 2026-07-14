
UPDATE public.expenses
SET approval_rule_id = '924270ba-5b1f-4205-8453-b5552efcffbc',
    current_approver = 'Juliana Gavineli',
    current_level_order = 1,
    updated_at = now()
WHERE id = '0ee90247-a6a6-47d9-a485-0b9ab569058e';

INSERT INTO public.expense_approval_log (expense_id, level_order, approver_name, approver_email, decision, remarks, decided_at)
VALUES (
  '0ee90247-a6a6-47d9-a485-0b9ab569058e', 1,
  'Juliana Gavineli', 'juliana.gavineli@anagaming.com.br',
  'submitted',
  'Reprocessamento administrativo: regra anterior "1.80 INSTITUTO - AP1" (bb86cfc2) estava inativa e apontava para Gustavo Coelho. Aplicada regra ativa correta "1.80 INSTITUTO - AP1 a AP3" (924270ba) — nível 1: Juliana Gavineli.',
  now()
);
