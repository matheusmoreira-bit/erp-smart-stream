
-- Allow authenticated users to write to the shared external-data cache.
CREATE POLICY "Authenticated can insert sap_cache"
  ON public.sap_cache FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update sap_cache"
  ON public.sap_cache FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete sap_cache"
  ON public.sap_cache FOR DELETE TO authenticated
  USING (true);
