
-- Grants for anon
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expense_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO anon;
GRANT SELECT ON public.approval_rules TO anon;
GRANT SELECT ON public.approval_rule_levels TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sap_cache TO anon;

-- expense_items: anon CRUD
DROP POLICY IF EXISTS "Anon can read expense_items" ON public.expense_items;
CREATE POLICY "Anon can read expense_items" ON public.expense_items FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon can insert expense_items" ON public.expense_items;
CREATE POLICY "Anon can insert expense_items" ON public.expense_items FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can update expense_items" ON public.expense_items;
CREATE POLICY "Anon can update expense_items" ON public.expense_items FOR UPDATE TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can delete expense_items" ON public.expense_items;
CREATE POLICY "Anon can delete expense_items" ON public.expense_items FOR DELETE TO anon USING (true);

-- expenses: anon insert/update/delete (read already exists)
DROP POLICY IF EXISTS "Anon can insert expenses" ON public.expenses;
CREATE POLICY "Anon can insert expenses" ON public.expenses FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can update expenses" ON public.expenses;
CREATE POLICY "Anon can update expenses" ON public.expenses FOR UPDATE TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can delete expenses" ON public.expenses;
CREATE POLICY "Anon can delete expenses" ON public.expenses FOR DELETE TO anon USING (true);

-- approval_rules: anon read
DROP POLICY IF EXISTS "Anon can read approval_rules" ON public.approval_rules;
CREATE POLICY "Anon can read approval_rules" ON public.approval_rules FOR SELECT TO anon USING (true);

-- approval_rule_levels: anon read
DROP POLICY IF EXISTS "Anon can read approval_rule_levels" ON public.approval_rule_levels;
CREATE POLICY "Anon can read approval_rule_levels" ON public.approval_rule_levels FOR SELECT TO anon USING (true);

-- sap_cache: anon CRUD
DROP POLICY IF EXISTS "Anon can read sap_cache" ON public.sap_cache;
CREATE POLICY "Anon can read sap_cache" ON public.sap_cache FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "Anon can insert sap_cache" ON public.sap_cache;
CREATE POLICY "Anon can insert sap_cache" ON public.sap_cache FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can update sap_cache" ON public.sap_cache;
CREATE POLICY "Anon can update sap_cache" ON public.sap_cache FOR UPDATE TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Anon can delete sap_cache" ON public.sap_cache;
CREATE POLICY "Anon can delete sap_cache" ON public.sap_cache FOR DELETE TO anon USING (true);
