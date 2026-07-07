
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS sap_sync_state text,
  ADD COLUMN IF NOT EXISTS sap_sync_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sap_sync_next_retry_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_expenses_sap_sync_state
  ON public.expenses (sap_sync_state)
  WHERE sap_sync_state = 'sync_error';

CREATE INDEX IF NOT EXISTS idx_expenses_sap_sync_next_retry
  ON public.expenses (sap_sync_next_retry_at)
  WHERE sap_sync_next_retry_at IS NOT NULL;
