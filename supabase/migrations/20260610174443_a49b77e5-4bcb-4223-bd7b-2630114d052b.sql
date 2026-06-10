GRANT SELECT ON public.pagcorp_nondeductible_cards TO anon;

DROP POLICY IF EXISTS "Authenticated can read nondeductible cards" ON public.pagcorp_nondeductible_cards;

CREATE POLICY "Anyone can read nondeductible cards"
  ON public.pagcorp_nondeductible_cards FOR SELECT
  TO anon, authenticated USING (true);