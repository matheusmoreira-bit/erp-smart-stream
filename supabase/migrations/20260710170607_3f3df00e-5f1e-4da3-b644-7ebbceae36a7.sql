ALTER TABLE public.pagcorp_integration_log
  ADD COLUMN IF NOT EXISTS settlement_payment_doc_entry integer,
  ADD COLUMN IF NOT EXISTS settlement_payment_doc_num integer;