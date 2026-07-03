
-- Allow anon (used by custom SAP session) to write approval rules and levels,
-- matching the pattern already used on expenses/suppliers tables.
GRANT INSERT, UPDATE, DELETE ON public.approval_rules TO anon;
GRANT INSERT, UPDATE, DELETE ON public.approval_rule_levels TO anon;

CREATE POLICY "Anon can insert approval_rules"
  ON public.approval_rules FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update approval_rules"
  ON public.approval_rules FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete approval_rules"
  ON public.approval_rules FOR DELETE TO anon USING (true);

CREATE POLICY "Anon can insert approval_rule_levels"
  ON public.approval_rule_levels FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Anon can update approval_rule_levels"
  ON public.approval_rule_levels FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Anon can delete approval_rule_levels"
  ON public.approval_rule_levels FOR DELETE TO anon USING (true);

-- Also allow authenticated writes without requiring admin role,
-- matching expenses/suppliers pattern.
CREATE POLICY "Authenticated can insert approval_rules"
  ON public.approval_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update approval_rules"
  ON public.approval_rules FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete approval_rules"
  ON public.approval_rules FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated can insert approval_rule_levels"
  ON public.approval_rule_levels FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update approval_rule_levels"
  ON public.approval_rule_levels FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete approval_rule_levels"
  ON public.approval_rule_levels FOR DELETE TO authenticated USING (true);
