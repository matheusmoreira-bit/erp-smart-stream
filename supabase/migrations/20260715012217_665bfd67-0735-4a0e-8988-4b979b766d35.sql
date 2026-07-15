-- Cache da view HANA VW_FIN_ANALISE_FLUXO (SAP) por empresa.
-- Alimenta dashboard, ROI, análise temporal e mapa de relações.

CREATE TABLE IF NOT EXISTS public.sap_fluxo_analise_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  flow_key text NOT NULL,
  data_atualizacao_esboco timestamptz,
  solicitante text,
  departamento text,
  centro_custo text,
  marca text,
  descricao text,
  aprovador text,
  data_aprovacao timestamptz,
  fornecedor text,
  valor numeric,
  data_vencimento timestamptz,
  data_lancamento timestamptz,
  data_pagamento timestamptz,
  id_esboco text,
  id_pedido text,
  id_nf text,
  id_cp text,
  raw_json jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sap_fluxo_analise_cache_key UNIQUE (company_db, flow_key)
);

CREATE INDEX IF NOT EXISTS sap_fluxo_analise_cache_company_idx    ON public.sap_fluxo_analise_cache (company_db);
CREATE INDEX IF NOT EXISTS sap_fluxo_analise_cache_id_pedido_idx  ON public.sap_fluxo_analise_cache (company_db, id_pedido);
CREATE INDEX IF NOT EXISTS sap_fluxo_analise_cache_id_esboco_idx  ON public.sap_fluxo_analise_cache (company_db, id_esboco);
CREATE INDEX IF NOT EXISTS sap_fluxo_analise_cache_id_nf_idx      ON public.sap_fluxo_analise_cache (company_db, id_nf);
CREATE INDEX IF NOT EXISTS sap_fluxo_analise_cache_id_cp_idx      ON public.sap_fluxo_analise_cache (company_db, id_cp);
CREATE INDEX IF NOT EXISTS sap_fluxo_analise_cache_data_lanc_idx  ON public.sap_fluxo_analise_cache (company_db, data_lancamento);

GRANT SELECT ON public.sap_fluxo_analise_cache TO authenticated;
GRANT ALL   ON public.sap_fluxo_analise_cache TO service_role;

ALTER TABLE public.sap_fluxo_analise_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read sap_fluxo_analise_cache"
  ON public.sap_fluxo_analise_cache
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role manages sap_fluxo_analise_cache"
  ON public.sap_fluxo_analise_cache
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_sap_fluxo_analise_cache_updated
  BEFORE UPDATE ON public.sap_fluxo_analise_cache
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Estado do sync por empresa.
CREATE TABLE IF NOT EXISTS public.sap_fluxo_analise_sync_state (
  company_db text PRIMARY KEY,
  last_run_at timestamptz,
  last_status text,
  last_error text,
  last_batch_count integer,
  total_synced bigint DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sap_fluxo_analise_sync_state TO authenticated;
GRANT ALL   ON public.sap_fluxo_analise_sync_state TO service_role;

ALTER TABLE public.sap_fluxo_analise_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read sap_fluxo_analise_sync_state"
  ON public.sap_fluxo_analise_sync_state
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role manages sap_fluxo_analise_sync_state"
  ON public.sap_fluxo_analise_sync_state
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_sap_fluxo_analise_sync_state_updated
  BEFORE UPDATE ON public.sap_fluxo_analise_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();