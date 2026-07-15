ALTER TABLE public.baixas_recebimento
  ADD COLUMN IF NOT EXISTS conta_juros_multa_codigo text,
  ADD COLUMN IF NOT EXISTS conta_juros_multa_nome text;