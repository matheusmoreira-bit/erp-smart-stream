ALTER TABLE public.nf_entrada_imports
  ADD COLUMN IF NOT EXISTS erp_invoice_doc_date date,
  ADD COLUMN IF NOT EXISTS erp_invoice_doc_status text,
  ADD COLUMN IF NOT EXISTS erp_invoice_cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS erp_invoice_open_amount numeric,
  ADD COLUMN IF NOT EXISTS erp_invoice_status_synced_at timestamptz;