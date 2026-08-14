ALTER TABLE public.nf_entrada_imports
  ADD COLUMN IF NOT EXISTS sap_matched_po_doc_num text,
  ADD COLUMN IF NOT EXISTS erp_invoice_doc_num text;

UPDATE public.nf_entrada_imports i
SET sap_matched_po_doc_num = c.doc_num::text
FROM public.sap_purchase_order_cache c
WHERE i.sap_matched_po_doc_num IS NULL
  AND i.sap_matched_po_is_draft IS DISTINCT FROM true
  AND i.sap_matched_po_doc_entry IS NOT NULL
  AND c.company_db = i.sap_company_db
  AND c.doc_entry = NULLIF(regexp_replace(i.sap_matched_po_doc_entry, '\D', '', 'g'), '')::int;

UPDATE public.nf_entrada_imports i
SET erp_invoice_doc_num = c.doc_num::text
FROM public.sap_nf_entrada_cache c
WHERE i.erp_invoice_doc_num IS NULL
  AND i.erp_invoice_doc_entry IS NOT NULL
  AND c.company_db = i.sap_company_db
  AND c.doc_entry = NULLIF(regexp_replace(i.erp_invoice_doc_entry::text, '\D', '', 'g'), '')::int;