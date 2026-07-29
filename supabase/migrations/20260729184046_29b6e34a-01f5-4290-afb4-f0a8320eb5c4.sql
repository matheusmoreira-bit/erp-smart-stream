ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS nfse_split_mode text NOT NULL DEFAULT 'unified';

ALTER TABLE public.expenses
  DROP CONSTRAINT IF EXISTS expenses_nfse_split_mode_check;

ALTER TABLE public.expenses
  ADD CONSTRAINT expenses_nfse_split_mode_check
  CHECK (nfse_split_mode IN ('unified', 'per_brand'));