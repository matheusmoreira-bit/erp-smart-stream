
-- 1) pedidos_venda_erp: controla origem (ERP vs SAP direto)
CREATE TABLE public.pedidos_venda_erp (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  doc_entry INTEGER NOT NULL,
  doc_num TEXT,
  card_code TEXT,
  criado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, doc_entry)
);
CREATE INDEX idx_pedidos_venda_erp_company ON public.pedidos_venda_erp(company_db);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pedidos_venda_erp TO authenticated;
GRANT ALL ON public.pedidos_venda_erp TO service_role;
ALTER TABLE public.pedidos_venda_erp ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can read pedidos_venda_erp"
  ON public.pedidos_venda_erp FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated can insert pedidos_venda_erp"
  ON public.pedidos_venda_erp FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "admins manage pedidos_venda_erp"
  ON public.pedidos_venda_erp FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_pedidos_venda_erp_updated_at
  BEFORE UPDATE ON public.pedidos_venda_erp
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) baixas_recebimento: cabeçalho
CREATE TABLE public.baixas_recebimento (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  card_code TEXT NOT NULL,
  card_name TEXT,
  data_recebimento DATE NOT NULL,
  conta_contabil_codigo TEXT NOT NULL,
  conta_contabil_nome TEXT,
  valor_total NUMERIC(19,4) NOT NULL CHECK (valor_total > 0),
  valor_juros_multa NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (valor_juros_multa >= 0),
  status TEXT NOT NULL DEFAULT 'pendente_sincronizacao'
    CHECK (status IN ('pendente_sincronizacao','sincronizado','erro')),
  sap_incoming_payment_doc_entry INTEGER,
  sap_error_message TEXT,
  criado_por UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_baixas_recebimento_company ON public.baixas_recebimento(company_db);
CREATE INDEX idx_baixas_recebimento_card ON public.baixas_recebimento(company_db, card_code);
CREATE INDEX idx_baixas_recebimento_status ON public.baixas_recebimento(status);
CREATE INDEX idx_baixas_recebimento_criado_por ON public.baixas_recebimento(criado_por);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.baixas_recebimento TO authenticated;
GRANT ALL ON public.baixas_recebimento TO service_role;
ALTER TABLE public.baixas_recebimento ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own baixas or admin"
  ON public.baixas_recebimento FOR SELECT TO authenticated
  USING (criado_por = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "users insert own baixas"
  ON public.baixas_recebimento FOR INSERT TO authenticated
  WITH CHECK (criado_por = auth.uid());
CREATE POLICY "users update own baixas or admin"
  ON public.baixas_recebimento FOR UPDATE TO authenticated
  USING (criado_por = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (criado_por = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins delete baixas"
  ON public.baixas_recebimento FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_baixas_recebimento_updated_at
  BEFORE UPDATE ON public.baixas_recebimento
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) baixas_recebimento_itens: rateio N:N
CREATE TABLE public.baixas_recebimento_itens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  baixa_id UUID NOT NULL REFERENCES public.baixas_recebimento(id) ON DELETE CASCADE,
  invoice_doc_entry INTEGER NOT NULL,
  invoice_doc_num TEXT,
  valor_baixado NUMERIC(19,4) NOT NULL CHECK (valor_baixado > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_baixas_itens_baixa ON public.baixas_recebimento_itens(baixa_id);
CREATE INDEX idx_baixas_itens_invoice ON public.baixas_recebimento_itens(invoice_doc_entry);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.baixas_recebimento_itens TO authenticated;
GRANT ALL ON public.baixas_recebimento_itens TO service_role;
ALTER TABLE public.baixas_recebimento_itens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read itens of readable baixas"
  ON public.baixas_recebimento_itens FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.baixas_recebimento b
    WHERE b.id = baixa_id
      AND (b.criado_por = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ));
CREATE POLICY "insert itens of own baixas"
  ON public.baixas_recebimento_itens FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.baixas_recebimento b
    WHERE b.id = baixa_id AND b.criado_por = auth.uid()
  ));
CREATE POLICY "update itens of own baixas or admin"
  ON public.baixas_recebimento_itens FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.baixas_recebimento b
    WHERE b.id = baixa_id
      AND (b.criado_por = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.baixas_recebimento b
    WHERE b.id = baixa_id
      AND (b.criado_por = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ));
CREATE POLICY "delete itens with parent"
  ON public.baixas_recebimento_itens FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.baixas_recebimento b
    WHERE b.id = baixa_id
      AND (b.criado_por = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ));
