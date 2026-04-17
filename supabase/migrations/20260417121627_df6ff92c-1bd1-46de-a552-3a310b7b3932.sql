-- Add cancelado status
ALTER TYPE public.expense_status ADD VALUE IF NOT EXISTS 'cancelado';

-- Add new columns to expenses
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS created_by_email TEXT,
  ADD COLUMN IF NOT EXISTS company_db TEXT;

CREATE INDEX IF NOT EXISTS idx_expenses_status ON public.expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_company_db ON public.expenses(company_db);
CREATE INDEX IF NOT EXISTS idx_expenses_origin ON public.expenses(origin);