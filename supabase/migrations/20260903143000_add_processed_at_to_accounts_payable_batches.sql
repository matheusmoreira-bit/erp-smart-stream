ALTER TABLE public.accounts_payable_batches
  ADD COLUMN IF NOT EXISTS processed_at timestamptz;

COMMENT ON COLUMN public.accounts_payable_batches.processed_at IS
  'Data/hora em que o retorno CNAB do lote foi concluido/processado.';
