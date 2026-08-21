-- Repara ambientes em que a edge de despesas foi publicada antes das colunas
-- de revisão. A operação é idempotente e mantém compatibilidade com versões
-- anteriores da função enquanto o deploy converge para o código atual.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS revision_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS revision_note text;

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_revision_number_positive;
ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_revision_number_positive CHECK (revision_number >= 1);

NOTIFY pgrst, 'reload schema';