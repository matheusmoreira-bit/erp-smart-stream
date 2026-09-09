ALTER TABLE public.advance_payments
  ADD COLUMN IF NOT EXISTS reconciliation_date date,
  ADD COLUMN IF NOT EXISTS reconciliation_account_code text,
  ADD COLUMN IF NOT EXISTS reconciliation_account_name text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS reconciled_by uuid,
  ADD COLUMN IF NOT EXISTS reconciliation_error text,
  ADD COLUMN IF NOT EXISTS sap_incoming_payment_doc_entry integer;

CREATE TABLE IF NOT EXISTS public.advance_invoice_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  card_code text NOT NULL,
  advance_id uuid REFERENCES public.advance_payments(id) ON DELETE SET NULL,
  advance_source text NOT NULL DEFAULT 'flow',
  sap_advance_doc_entry integer,
  sap_advance_doc_num integer,
  invoice_doc_entry integer NOT NULL,
  invoice_doc_num text,
  baixa_id uuid REFERENCES public.baixas_recebimento(id) ON DELETE SET NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'BRL',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advance_apps_advance_idx ON public.advance_invoice_applications (advance_id);
CREATE INDEX IF NOT EXISTS advance_apps_invoice_idx ON public.advance_invoice_applications (company_db, invoice_doc_entry);
CREATE INDEX IF NOT EXISTS advance_apps_sap_advance_idx ON public.advance_invoice_applications (company_db, sap_advance_doc_entry);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.advance_invoice_applications TO authenticated;
GRANT ALL ON public.advance_invoice_applications TO service_role;

ALTER TABLE public.advance_invoice_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "advance_apps_select" ON public.advance_invoice_applications
  FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.advance_payments a
      WHERE a.id = advance_invoice_applications.advance_id
        AND a.requester_id = auth.uid()
    )
  );

CREATE POLICY "advance_apps_insert" ON public.advance_invoice_applications
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "advance_apps_update" ON public.advance_invoice_applications
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "advance_apps_delete" ON public.advance_invoice_applications
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER advance_apps_set_updated_at
  BEFORE UPDATE ON public.advance_invoice_applications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();