
-- ENUMS
CREATE TYPE public.audit_pay_doc_type AS ENUM ('ap_invoice','outgoing_payment','purchase_order','expense_flow');
CREATE TYPE public.audit_pay_queue_status AS ENUM ('pending','processing','done','error','skipped');
CREATE TYPE public.audit_pay_baseline_source AS ENUM ('erp_flow_approval','sap_purchase_order');
CREATE TYPE public.audit_pay_severity AS ENUM ('conforme','baixa','media','alta','critica');
CREATE TYPE public.audit_pay_finding_type AS ENUM (
  'desvio_valor','troca_fornecedor','troca_dados_bancarios','alteracao_itens','troca_centro_custo',
  'troca_projeto','divergencia_solicitante','alteracao_pos_aprovacao','pagamento_sem_documento',
  'pagamento_duplicado','pago_acima_aprovado'
);
CREATE TYPE public.audit_pay_signal_type AS ENUM (
  'reincidencia','fracionamento','alteracao_pos_aprovacao','fornecedor_novo_alto_valor',
  'mudanca_bancaria_pre_pagamento','duplicidade','distribuicao_temporal_anomala','valores_redondos',
  'conluio_solicitante_aprovador'
);
CREATE TYPE public.audit_pay_entity_type AS ENUM ('fornecedor','solicitante','projeto','centro_custo','par_solicitante_aprovador');
CREATE TYPE public.audit_pay_signal_status AS ENUM ('aberto','em_analise','confirmado_erro','confirmado_fraude','descartado');
CREATE TYPE public.audit_pay_agent_mode AS ENUM ('every_finding','batch_daily');

-- QUEUE
CREATE TABLE public.audit_pay_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  document_ref text NOT NULL,
  document_type public.audit_pay_doc_type NOT NULL DEFAULT 'ap_invoice',
  baseline_source public.audit_pay_baseline_source NOT NULL DEFAULT 'erp_flow_approval',
  status public.audit_pay_queue_status NOT NULL DEFAULT 'pending',
  priority int NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  error_message text,
  enqueued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, document_ref, document_type)
);
CREATE INDEX idx_audit_pay_queue_pick ON public.audit_pay_queue (status, priority DESC, enqueued_at);
CREATE INDEX idx_audit_pay_queue_company ON public.audit_pay_queue (company_db);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_pay_queue TO authenticated;
GRANT ALL ON public.audit_pay_queue TO service_role;
ALTER TABLE public.audit_pay_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "queue select by company access" ON public.audit_pay_queue FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "queue insert by company access" ON public.audit_pay_queue FOR INSERT TO authenticated
  WITH CHECK (public.can_access_audit_console(company_db));
CREATE POLICY "queue update by company access" ON public.audit_pay_queue FOR UPDATE TO authenticated
  USING (public.can_access_audit_console(company_db)) WITH CHECK (public.can_access_audit_console(company_db));
CREATE POLICY "queue delete by admin" ON public.audit_pay_queue FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- RESULTS
CREATE TABLE public.audit_pay_result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  queue_id uuid REFERENCES public.audit_pay_queue(id) ON DELETE SET NULL,
  document_ref text NOT NULL,
  document_type public.audit_pay_doc_type NOT NULL,
  baseline_source public.audit_pay_baseline_source NOT NULL DEFAULT 'erp_flow_approval',
  fornecedor_code text,
  fornecedor_name text,
  solicitante text,
  projeto text,
  centro_custo text,
  baseline_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  settlement_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  valor_baseline numeric,
  valor_pago numeric,
  desvio_valor_abs numeric,
  desvio_valor_pct numeric,
  overall_severity public.audit_pay_severity NOT NULL DEFAULT 'conforme',
  risk_score int NOT NULL DEFAULT 0,
  has_findings boolean NOT NULL DEFAULT false,
  audited_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, document_ref, document_type)
);
CREATE INDEX idx_audit_pay_result_company ON public.audit_pay_result (company_db, audited_at DESC);
CREATE INDEX idx_audit_pay_result_sev ON public.audit_pay_result (company_db, overall_severity);
CREATE INDEX idx_audit_pay_result_forn ON public.audit_pay_result (company_db, fornecedor_code);
CREATE INDEX idx_audit_pay_result_sol ON public.audit_pay_result (company_db, solicitante);
CREATE INDEX idx_audit_pay_result_proj ON public.audit_pay_result (company_db, projeto);
CREATE INDEX idx_audit_pay_result_cc ON public.audit_pay_result (company_db, centro_custo);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_pay_result TO authenticated;
GRANT ALL ON public.audit_pay_result TO service_role;
ALTER TABLE public.audit_pay_result ENABLE ROW LEVEL SECURITY;
CREATE POLICY "result select by company access" ON public.audit_pay_result FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "result insert by company access" ON public.audit_pay_result FOR INSERT TO authenticated
  WITH CHECK (public.can_access_audit_console(company_db));
