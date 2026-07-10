ALTER TABLE public.pagcorp_integration_log
  ADD COLUMN IF NOT EXISTS settlement_retry_after timestamptz;

COMMENT ON COLUMN public.pagcorp_integration_log.settlement_retry_after IS 'Se preenchido, o watcher deve ignorar esta linha até este instante (usado para adiar retries que dependem da publicação da PTAX do BCB).';

CREATE INDEX IF NOT EXISTS pagcorp_integration_log_settlement_retry_idx
  ON public.pagcorp_integration_log (settlement_status, settlement_retry_after)
  WHERE settlement_status IN ('pending', 'awaiting_invoice', 'awaiting_settlement', 'error');