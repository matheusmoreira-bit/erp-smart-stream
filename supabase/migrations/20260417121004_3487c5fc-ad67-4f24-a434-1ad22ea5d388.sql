CREATE POLICY "Anon can insert approval_rules" ON public.approval_rules FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update approval_rules" ON public.approval_rules FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete approval_rules" ON public.approval_rules FOR DELETE TO anon USING (true);
CREATE POLICY "Anon can read approval_rules" ON public.approval_rules FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can insert approval_rules" ON public.approval_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update approval_rules" ON public.approval_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete approval_rules" ON public.approval_rules FOR DELETE TO authenticated USING (true);

CREATE POLICY "Anon can insert approval_rule_levels" ON public.approval_rule_levels FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update approval_rule_levels" ON public.approval_rule_levels FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete approval_rule_levels" ON public.approval_rule_levels FOR DELETE TO anon USING (true);
CREATE POLICY "Anon can read approval_rule_levels" ON public.approval_rule_levels FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can insert approval_rule_levels" ON public.approval_rule_levels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update approval_rule_levels" ON public.approval_rule_levels FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete approval_rule_levels" ON public.approval_rule_levels FOR DELETE TO authenticated USING (true);