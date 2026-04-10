
CREATE POLICY "Anon can read pagcorp_account_mapping" ON public.pagcorp_account_mapping
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can insert pagcorp_account_mapping" ON public.pagcorp_account_mapping
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon can update pagcorp_account_mapping" ON public.pagcorp_account_mapping
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon can delete pagcorp_account_mapping" ON public.pagcorp_account_mapping
  FOR DELETE TO anon USING (true);
