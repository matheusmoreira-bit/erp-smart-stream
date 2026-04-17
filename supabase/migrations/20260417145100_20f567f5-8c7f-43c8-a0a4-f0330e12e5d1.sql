ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS sap_attachment_status text,
  ADD COLUMN IF NOT EXISTS sap_purchase_order_status text,
  ADD COLUMN IF NOT EXISTS sap_attachment_link_status text,
  ADD COLUMN IF NOT EXISTS sap_integration_error text,
  ADD COLUMN IF NOT EXISTS sap_integration_last_attempt_at timestamp with time zone;