GRANT SELECT ON public.expense_approval_log TO anon, authenticated;
GRANT ALL ON public.expense_approval_log TO service_role;

DROP POLICY IF EXISTS "Read approval log of accessible expenses" ON public.expense_approval_log;

CREATE POLICY "Anon can read approval log"
ON public.expense_approval_log
FOR SELECT
TO anon
USING (true);

CREATE POLICY "Authenticated can read approval log"
ON public.expense_approval_log
FOR SELECT
TO authenticated
USING (true);