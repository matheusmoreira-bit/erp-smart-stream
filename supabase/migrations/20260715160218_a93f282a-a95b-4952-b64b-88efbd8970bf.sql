
-- Permitir leitura anônima (usuários com sessão SAP mas sem sessão cloud auth)
-- para as tabelas do módulo de Automações, alinhando com o padrão já usado em
-- expenses/suppliers/etc.

GRANT SELECT ON public.synapse_integrations TO anon;
GRANT SELECT ON public.synapse_execution_log TO anon;
GRANT SELECT ON public.synapse_global_settings TO anon;

CREATE POLICY "Anon can read synapse_integrations"
  ON public.synapse_integrations FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can read synapse_execution_log"
  ON public.synapse_execution_log FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can read synapse_global_settings"
  ON public.synapse_global_settings FOR SELECT TO anon USING (true);
