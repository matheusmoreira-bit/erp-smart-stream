REVOKE EXECUTE ON FUNCTION public.is_employee_sync_company_allowed(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.canonical_user_key(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonicalize_sap_email() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.business_hours_deadline(timestamp with time zone, integer) FROM anon;

REVOKE EXECUTE ON FUNCTION public._audit_guard() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._audit_canonicalize(jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auditoria_cf_touch() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_nf_entrada_cache_by_po(_company_db text, _po_doc_entry integer)
RETURNS TABLE(doc_entry integer, doc_num integer, series integer, card_code text, card_name text, doc_date date, doc_due_date date, doc_total numeric, paid_to_date numeric, doc_currency text, document_status text, cancelled text, sap_update_date timestamp with time zone)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT doc_entry, doc_num, series, card_code, card_name, doc_date, doc_due_date,
         doc_total, paid_to_date, doc_currency, document_status, cancelled, sap_update_date
  FROM public.sap_nf_entrada_cache
  WHERE company_db = _company_db
    AND base_po_doc_entry = _po_doc_entry
    AND auth.uid() IS NOT NULL
  ORDER BY doc_entry DESC;
$function$;