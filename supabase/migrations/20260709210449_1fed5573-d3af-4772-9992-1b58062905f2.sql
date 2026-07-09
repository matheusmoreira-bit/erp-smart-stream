CREATE TABLE public.nf_entrada_contas_pagar (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nf_import_id UUID NOT NULL REFERENCES public.nf_entrada_imports(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('sap','omie')),
  company_db TEXT NOT NULL,
  ap_doc_entry TEXT NOT NULL,
  ap_doc_num TEXT,
  ap_total NUMERIC(18,4),
  ap_paid NUMERIC(18,4),
  ap_currency TEXT,
  linked_by TEXT,
  notes TEXT,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nf_import_id, source, ap_doc_entry)
);

CREATE INDEX idx_nf_ap_nf_import ON public.nf_entrada_contas_pagar(nf_import_id);
CREATE INDEX idx_nf_ap_company_doc ON public.nf_entrada_contas_pagar(company_db, ap_doc_entry);

GRANT SELECT ON public.nf_entrada_contas_pagar TO authenticated;
GRANT ALL ON public.nf_entrada_contas_pagar TO service_role;

ALTER TABLE public.nf_entrada_contas_pagar ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read nf_ap links"
  ON public.nf_entrada_contas_pagar FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER update_nf_entrada_contas_pagar_updated_at
  BEFORE UPDATE ON public.nf_entrada_contas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.nf_entrada_imports
  ADD COLUMN IF NOT EXISTS settlement_ap_count INTEGER NOT NULL DEFAULT 0;
