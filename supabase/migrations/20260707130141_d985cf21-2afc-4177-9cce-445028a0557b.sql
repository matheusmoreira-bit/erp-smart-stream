ALTER TABLE public.expense_approval_log
  ADD COLUMN IF NOT EXISTS substituted_for_email text,
  ADD COLUMN IF NOT EXISTS substituted_for_name text,
  ADD COLUMN IF NOT EXISTS substitution_id uuid;

CREATE INDEX IF NOT EXISTS expense_approval_log_substituted_for_email_idx
  ON public.expense_approval_log (substituted_for_email);