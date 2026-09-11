CREATE TABLE public.sap_po_nf_cp_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db TEXT NOT NULL,
  link_key TEXT NOT NULL,
  id_pedido_compra TEXT,
  id_nf_entrada TEXT,
  numero_nota_fiscal TEXT,
  id_contas_pagar TEXT,
  cod_fornecedor TEXT,
  nome_fornecedor TEXT,
  valor NUMERIC,
  referencia_valor TEXT,
  status_geral TEXT,
  raw_json JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sap_po_nf_cp_cache_key_idx ON public.sap_po_nf_cp_cache (company_db, link_key);
CREATE INDEX sap_po_nf_cp_cache_po_idx ON public.sap_po_nf_cp_cache (company_db, id_pedido_compra);
CREATE INDEX sap_po_nf_cp_cache_nf_idx ON public.sap_po_nf_cp_cache (company_db, id_nf_entrada);
CREATE INDEX sap_po_nf_cp_cache_cp_idx ON public.sap_po_nf_cp_cache (company_db, id_contas_pagar);

GRANT SELECT ON public.sap_po_nf_cp_cache TO authenticated;
GRANT ALL ON public.sap_po_nf_cp_cache TO service_role;

ALTER TABLE public.sap_po_nf_cp_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read sap_po_nf_cp_cache"
  ON public.sap_po_nf_cp_cache FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role manages sap_po_nf_cp_cache"
  ON public.sap_po_nf_cp_cache FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.sap_po_nf_cp_sync_state (
  company_db TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  last_error TEXT,
  last_batch_count INTEGER NOT NULL DEFAULT 0,
  total_synced BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sap_po_nf_cp_sync_state TO authenticated;
GRANT ALL ON public.sap_po_nf_cp_sync_state TO service_role;

ALTER TABLE public.sap_po_nf_cp_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read sap_po_nf_cp_sync_state"
  ON public.sap_po_nf_cp_sync_state FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_role manages sap_po_nf_cp_sync_state"
  ON public.sap_po_nf_cp_sync_state FOR ALL TO service_role USING (true) WITH CHECK (true);
