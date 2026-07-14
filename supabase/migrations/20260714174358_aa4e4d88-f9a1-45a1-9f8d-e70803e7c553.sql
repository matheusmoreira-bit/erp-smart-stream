
-- ============================================================
-- Cruzamento Fiscal MasterTax × ERP (agnóstico de ERP)
-- ============================================================

CREATE TABLE public.auditoria_cruzamento_fiscal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cenario text NOT NULL CHECK (cenario IN ('pago_sem_nota','nota_sem_pagamento','conciliado')),
  empresa_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  erp_origem text,           -- 'omie' | 'sap_b1' | outro; null quando cenario = nota_sem_pagamento
  cnpj_fornecedor text NOT NULL,
  razao_social_fornecedor text,
  -- lado MasterTax
  nota_mastertax_id uuid REFERENCES public.nf_entrada_imports(id) ON DELETE SET NULL,
  nota_chave_acesso text,
  nota_numero text,
  nota_valor numeric(18,2),
  nota_data_emissao date,
  -- lado ERP
  conta_paga_id_externo text,
  conta_paga_valor numeric(18,2),
  conta_paga_data_baixa date,
  conta_paga_forma_pagamento text,
  conta_paga_link_origem text,
  -- métricas do match
  diferenca_valor numeric(18,2),
  diferenca_dias integer,
  score_confianca numeric(5,4),
  candidatos_ambiguos jsonb,          -- lista serializada quando cenario = conciliado ambíguo
  status_match text NOT NULL DEFAULT 'automatico'
    CHECK (status_match IN ('automatico','ambiguo','confirmado_manual','ignorado')),
  observacao_usuario text,
  revisado_por uuid,
  revisado_em timestamptz,
  periodo_inicio date NOT NULL,
  periodo_fim date NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auditoria_cf_empresa_cenario_idx
  ON public.auditoria_cruzamento_fiscal (empresa_id, cenario, criado_em DESC);
CREATE INDEX auditoria_cf_cnpj_data_idx
  ON public.auditoria_cruzamento_fiscal (cnpj_fornecedor, nota_data_emissao);
CREATE INDEX auditoria_cf_periodo_idx
  ON public.auditoria_cruzamento_fiscal (empresa_id, periodo_inicio, periodo_fim);

-- Idempotência: mesmo empresa+nota+lançamento no ERP não pode duplicar.
-- Usa índices únicos parciais porque cada cenário libera uma das duas pontas.
CREATE UNIQUE INDEX auditoria_cf_unique_nota_conta_idx
  ON public.auditoria_cruzamento_fiscal (empresa_id, nota_mastertax_id, conta_paga_id_externo)
  WHERE nota_mastertax_id IS NOT NULL AND conta_paga_id_externo IS NOT NULL;
CREATE UNIQUE INDEX auditoria_cf_unique_nota_only_idx
  ON public.auditoria_cruzamento_fiscal (empresa_id, nota_mastertax_id)
  WHERE nota_mastertax_id IS NOT NULL AND conta_paga_id_externo IS NULL;
CREATE UNIQUE INDEX auditoria_cf_unique_conta_only_idx
  ON public.auditoria_cruzamento_fiscal (empresa_id, erp_origem, conta_paga_id_externo)
  WHERE nota_mastertax_id IS NULL AND conta_paga_id_externo IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auditoria_cruzamento_fiscal TO authenticated;
GRANT ALL ON public.auditoria_cruzamento_fiscal TO service_role;

ALTER TABLE public.auditoria_cruzamento_fiscal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_cf_select_admin_or_scope"
  ON public.auditoria_cruzamento_fiscal
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.can_access_audit_console(company_db)
  );

CREATE POLICY "audit_cf_update_admin_reviewer"
  ON public.auditoria_cruzamento_fiscal
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.can_access_audit_console(company_db)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.can_access_audit_console(company_db)
  );

-- INSERT/DELETE ficam somente com service_role (edge function).

-- Trigger atualiza atualizado_em
CREATE TRIGGER trg_audit_cf_updated_at
  BEFORE UPDATE ON public.auditoria_cruzamento_fiscal
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- update_updated_at_column usa NEW.updated_at; renomeamos a coluna esperada:
-- ajusta: cria função dedicada porque a coluna é atualizado_em
DROP TRIGGER trg_audit_cf_updated_at ON public.auditoria_cruzamento_fiscal;

CREATE OR REPLACE FUNCTION public.auditoria_cf_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.atualizado_em = now(); RETURN NEW; END;$$;

CREATE TRIGGER trg_audit_cf_touch
  BEFORE UPDATE ON public.auditoria_cruzamento_fiscal
  FOR EACH ROW EXECUTE FUNCTION public.auditoria_cf_touch();

-- ============================================================
-- Configuração por empresa
-- ============================================================
CREATE TABLE public.auditoria_cruzamento_config (
  empresa_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  tolerancia_valor_abs numeric(18,2) NOT NULL DEFAULT 1.00,
  tolerancia_valor_pct numeric(6,4)  NOT NULL DEFAULT 0.0050, -- 0.5%
  janela_dias integer NOT NULL DEFAULT 10,
  usar_raiz_cnpj_fallback boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auditoria_cruzamento_config TO authenticated;
GRANT ALL ON public.auditoria_cruzamento_config TO service_role;

ALTER TABLE public.auditoria_cruzamento_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_cfg_select_authenticated"
  ON public.auditoria_cruzamento_config
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "audit_cfg_admin_write"
  ON public.auditoria_cruzamento_config
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_audit_cfg_updated
  BEFORE UPDATE ON public.auditoria_cruzamento_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
