ALTER TABLE public.sap_purchase_order_cache ADD COLUMN IF NOT EXISTS comments text;

CREATE INDEX IF NOT EXISTS idx_po_cache_company_comments_code
  ON public.sap_purchase_order_cache (company_db, upper(left(comments, 8)));

CREATE OR REPLACE FUNCTION public.detect_duplicate_sap_purchase_orders(_days integer DEFAULT 60)
RETURNS TABLE (
  company_db text,
  expense_code text,
  card_code text,
  doc_total numeric,
  doc_count bigint,
  doc_nums text,
  doc_entries text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    c.company_db,
    upper(left(c.comments, 8)) AS expense_code,
    min(c.card_code) AS card_code,
    max(c.doc_total) AS doc_total,
    count(*) AS doc_count,
    string_agg(c.doc_num::text, ', ' ORDER BY c.doc_entry) AS doc_nums,
    string_agg(c.doc_entry::text, ', ' ORDER BY c.doc_entry) AS doc_entries
  FROM public.sap_purchase_order_cache c
  WHERE auth.uid() IS NOT NULL
    AND c.comments IS NOT NULL
    AND upper(left(c.comments, 8)) ~ '^[0-9A-F]{8}$'
    AND coalesce(lower(c.cancelled), 'tno') = 'tno'
    AND c.doc_date >= (current_date - make_interval(days => greatest(_days, 1)))
  GROUP BY c.company_db, upper(left(c.comments, 8))
  HAVING count(*) > 1
  ORDER BY count(*) DESC, 1, 2
$$;

REVOKE ALL ON FUNCTION public.detect_duplicate_sap_purchase_orders(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_duplicate_sap_purchase_orders(integer) TO authenticated, service_role;