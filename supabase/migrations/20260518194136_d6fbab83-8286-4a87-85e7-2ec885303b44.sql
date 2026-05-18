-- Add doc_type to expenses to distinguish purchase ('purchase') from sales ('sales') orders
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'purchase';

CREATE INDEX IF NOT EXISTS idx_expenses_doc_type ON public.expenses(doc_type);

-- Allow null supplier_name when it's actually a customer for sales
-- (we'll reuse supplier_name/supplier_code as the BP name/code regardless)
COMMENT ON COLUMN public.expenses.doc_type IS 'purchase = pedido de compra (default); sales = pedido de venda';
COMMENT ON COLUMN public.expenses.supplier_name IS 'BP name (Fornecedor para compra; Cliente para venda)';
COMMENT ON COLUMN public.expenses.supplier_code IS 'BP CardCode (Fornecedor para compra; Cliente para venda)';