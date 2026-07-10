
-- 1. sap_purchase_order_cache
CREATE TABLE public.sap_purchase_order_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  doc_entry integer NOT NULL,
  doc_num integer,
  series integer,
  card_code text,
  card_name text,
  doc_date date,
  doc_due_date date,
  doc_total numeric(18,4),
  doc_total_fc numeric(18,4),
  doc_currency text,
  document_status text,
  cancelled text,
  sap_update_date timestamptz,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, doc_entry)
);
CREATE INDEX idx_sap_po_cache_company ON public.sap_purchase_order_cache(company_db);
CREATE INDEX idx_sap_po_cache_card ON public.sap_purchase_order_cache(company_db, card_code);
CREATE INDEX idx_sap_po_cache_update ON public.sap_purchase_order_cache(company_db, sap_update_date DESC);
CREATE INDEX idx_sap_po_cache_docnum ON public.sap_purchase_order_cache(company_db, doc_num);

GRANT SELECT ON public.sap_purchase_order_cache TO authenticated;
GRANT ALL ON public.sap_purchase_order_cache TO service_role;

ALTER TABLE public.sap_purchase_order_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read PO cache"
  ON public.sap_purchase_order_cache FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_sap_po_cache_updated_at
  BEFORE UPDATE ON public.sap_purchase_order_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. sap_purchase_order_sync_state
CREATE TABLE public.sap_purchase_order_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL UNIQUE,
  last_update_date timestamptz,
  last_doc_entry integer,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_batch_count integer DEFAULT 0,
  total_synced bigint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sap_purchase_order_sync_state TO authenticated;
GRANT ALL ON public.sap_purchase_order_sync_state TO service_role;
ALTER TABLE public.sap_purchase_order_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read PO sync state"
  ON public.sap_purchase_order_sync_state FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER update_sap_po_sync_state_updated_at
  BEFORE UPDATE ON public.sap_purchase_order_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. sap_vendor_payment_cache
CREATE TABLE public.sap_vendor_payment_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  doc_entry integer NOT NULL,
  doc_num integer,
  series integer,
  card_code text,
  card_name text,
  doc_date date,
  doc_total numeric(18,4),
  doc_total_fc numeric(18,4),
  doc_currency text,
  document_status text,
  cancelled text,
  invoice_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  sap_update_date timestamptz,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, doc_entry)
);
CREATE INDEX idx_sap_vpay_cache_company ON public.sap_vendor_payment_cache(company_db);
CREATE INDEX idx_sap_vpay_cache_card ON public.sap_vendor_payment_cache(company_db, card_code);
CREATE INDEX idx_sap_vpay_cache_update ON public.sap_vendor_payment_cache(company_db, sap_update_date DESC);
CREATE INDEX idx_sap_vpay_cache_links ON public.sap_vendor_payment_cache USING gin (invoice_links);

GRANT SELECT ON public.sap_vendor_payment_cache TO authenticated;
GRANT ALL ON public.sap_vendor_payment_cache TO service_role;
ALTER TABLE public.sap_vendor_payment_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read vendor payment cache"
  ON public.sap_vendor_payment_cache FOR SELECT TO authenticated USING (true);
CREATE TRIGGER update_sap_vpay_cache_updated_at
  BEFORE UPDATE ON public.sap_vendor_payment_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. sap_vendor_payment_sync_state
CREATE TABLE public.sap_vendor_payment_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL UNIQUE,
  last_update_date timestamptz,
  last_doc_entry integer,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_batch_count integer DEFAULT 0,
  total_synced bigint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.sap_vendor_payment_sync_state TO authenticated;
GRANT ALL ON public.sap_vendor_payment_sync_state TO service_role;
ALTER TABLE public.sap_vendor_payment_sync_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read vendor payment sync state"
  ON public.sap_vendor_payment_sync_state FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER update_sap_vpay_sync_state_updated_at
  BEFORE UPDATE ON public.sap_vendor_payment_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. pagcorp_document_relations
CREATE TABLE public.pagcorp_document_relations (
  pagcorp_log_id uuid PRIMARY KEY REFERENCES public.pagcorp_integration_log(id) ON DELETE CASCADE,
  company_db text,
  po_doc_entry integer,
  po_doc_num integer,
  po_status text,
  po_total numeric(18,4),
  po_total_fc numeric(18,4),
  po_currency text,
  nf_doc_entries integer[] NOT NULL DEFAULT '{}',
  payment_doc_entries integer[] NOT NULL DEFAULT '{}',
  po_found boolean NOT NULL DEFAULT false,
  nf_found boolean NOT NULL DEFAULT false,
  payment_found boolean NOT NULL DEFAULT false,
  amount_matches boolean,
  last_resolved_at timestamptz,
  resolve_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pagcorp_relations_company ON public.pagcorp_document_relations(company_db);
CREATE INDEX idx_pagcorp_relations_po ON public.pagcorp_document_relations(company_db, po_doc_entry);
CREATE INDEX idx_pagcorp_relations_resolved ON public.pagcorp_document_relations(last_resolved_at NULLS FIRST);

GRANT SELECT ON public.pagcorp_document_relations TO authenticated;
GRANT ALL ON public.pagcorp_document_relations TO service_role;
ALTER TABLE public.pagcorp_document_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read pagcorp relations"
  ON public.pagcorp_document_relations FOR SELECT TO authenticated USING (true);
CREATE TRIGGER update_pagcorp_relations_updated_at
  BEFORE UPDATE ON public.pagcorp_document_relations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
