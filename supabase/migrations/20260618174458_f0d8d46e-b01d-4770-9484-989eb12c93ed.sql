
ALTER TABLE public.nf_entrada_imports
  ADD COLUMN IF NOT EXISTS sap_matched_po_doc_entry text,
  ADD COLUMN IF NOT EXISTS sap_matched_po_is_draft boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sap_matched_card_code text,
  ADD COLUMN IF NOT EXISTS sap_match_reason text;

CREATE INDEX IF NOT EXISTS idx_nf_entrada_matched_po
  ON public.nf_entrada_imports (sap_company_db, sap_matched_po_doc_entry);
