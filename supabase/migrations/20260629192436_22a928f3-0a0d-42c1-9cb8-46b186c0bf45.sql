
CREATE POLICY "Authenticated can insert pagcorp_card_mapping"
  ON public.pagcorp_card_mapping FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update pagcorp_card_mapping"
  ON public.pagcorp_card_mapping FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete pagcorp_card_mapping"
  ON public.pagcorp_card_mapping FOR DELETE TO authenticated
  USING (true);