CREATE POLICY "result update by company access" ON public.audit_pay_result FOR UPDATE TO authenticated
  USING (public.can_access_audit_console(company_db)) WITH CHECK (public.can_access_audit_console(company_db));
CREATE POLICY "result delete by admin" ON public.audit_pay_result FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- FINDINGS
CREATE TABLE public.audit_pay_finding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  audit_result_id uuid NOT NULL REFERENCES public.audit_pay_result(id) ON DELETE CASCADE,
  finding_type public.audit_pay_finding_type NOT NULL,
  severity public.audit_pay_severity NOT NULL DEFAULT 'baixa',
  field_name text,
  value_before jsonb,
  value_after jsonb,
  delta numeric,
  explanation text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_pay_finding_result ON public.audit_pay_finding (audit_result_id);
CREATE INDEX idx_audit_pay_finding_company ON public.audit_pay_finding (company_db, finding_type, severity);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_pay_finding TO authenticated;
GRANT ALL ON public.audit_pay_finding TO service_role;
ALTER TABLE public.audit_pay_finding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "finding select by company access" ON public.audit_pay_finding FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "finding insert by company access" ON public.audit_pay_finding FOR INSERT TO authenticated
  WITH CHECK (public.can_access_audit_console(company_db));
CREATE POLICY "finding update by company access" ON public.audit_pay_finding FOR UPDATE TO authenticated
  USING (public.can_access_audit_console(company_db)) WITH CHECK (public.can_access_audit_console(company_db));
CREATE POLICY "finding delete by admin" ON public.audit_pay_finding FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- FRAUD SIGNALS
CREATE TABLE public.audit_pay_fraud_signal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  signal_type public.audit_pay_signal_type NOT NULL,
  entity_type public.audit_pay_entity_type NOT NULL,
  entity_ref text NOT NULL,
  related_audit_result_ids uuid[] NOT NULL DEFAULT '{}',
  severity public.audit_pay_severity NOT NULL DEFAULT 'media',
  confidence numeric NOT NULL DEFAULT 0.5,
  narrative text,
  status public.audit_pay_signal_status NOT NULL DEFAULT 'aberto',
  resolution_note text,
  resolved_by text,
  resolved_at timestamptz,
  period_start date,
  period_end date,
  detected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_pay_signal_company ON public.audit_pay_fraud_signal (company_db, status, severity, confidence DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_pay_fraud_signal TO authenticated;
GRANT ALL ON public.audit_pay_fraud_signal TO service_role;
ALTER TABLE public.audit_pay_fraud_signal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "signal select by company access" ON public.audit_pay_fraud_signal FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "signal insert by company access" ON public.audit_pay_fraud_signal FOR INSERT TO authenticated
  WITH CHECK (public.can_access_audit_console(company_db));
CREATE POLICY "signal update by company access" ON public.audit_pay_fraud_signal FOR UPDATE TO authenticated
  USING (public.can_access_audit_console(company_db)) WITH CHECK (public.can_access_audit_console(company_db));
CREATE POLICY "signal delete by admin" ON public.audit_pay_fraud_signal FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- CONFIG
CREATE TABLE public.audit_pay_config (
  company_db text PRIMARY KEY,
  tolerance_pct_baixa numeric NOT NULL DEFAULT 5,
  tolerance_pct_media numeric NOT NULL DEFAULT 15,
  approval_thresholds jsonb NOT NULL DEFAULT '[]'::jsonb,
  fornecedor_risco jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_agent_on public.audit_pay_agent_mode NOT NULL DEFAULT 'batch_daily',
  bank_change_window_days int NOT NULL DEFAULT 30,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_pay_config TO authenticated;
GRANT ALL ON public.audit_pay_config TO service_role;
ALTER TABLE public.audit_pay_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config select by company access" ON public.audit_pay_config FOR SELECT TO authenticated
  USING (public.can_access_audit_console(company_db));
CREATE POLICY "config write by admin" ON public.audit_pay_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- updated_at triggers
CREATE TRIGGER trg_audit_pay_queue_updated BEFORE UPDATE ON public.audit_pay_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_audit_pay_result_updated BEFORE UPDATE ON public.audit_pay_result
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_audit_pay_signal_updated BEFORE UPDATE ON public.audit_pay_fraud_signal
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_audit_pay_config_updated BEFORE UPDATE ON public.audit_pay_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
