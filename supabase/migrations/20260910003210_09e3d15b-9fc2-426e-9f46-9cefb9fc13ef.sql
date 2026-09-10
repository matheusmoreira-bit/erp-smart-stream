ALTER TABLE public.advance_payments
  ADD COLUMN IF NOT EXISTS sap_doc_date date,
  ADD COLUMN IF NOT EXISTS sap_doc_status text,
  ADD COLUMN IF NOT EXISTS sap_cancelled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sap_open_amount numeric,
  ADD COLUMN IF NOT EXISTS sap_status_synced_at timestamp with time zone;