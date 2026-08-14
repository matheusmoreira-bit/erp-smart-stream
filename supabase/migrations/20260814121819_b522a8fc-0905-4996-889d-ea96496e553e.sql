ALTER TABLE public.nf_entrada_imports DROP CONSTRAINT IF EXISTS nf_entrada_imports_chave_acesso_key;
CREATE UNIQUE INDEX IF NOT EXISTS nf_entrada_imports_chave_company_uidx
  ON public.nf_entrada_imports (chave_acesso, sap_company_db);