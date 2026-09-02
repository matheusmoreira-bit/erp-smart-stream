-- Dados ocultos de instrumento de pagamento capturados a partir dos anexos.
-- Usados pelo Contas a Pagar para decidir se o título é boleto, PIX ou TED.

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_boleto_barcode text,
  ADD COLUMN IF NOT EXISTS payment_boleto_digitable_line text,
  ADD COLUMN IF NOT EXISTS payment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.accounts_payable_batch_items
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'boleto',
  ADD COLUMN IF NOT EXISTS payment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.accounts_payable_batch_items
  ALTER COLUMN barcode DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'expenses_payment_method_check'
      AND conrelid = 'public.expenses'::regclass
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_payment_method_check
      CHECK (payment_method IS NULL OR payment_method IN ('boleto', 'pix', 'ted', 'unknown'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'accounts_payable_batch_items_payment_method_check'
      AND conrelid = 'public.accounts_payable_batch_items'::regclass
  ) THEN
    ALTER TABLE public.accounts_payable_batch_items
      ADD CONSTRAINT accounts_payable_batch_items_payment_method_check
      CHECK (payment_method IN ('boleto', 'pix', 'ted', 'unknown'));
  END IF;
END $$;
