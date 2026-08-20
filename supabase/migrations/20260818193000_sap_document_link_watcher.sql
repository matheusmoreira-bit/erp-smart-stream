CREATE TABLE IF NOT EXISTS public.sap_document_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  source_type text NOT NULL,
  source_doc_entry integer NOT NULL,
  source_doc_num text,
  target_type text NOT NULL,
  target_doc_entry integer NOT NULL,
  target_doc_num text,
  relation_type text NOT NULL,
  confidence text NOT NULL DEFAULT 'exact',
  amount numeric(19,4),
  currency text,
  relation_date date,
  detected_by text NOT NULL DEFAULT 'sap-document-link-watcher',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, source_type, source_doc_entry, target_type, target_doc_entry, relation_type)
);

CREATE INDEX IF NOT EXISTS sap_document_relations_source_idx
  ON public.sap_document_relations (company_db, source_type, source_doc_entry);

CREATE INDEX IF NOT EXISTS sap_document_relations_target_idx
  ON public.sap_document_relations (company_db, target_type, target_doc_entry);

CREATE INDEX IF NOT EXISTS sap_document_relations_type_seen_idx
  ON public.sap_document_relations (relation_type, last_seen_at DESC);

GRANT SELECT ON public.sap_document_relations TO authenticated;
GRANT ALL ON public.sap_document_relations TO service_role;

ALTER TABLE public.sap_document_relations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read sap document relations" ON public.sap_document_relations;
CREATE POLICY "Authenticated can read sap document relations"
  ON public.sap_document_relations FOR SELECT
  TO authenticated
  USING (true);

DROP TRIGGER IF EXISTS update_sap_document_relations_updated_at ON public.sap_document_relations;
CREATE TRIGGER update_sap_document_relations_updated_at
  BEFORE UPDATE ON public.sap_document_relations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.sales_order_invoices
  ADD COLUMN IF NOT EXISTS sap_incoming_payment_doc_entry integer,
  ADD COLUMN IF NOT EXISTS sap_incoming_payment_doc_num integer,
  ADD COLUMN IF NOT EXISTS paid_amount numeric(19,4),
  ADD COLUMN IF NOT EXISTS paid_at date,
  ADD COLUMN IF NOT EXISTS fiscal_doc_key text,
  ADD COLUMN IF NOT EXISTS fiscal_authorized_at timestamptz;

CREATE INDEX IF NOT EXISTS sales_order_invoices_payment_idx
  ON public.sales_order_invoices (company_db, sap_incoming_payment_doc_entry)
  WHERE sap_incoming_payment_doc_entry IS NOT NULL;

ALTER TABLE public.baixas_recebimento
  ADD COLUMN IF NOT EXISTS sap_incoming_payment_doc_num integer;

ALTER TABLE public.advance_payments
  ADD COLUMN IF NOT EXISTS applied_invoice_doc_entry integer,
  ADD COLUMN IF NOT EXISTS applied_invoice_doc_num integer,
  ADD COLUMN IF NOT EXISTS applied_amount numeric(19,4),
  ADD COLUMN IF NOT EXISTS applied_at timestamptz;

CREATE INDEX IF NOT EXISTS advance_payments_applied_invoice_idx
  ON public.advance_payments (company_db, applied_invoice_doc_entry)
  WHERE applied_invoice_doc_entry IS NOT NULL;

INSERT INTO public.synapse_integrations (
  integration_key,
  display_name,
  description,
  is_active,
  interval_minutes,
  parameters,
  company_db
)
SELECT
  'sap_document_link_watcher',
  'Watcher de vínculos SAP',
  'Reconcilia vínculos entre PCs, NFs de entrada, adiantamentos, pedidos de venda, NFs de saída, recebimentos e documentos fiscais autorizados.',
  false,
  10,
  '{"days_back": 21}'::jsonb,
  c.company_db
FROM public.companies c
WHERE c.company_db IS NOT NULL
ON CONFLICT (integration_key, company_db) DO NOTHING;
