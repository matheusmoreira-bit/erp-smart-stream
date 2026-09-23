CREATE TABLE public.pagcorp_settlement_candidate_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  po_doc_num text NOT NULL,
  nf_doc_nums text[] NOT NULL DEFAULT '{}',
  vendor_name text,
  amount numeric,
  first_notified_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (company_db, po_doc_num)
);
GRANT SELECT ON public.pagcorp_settlement_candidate_notices TO authenticated;
GRANT ALL ON public.pagcorp_settlement_candidate_notices TO service_role;
ALTER TABLE public.pagcorp_settlement_candidate_notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read pagcorp_settlement_candidate_notices" ON public.pagcorp_settlement_candidate_notices
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));