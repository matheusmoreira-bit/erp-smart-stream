ALTER TABLE public.expense_audit_log
  ADD COLUMN IF NOT EXISTS segment_key text,
  ADD COLUMN IF NOT EXISTS track text,
  ADD COLUMN IF NOT EXISTS cost_center text,
  ADD COLUMN IF NOT EXISTS project text,
  ADD COLUMN IF NOT EXISTS rule_id uuid,
  ADD COLUMN IF NOT EXISTS rule_name text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS step text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_expense_audit_log_correlation ON public.expense_audit_log (correlation_id);
CREATE INDEX IF NOT EXISTS idx_expense_audit_log_expense_created ON public.expense_audit_log (expense_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_audit_log_track ON public.expense_audit_log (track);