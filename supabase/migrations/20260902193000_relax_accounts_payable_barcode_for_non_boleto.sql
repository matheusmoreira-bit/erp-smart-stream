-- CNAB 240 Sicoob: boleto exige código de barras; PIX/TED não usam barcode.
-- Migração cumulativa para bancos onde a constraint antiga já foi aplicada.

ALTER TABLE public.accounts_payable_batch_items
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'boleto',
  ADD COLUMN IF NOT EXISTS payment_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.accounts_payable_batch_items
  ALTER COLUMN barcode DROP NOT NULL;

ALTER TABLE public.accounts_payable_batch_items
  DROP CONSTRAINT IF EXISTS accounts_payable_batch_items_barcode_check;

ALTER TABLE public.accounts_payable_batch_items
  ADD CONSTRAINT accounts_payable_batch_items_barcode_check
  CHECK (
    (payment_method = 'boleto' AND barcode ~ '^\d{44}$')
    OR (payment_method <> 'boleto' AND (barcode IS NULL OR barcode = ''))
  );

DO $$
BEGIN
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
