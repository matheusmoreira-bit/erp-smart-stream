ALTER TABLE public.auditoria_cruzamento_fiscal
  ADD COLUMN IF NOT EXISTS auto_conciliado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_conciliado_em timestamptz,
  ADD COLUMN IF NOT EXISTS auto_regra text,
  ADD COLUMN IF NOT EXISTS lancamento_erp_status text,
  ADD COLUMN IF NOT EXISTS lancamento_erp_id text;

CREATE INDEX IF NOT EXISTS auditoria_cf_auto_idx
  ON public.auditoria_cruzamento_fiscal (empresa_id, auto_conciliado, criado_em DESC);

ALTER TABLE public.auditoria_cruzamento_config
  ADD COLUMN IF NOT EXISTS auto_conciliar boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_score_min numeric(5,4) NOT NULL DEFAULT 0.9000,
  ADD COLUMN IF NOT EXISTS auto_exigir_lancamento_erp boolean NOT NULL DEFAULT false;