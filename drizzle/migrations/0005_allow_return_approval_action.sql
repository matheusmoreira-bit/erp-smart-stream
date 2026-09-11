ALTER TABLE public.expense_approval_log DROP CONSTRAINT IF EXISTS expense_approval_log_decision_check;
ALTER TABLE public.expense_approval_log ADD CONSTRAINT expense_approval_log_decision_check CHECK (decision = ANY (ARRAY['approved'::text,'rejected'::text,'returned'::text,'submitted'::text,'created'::text,'cancelled'::text,'reactivated'::text,'integrated'::text,'integration_failed'::text,'routing_fallback'::text,'edited'::text]));
ALTER TABLE public.expense_audit_log DROP CONSTRAINT IF EXISTS expense_audit_log_action_check;
ALTER TABLE public.expense_audit_log ADD CONSTRAINT expense_audit_log_action_check CHECK (action = ANY (ARRAY['approve'::text,'reject'::text,'return'::text]));
ALTER TABLE public.expense_audit_log DROP CONSTRAINT IF EXISTS expense_audit_log_decision_check;
ALTER TABLE public.expense_audit_log ADD CONSTRAINT expense_audit_log_decision_check CHECK (decision = ANY (ARRAY['approved'::text,'rejected'::text,'returned'::text]));