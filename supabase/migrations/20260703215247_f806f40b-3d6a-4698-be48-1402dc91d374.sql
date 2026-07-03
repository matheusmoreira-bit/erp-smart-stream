
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS rateio_type text
  CHECK (rateio_type IS NULL OR rateio_type IN ('padrao','folha','imposto','reembolso','viagens'));
