
DROP POLICY IF EXISTS "Read finalized approval log" ON public.expense_approval_log;
REVOKE SELECT ON public.expense_approval_log FROM anon;
