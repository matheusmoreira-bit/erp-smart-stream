ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS freight_amount numeric(18,2) NOT NULL DEFAULT 0;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_freight_amount_range CHECK (freight_amount >= 0 AND freight_amount <= 100000000);
COMMENT ON COLUMN public.expenses.freight_amount IS 'Frete do pedido de compra, enviado ao SAP como despesa adicional (DocumentAdditionalExpenses).';