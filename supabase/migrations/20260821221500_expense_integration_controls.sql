ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS sap_integration_cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS sap_integration_cancelled_by text;

CREATE INDEX IF NOT EXISTS idx_expenses_integration_dispatchable
  ON public.expenses (company_db, sap_integration_last_attempt_at)
  WHERE status = 'aprovado'
    AND sap_doc_entry IS NULL
    AND sap_integration_cancelled_at IS NULL;

COMMENT ON COLUMN public.expenses.sap_integration_cancelled_at IS
  'Bloqueia dispatch automático/manual ao ERP até que um operador reative explicitamente.';
COMMENT ON COLUMN public.expenses.sap_integration_cancelled_by IS
  'Identidade do operador que bloqueou a integração no monitor.';
