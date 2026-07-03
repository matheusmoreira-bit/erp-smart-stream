GRANT SELECT ON public.nf_entrada_imports TO anon;
GRANT SELECT ON public.nf_entrada_logs TO anon;

CREATE POLICY "Anon read nf_entrada_imports"
  ON public.nf_entrada_imports FOR SELECT
  TO anon USING (true);

CREATE POLICY "Anon read nf_entrada_logs"
  ON public.nf_entrada_logs FOR SELECT
  TO anon USING (true);