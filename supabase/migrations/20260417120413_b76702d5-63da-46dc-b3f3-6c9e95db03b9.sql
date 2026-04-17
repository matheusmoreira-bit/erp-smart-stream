-- Allow anon role to create/update expenses and items (app uses SAP session, not Supabase auth)
CREATE POLICY "Anon can insert expenses" ON public.expenses FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update expenses" ON public.expenses FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can insert expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update expenses" ON public.expenses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anon can insert expense_items" ON public.expense_items FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can read expense_items" ON public.expense_items FOR SELECT TO anon USING (true);
CREATE POLICY "Anon can update expense_items" ON public.expense_items FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete expense_items" ON public.expense_items FOR DELETE TO anon USING (true);
CREATE POLICY "Authenticated can insert expense_items" ON public.expense_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update expense_items" ON public.expense_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete expense_items" ON public.expense_items FOR DELETE TO authenticated USING (true);

CREATE POLICY "Anon can insert expense_attachments" ON public.expense_attachments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can read expense_attachments" ON public.expense_attachments FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can insert expense_attachments" ON public.expense_attachments FOR INSERT TO authenticated WITH CHECK (true);

-- Read access for expenses to anon (already authenticated has it)
CREATE POLICY "Anon can read expenses" ON public.expenses FOR SELECT TO anon USING (true);