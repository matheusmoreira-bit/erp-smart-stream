-- Adiantamentos a fornecedor
CREATE TABLE public.advance_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  supplier_card_code TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_cnpj TEXT,
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'BRL' CHECK (currency ~ '^[A-Z]{3}$'),
  due_date DATE,
  remarks TEXT,
  requester_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  requester_name TEXT,
  requester_email TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending','approved','rejected','integrating','integrated','failed')),
  current_approval_level INTEGER NOT NULL DEFAULT 0,
  total_approval_levels INTEGER NOT NULL DEFAULT 0,
  rejection_reason TEXT,
  sap_doc_entry INTEGER,
  sap_doc_num INTEGER,
  sap_integration_status TEXT,
  sap_integration_error TEXT,
  sap_integrated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_advance_payments_requester ON public.advance_payments(requester_id);
CREATE INDEX idx_advance_payments_status ON public.advance_payments(status);
CREATE INDEX idx_advance_payments_company ON public.advance_payments(company_db);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advance_payments TO authenticated;
GRANT ALL ON public.advance_payments TO service_role;

ALTER TABLE public.advance_payments ENABLE ROW LEVEL SECURITY;

-- Dono enxerga / edita o próprio adiantamento
CREATE POLICY "advances_owner_select" ON public.advance_payments
  FOR SELECT TO authenticated
  USING (requester_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "advances_owner_insert" ON public.advance_payments
  FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "advances_owner_update" ON public.advance_payments
  FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (requester_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "advances_owner_delete" ON public.advance_payments
  FOR DELETE TO authenticated
  USING ((requester_id = auth.uid() AND status = 'draft') OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_advance_payments_updated_at
  BEFORE UPDATE ON public.advance_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Anexos
CREATE TABLE public.advance_payment_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  advance_id UUID NOT NULL REFERENCES public.advance_payments(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_advance_attachments_advance ON public.advance_payment_attachments(advance_id);

GRANT SELECT, INSERT, DELETE ON public.advance_payment_attachments TO authenticated;
GRANT ALL ON public.advance_payment_attachments TO service_role;

ALTER TABLE public.advance_payment_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advance_att_select" ON public.advance_payment_attachments
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.advance_payments a
    WHERE a.id = advance_id
      AND (a.requester_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ));

CREATE POLICY "advance_att_insert" ON public.advance_payment_attachments
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.advance_payments a
    WHERE a.id = advance_id AND a.requester_id = auth.uid()
  ));

CREATE POLICY "advance_att_delete" ON public.advance_payment_attachments
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.advance_payments a
    WHERE a.id = advance_id
      AND (a.requester_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  ));