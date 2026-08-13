ALTER TABLE public.nf_entrada_imports
  ADD COLUMN IF NOT EXISTS cnpj_destinatario text,
  ADD COLUMN IF NOT EXISTS nome_destinatario text;

UPDATE public.nf_entrada_imports
SET cnpj_destinatario = COALESCE(cnpj_destinatario, regexp_replace(COALESCE(raw_mastertax->>'tomadorDocumento',''), '\D', '', 'g')),
    nome_destinatario = COALESCE(nome_destinatario, NULLIF(raw_mastertax->>'tomadorNome',''))
WHERE raw_mastertax IS NOT NULL;

UPDATE public.nf_entrada_imports SET cnpj_destinatario = NULL WHERE cnpj_destinatario = '';

CREATE INDEX IF NOT EXISTS nf_entrada_imports_company_idx ON public.nf_entrada_imports (sap_company_db, created_at DESC);
CREATE INDEX IF NOT EXISTS nf_entrada_imports_dest_idx ON public.nf_entrada_imports (cnpj_destinatario);