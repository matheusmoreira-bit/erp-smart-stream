
CREATE OR REPLACE FUNCTION public.get_nf_entrada_cache_by_po(_company_db text, _po_doc_entry integer)
RETURNS TABLE(
  doc_entry integer,
  doc_num integer,
  series integer,
  card_code text,
  card_name text,
  doc_date date,
  doc_due_date date,
  doc_total numeric,
  doc_currency text,
  document_status text,
  cancelled text,
  sap_update_date timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT doc_entry, doc_num, series, card_code, card_name, doc_date, doc_due_date,
         doc_total, doc_currency, document_status, cancelled, sap_update_date
  FROM public.sap_nf_entrada_cache
  WHERE company_db = _company_db
    AND base_po_doc_entry = _po_doc_entry
  ORDER BY doc_entry DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_nf_entrada_cache_by_po(text, integer) TO authenticated;
