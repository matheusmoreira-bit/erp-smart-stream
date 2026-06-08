GRANT SELECT ON public.expenses TO anon;

DROP POLICY IF EXISTS "Anon can read expenses" ON public.expenses;
CREATE POLICY "Anon can read expenses"
ON public.expenses
FOR SELECT
TO anon
USING (true);