ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_terms_code text,
  ADD COLUMN IF NOT EXISTS payment_terms_name text;
