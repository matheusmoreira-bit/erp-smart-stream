ALTER TABLE public.baixas_recebimento_itens
  ADD COLUMN IF NOT EXISTS invoice_type text NOT NULL DEFAULT 'invoice',
  ADD COLUMN IF NOT EXISTS invoice_doc_line integer;

ALTER TABLE public.baixas_recebimento_itens
  DROP CONSTRAINT IF EXISTS baixas_recebimento_itens_invoice_type_chk;

ALTER TABLE public.baixas_recebimento_itens
  ADD CONSTRAINT baixas_recebimento_itens_invoice_type_chk
  CHECK (invoice_type IN ('invoice','journal_entry'));