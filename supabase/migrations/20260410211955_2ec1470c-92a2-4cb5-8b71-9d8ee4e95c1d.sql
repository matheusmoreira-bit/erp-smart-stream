
CREATE POLICY "Anon can insert pagcorp_item_mapping" ON public.pagcorp_item_mapping
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon can update pagcorp_item_mapping" ON public.pagcorp_item_mapping
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Anon can delete pagcorp_item_mapping" ON public.pagcorp_item_mapping
  FOR DELETE TO anon USING (true);
