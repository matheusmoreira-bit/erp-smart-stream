
-- Status enum
DO $$ BEGIN
  CREATE TYPE public.nf_entrada_status AS ENUM (
    'pending_expense',
    'awaiting_erpflow_approval',
    'erpflow_rejected',
    'awaiting_sap',
    'sap_rejected',
    'awaiting_invoice',
    'completed',
    'integration_error',
    'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Main table
CREATE TABLE public.nf_entrada_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chave_acesso TEXT NOT NULL UNIQUE,
  numero_nf TEXT,
  serie TEXT,
  cnpj_fornecedor TEXT,
  nome_fornecedor TEXT,
  data_emissao DATE,
  valor_total NUMERIC(18,2),
  condicao_pagamento TEXT,
  itens JSONB NOT NULL DEFAULT '[]'::jsonb,
  impostos JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_mastertax JSONB,
  xml_storage_path TEXT,
  pdf_storage_path TEXT,
  expense_id UUID,
  sap_company_db TEXT,
  sap_po_draft_id TEXT,
  sap_invoice_draft_id TEXT,
  cost_center TEXT,
  status public.nf_entrada_status NOT NULL DEFAULT 'pending_expense',
  rejection_reason TEXT,
  last_error TEXT,
  last_poll_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX nf_entrada_imports_status_idx ON public.nf_entrada_imports(status);
CREATE INDEX nf_entrada_imports_cnpj_idx ON public.nf_entrada_imports(cnpj_fornecedor);
CREATE INDEX nf_entrada_imports_company_idx ON public.nf_entrada_imports(sap_company_db);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_entrada_imports TO authenticated;
GRANT ALL ON public.nf_entrada_imports TO service_role;

ALTER TABLE public.nf_entrada_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read nf_entrada_imports"
  ON public.nf_entrada_imports FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins manage nf_entrada_imports"
  ON public.nf_entrada_imports FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_nf_entrada_imports_updated
  BEFORE UPDATE ON public.nf_entrada_imports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Logs
CREATE TABLE public.nf_entrada_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id UUID NOT NULL REFERENCES public.nf_entrada_imports(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  status_from public.nf_entrada_status,
  status_to public.nf_entrada_status,
  message TEXT,
  payload JSONB,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX nf_entrada_logs_import_idx ON public.nf_entrada_logs(import_id, created_at DESC);

GRANT SELECT, INSERT ON public.nf_entrada_logs TO authenticated;
GRANT ALL ON public.nf_entrada_logs TO service_role;

ALTER TABLE public.nf_entrada_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read nf_entrada_logs"
  ON public.nf_entrada_logs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins insert nf_entrada_logs"
  ON public.nf_entrada_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Settings per company
CREATE TABLE public.nf_entrada_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nf_entrada_settings TO authenticated;
GRANT ALL ON public.nf_entrada_settings TO service_role;

ALTER TABLE public.nf_entrada_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read nf_entrada_settings"
  ON public.nf_entrada_settings FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins manage nf_entrada_settings"
  ON public.nf_entrada_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_nf_entrada_settings_updated
  BEFORE UPDATE ON public.nf_entrada_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
