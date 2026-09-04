-- Contas a Pagar: remessas e retornos CNAB 240 (Sicoob).
-- As tabelas são acessadas exclusivamente pelas Edge Functions com service_role.

CREATE TABLE IF NOT EXISTS public.accounts_payable_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL UNIQUE,
  bank_code text NOT NULL DEFAULT '756',
  legal_name text NOT NULL,
  tax_id text NOT NULL,
  agreement_code text NOT NULL,
  agency text NOT NULL,
  agency_digit text NOT NULL DEFAULT '',
  account_number text NOT NULL,
  account_digit text NOT NULL,
  agency_account_digit text NOT NULL DEFAULT '',
  sap_transfer_account text NOT NULL,
  next_file_sequence integer NOT NULL DEFAULT 1 CHECK (next_file_sequence > 0),
  active boolean NOT NULL DEFAULT true,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_payable_bank_code_digits CHECK (bank_code ~ '^\d{3}$'),
  CONSTRAINT accounts_payable_tax_id_digits CHECK (regexp_replace(tax_id, '\D', '', 'g') <> '')
);

CREATE TABLE IF NOT EXISTS public.accounts_payable_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  bank_account_id uuid NOT NULL REFERENCES public.accounts_payable_bank_accounts(id),
  file_sequence integer NOT NULL CHECK (file_sequence > 0),
  status text NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'return_imported', 'processing', 'processed', 'partial', 'error', 'cancelled')),
  filename text NOT NULL,
  payment_date date NOT NULL,
  title_count integer NOT NULL DEFAULT 0 CHECK (title_count >= 0),
  total_amount numeric(19, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  content_sha256 text NOT NULL,
  generated_by text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  return_filename text,
  return_sha256 text,
  return_imported_by text,
  return_imported_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, file_sequence),
  UNIQUE (content_sha256),
  UNIQUE (return_sha256)
);

CREATE TABLE IF NOT EXISTS public.accounts_payable_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.accounts_payable_batches(id) ON DELETE CASCADE,
  company_db text NOT NULL,
  sap_doc_entry integer NOT NULL,
  sap_doc_num integer,
  installment_id integer NOT NULL DEFAULT 0,
  supplier_code text NOT NULL,
  supplier_name text NOT NULL,
  supplier_tax_id text,
  due_date date NOT NULL,
  scheduled_date date NOT NULL,
  amount numeric(19, 2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'BRL',
  barcode text NOT NULL CHECK (barcode ~ '^\d{44}$'),
  company_reference text NOT NULL CHECK (char_length(company_reference) <= 20),
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'remitted'
    CHECK (status IN ('remitted', 'scheduled', 'bank_rejected', 'paid', 'sap_processing', 'sap_settled', 'sap_error', 'already_settled', 'cancelled')),
  return_occurrences text[] NOT NULL DEFAULT '{}'::text[],
  bank_protocol text,
  paid_date date,
  paid_amount numeric(19, 2),
  sap_payment_doc_entry integer,
  sap_payment_doc_num integer,
  sap_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, company_reference),
  UNIQUE (company_db, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.accounts_payable_return_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.accounts_payable_batches(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.accounts_payable_batch_items(id) ON DELETE SET NULL,
  company_db text NOT NULL,
  return_sha256 text NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  segment text NOT NULL,
  occurrence_codes text[] NOT NULL DEFAULT '{}'::text[],
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'ignored', 'scheduled', 'rejected', 'paid', 'sap_settled', 'sap_error')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (return_sha256, line_number)
);

CREATE INDEX IF NOT EXISTS accounts_payable_batches_company_idx
  ON public.accounts_payable_batches(company_db, generated_at DESC);
CREATE INDEX IF NOT EXISTS accounts_payable_items_batch_idx
  ON public.accounts_payable_batch_items(batch_id, status);
CREATE INDEX IF NOT EXISTS accounts_payable_items_doc_idx
  ON public.accounts_payable_batch_items(company_db, sap_doc_entry, installment_id);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_payable_items_active_title_unique
  ON public.accounts_payable_batch_items(company_db, sap_doc_entry, installment_id)
  WHERE status IN ('remitted', 'scheduled', 'paid', 'sap_processing', 'sap_error');

ALTER TABLE public.accounts_payable_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_payable_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_payable_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts_payable_return_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_payable_bank_accounts service role only"
  ON public.accounts_payable_bank_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "accounts_payable_batches service role only"
  ON public.accounts_payable_batches FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "accounts_payable_batch_items service role only"
  ON public.accounts_payable_batch_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "accounts_payable_return_events service role only"
  ON public.accounts_payable_return_events FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER accounts_payable_bank_accounts_updated_at
  BEFORE UPDATE ON public.accounts_payable_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER accounts_payable_batches_updated_at
  BEFORE UPDATE ON public.accounts_payable_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER accounts_payable_batch_items_updated_at
  BEFORE UPDATE ON public.accounts_payable_batch_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Reserva atômica do NSA do arquivo; evita duas remessas com a mesma sequência.
CREATE OR REPLACE FUNCTION public.reserve_accounts_payable_file_sequence(p_company_db text)
RETURNS TABLE(bank_account_id uuid, file_sequence integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_sequence integer;
BEGIN
  SELECT id, next_file_sequence
    INTO v_id, v_sequence
  FROM public.accounts_payable_bank_accounts
  WHERE company_db = p_company_db AND active = true
  FOR UPDATE;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Configuração bancária ativa não encontrada para %', p_company_db;
  END IF;

  UPDATE public.accounts_payable_bank_accounts
  SET next_file_sequence = v_sequence + 1, updated_at = now()
  WHERE id = v_id;

  RETURN QUERY SELECT v_id, v_sequence;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_accounts_payable_file_sequence(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_accounts_payable_file_sequence(text) TO service_role;

-- Lock lógico idempotente antes de publicar um VendorPayment no SAP.
CREATE OR REPLACE FUNCTION public.claim_accounts_payable_item(p_item_id uuid)
RETURNS SETOF public.accounts_payable_batch_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.accounts_payable_batch_items
  SET status = 'sap_processing', sap_error = NULL, updated_at = now()
  WHERE id = p_item_id
    AND sap_payment_doc_entry IS NULL
    AND (
      status IN ('remitted', 'scheduled', 'paid', 'sap_error')
      OR (status = 'sap_processing' AND updated_at < now() - interval '10 minutes')
    )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_accounts_payable_item(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_accounts_payable_item(uuid) TO service_role;
