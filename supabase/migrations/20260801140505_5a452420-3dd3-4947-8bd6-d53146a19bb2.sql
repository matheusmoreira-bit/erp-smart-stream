ALTER TABLE public.sales_order_invoices ALTER COLUMN expense_id DROP NOT NULL;
ALTER TABLE public.sales_order_invoices ADD COLUMN IF NOT EXISTS sap_order_doc_num integer;
CREATE UNIQUE INDEX IF NOT EXISTS sales_order_invoices_erp_order_uniq
  ON public.sales_order_invoices (company_db, sap_order_doc_entry)
  WHERE expense_id IS NULL AND status <> 'failed';