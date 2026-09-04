ALTER TABLE public.sales_order_invoices
  ADD COLUMN IF NOT EXISTS paid_amount numeric,
  ADD COLUMN IF NOT EXISTS paid_at date,
  ADD COLUMN IF NOT EXISTS sap_incoming_payment_doc_entry integer,
  ADD COLUMN IF NOT EXISTS sap_incoming_payment_doc_num integer,
  ADD COLUMN IF NOT EXISTS fiscal_authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS fiscal_doc_key text;