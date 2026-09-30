CREATE OR REPLACE FUNCTION public.get_legacy_po_chain(_expense_id uuid)
RETURNS TABLE(kind text, doc_entry integer, doc_num integer, doc_date date, due_date date, card_code text, card_name text, total numeric, paid numeric, status text, invoice_doc_entry integer, applied numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _company text; _po integer;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT e.company_db, e.sap_doc_entry INTO _company, _po
  FROM expenses e WHERE e.id = _expense_id AND e.sap_legacy_backup;
  IF _company IS NULL OR _po IS NULL THEN RETURN; END IF;
  IF NOT (has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
      SELECT 1 FROM user_company_access u
      WHERE lower(u.email) = lower(current_auth_email()) AND u.company_db = _company)) THEN
    RETURN;
  END IF;
  RETURN QUERY
  WITH nfs AS (
    SELECT a.* FROM sap_archive_documents a
    WHERE a.company_db = _company AND a.doc_type = 'purchase_invoices'
      AND EXISTS (SELECT 1 FROM jsonb_array_elements(a.payload->'DocumentLines') l
                  WHERE l->>'BaseType' = '22' AND (l->>'BaseEntry')::int = _po)
  )
  SELECT 'nf'::text, n.doc_entry, n.doc_num, n.doc_date, (n.payload->>'DocDueDate')::date, n.card_code, n.card_name,
         n.doc_total, (n.payload->>'PaidToDate')::numeric, n.doc_status, NULL::int, NULL::numeric
  FROM nfs n
  UNION ALL
  SELECT 'payment'::text, p.doc_entry, p.doc_num, p.doc_date, NULL::date, p.card_code, p.card_name,
         p.doc_total, NULL::numeric, p.doc_status, (pi->>'DocEntry')::int, (pi->>'SumApplied')::numeric
  FROM sap_archive_documents p
  CROSS JOIN LATERAL jsonb_array_elements(p.payload->'PaymentInvoices') pi
  WHERE p.company_db = _company AND p.doc_type = 'vendor_payments'
    AND pi->>'InvoiceType' = 'it_PurchaseInvoice'
    AND (pi->>'DocEntry')::int IN (SELECT doc_entry FROM nfs);
END $$;
REVOKE ALL ON FUNCTION public.get_legacy_po_chain(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_legacy_po_chain(uuid) TO authenticated;