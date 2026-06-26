ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS sap_integration_locked_at timestamptz;
ALTER TABLE public.advance_payments ADD COLUMN IF NOT EXISTS sap_integration_locked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_expenses_sap_integration_locked_at ON public.expenses(sap_integration_locked_at) WHERE sap_integration_locked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_advance_payments_sap_integration_locked_at ON public.advance_payments(sap_integration_locked_at) WHERE sap_integration_locked_at IS NOT NULL;