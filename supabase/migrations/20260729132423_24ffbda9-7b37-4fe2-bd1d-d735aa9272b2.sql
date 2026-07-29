CREATE TABLE public.sales_order_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  sap_order_doc_entry integer,
  sap_invoice_doc_entry integer,
  sap_invoice_doc_num integer,
  nfse_number text,
  rps_number text,
  series text,
  authorized_at timestamptz,
  total_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'BRL',
  status text NOT NULL DEFAULT 'pending',
  last_error text,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_soi_expense ON public.sales_order_invoices(expense_id);
CREATE INDEX idx_soi_company_status ON public.sales_order_invoices(company_db, status);
CREATE UNIQUE INDEX idx_soi_sap_invoice ON public.sales_order_invoices(company_db, sap_invoice_doc_entry) WHERE sap_invoice_doc_entry IS NOT NULL;

GRANT SELECT ON public.sales_order_invoices TO authenticated;
GRANT ALL ON public.sales_order_invoices TO service_role;

ALTER TABLE public.sales_order_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read sales order invoices"
  ON public.sales_order_invoices FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage sales order invoices"
  ON public.sales_order_invoices FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_sales_order_invoices_updated_at
  BEFORE UPDATE ON public.sales_order_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();