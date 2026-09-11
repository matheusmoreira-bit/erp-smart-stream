ALTER TABLE public.sap_nf_entrada_cache
  ADD COLUMN IF NOT EXISTS sequence_serial text,
  ADD COLUMN IF NOT EXISTS series_string text,
  ADD COLUMN IF NOT EXISTS sub_series_string text,
  ADD COLUMN IF NOT EXISTS sequence_model text,
  ADD COLUMN IF NOT EXISTS folio_number text;

ALTER TABLE public.nf_entrada_imports
  ADD COLUMN IF NOT EXISTS modelo text,
  ADD COLUMN IF NOT EXISTS subserie text,
  ADD COLUMN IF NOT EXISTS auto_captured boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_nf_cache_company_base_po
  ON public.sap_nf_entrada_cache (company_db, base_po_doc_entry);