
CREATE TABLE public.sap_nf_entrada_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  doc_entry INTEGER NOT NULL,
  doc_num INTEGER,
  series INTEGER,
  card_code TEXT,
  card_name TEXT,
  doc_date DATE,
  doc_due_date DATE,
  tax_date DATE,
  doc_total NUMERIC(18,4),
  doc_currency TEXT,
  document_status TEXT,
  cancelled TEXT,
  base_po_doc_entry INTEGER,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sap_update_date TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, doc_entry)
);

CREATE INDEX idx_sap_nf_cache_company ON public.sap_nf_entrada_cache(company_db);
CREATE INDEX idx_sap_nf_cache_base_po ON public.sap_nf_entrada_cache(company_db, base_po_doc_entry) WHERE base_po_doc_entry IS NOT NULL;
CREATE INDEX idx_sap_nf_cache_card ON public.sap_nf_entrada_cache(company_db, card_code);
CREATE INDEX idx_sap_nf_cache_update ON public.sap_nf_entrada_cache(company_db, sap_update_date DESC);

GRANT SELECT ON public.sap_nf_entrada_cache TO authenticated;
GRANT ALL ON public.sap_nf_entrada_cache TO service_role;
ALTER TABLE public.sap_nf_entrada_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read NF cache"
  ON public.sap_nf_entrada_cache FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_sap_nf_entrada_cache_updated_at
  BEFORE UPDATE ON public.sap_nf_entrada_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.sap_nf_entrada_sync_state (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL UNIQUE,
  last_update_date TIMESTAMPTZ,
  last_doc_entry INTEGER,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  last_batch_count INTEGER DEFAULT 0,
  total_synced BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sap_nf_entrada_sync_state TO authenticated;
GRANT ALL ON public.sap_nf_entrada_sync_state TO service_role;
ALTER TABLE public.sap_nf_entrada_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read NF sync state"
  ON public.sap_nf_entrada_sync_state FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_sap_nf_entrada_sync_state_updated_at
  BEFORE UPDATE ON public.sap_nf_entrada_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
