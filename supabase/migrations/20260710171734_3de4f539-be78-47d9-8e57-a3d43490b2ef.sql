ALTER TABLE public.pagcorp_integration_log
  ADD COLUMN IF NOT EXISTS settlement_ptax_rate numeric,
  ADD COLUMN IF NOT EXISTS settlement_ptax_date date,
  ADD COLUMN IF NOT EXISTS settlement_ptax_source text;

COMMENT ON COLUMN public.pagcorp_integration_log.settlement_ptax_rate IS 'PTAX venda (BRL por unidade da moeda estrangeira) usada na baixa em moeda estrangeira.';
COMMENT ON COLUMN public.pagcorp_integration_log.settlement_ptax_date IS 'Data da PTAX efetivamente aplicada (pode ser um dia útil anterior à data da fatura).';
COMMENT ON COLUMN public.pagcorp_integration_log.settlement_ptax_source IS 'Fonte da cotação (ex.: BCB Olinda PTAX venda).';