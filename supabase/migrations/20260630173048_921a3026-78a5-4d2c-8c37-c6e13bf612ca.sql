-- Re-grant + re-create anon policies for expenses/expense_items
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_items TO anon;

DROP POLICY IF EXISTS "Anon can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can delete expenses" ON public.expenses;
CREATE POLICY "Anon can read expenses" ON public.expenses FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert expenses" ON public.expenses FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update expenses" ON public.expenses FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete expenses" ON public.expenses FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "Anon can read expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can insert expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can update expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can delete expense_items" ON public.expense_items;
CREATE POLICY "Anon can read expense_items" ON public.expense_items FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can insert expense_items" ON public.expense_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update expense_items" ON public.expense_items FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete expense_items" ON public.expense_items FOR DELETE TO anon USING (true);