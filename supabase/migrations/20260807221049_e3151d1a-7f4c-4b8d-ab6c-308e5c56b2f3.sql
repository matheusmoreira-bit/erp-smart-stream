ALTER TABLE public.expense_approval_segments
  ADD COLUMN IF NOT EXISTS resolution text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS rule_name text,
  ADD COLUMN IF NOT EXISTS fallback_branch text,
  ADD COLUMN IF NOT EXISTS fallback_from_rule_id uuid,
  ADD COLUMN IF NOT EXISTS fallback_from_rule_name text,
  ADD COLUMN IF NOT EXISTS resolution_note text;

ALTER TABLE public.expense_approval_log DROP CONSTRAINT IF EXISTS expense_approval_log_decision_check;
ALTER TABLE public.expense_approval_log ADD CONSTRAINT expense_approval_log_decision_check
  CHECK (decision = ANY (ARRAY['approved','rejected','submitted','created','cancelled','reactivated','integrated','integration_failed','routing_fallback']));