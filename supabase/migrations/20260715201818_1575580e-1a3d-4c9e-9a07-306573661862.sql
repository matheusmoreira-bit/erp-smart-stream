ALTER TABLE public.baixas_recebimento
  ADD COLUMN IF NOT EXISTS criado_por_user_code TEXT,
  ADD COLUMN IF NOT EXISTS criado_por_nome TEXT;