-- Tabela de contas contábeis de baixa PagCorp
CREATE TABLE public.pagcorp_settlement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  card_identifier text,
  settlement_account_code text NOT NULL,
  cost_center text,
  project text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pagcorp_settlement_accounts_uq_card
  ON public.pagcorp_settlement_accounts (company_db, card_identifier)
  WHERE card_identifier IS NOT NULL;

CREATE UNIQUE INDEX pagcorp_settlement_accounts_uq_fallback
  ON public.pagcorp_settlement_accounts (company_db)
  WHERE card_identifier IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagcorp_settlement_accounts TO authenticated;
GRANT ALL ON public.pagcorp_settlement_accounts TO service_role;

ALTER TABLE public.pagcorp_settlement_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to pagcorp_settlement_accounts"
  ON public.pagcorp_settlement_accounts
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read pagcorp_settlement_accounts"
  ON public.pagcorp_settlement_accounts
  FOR SELECT
  TO authenticated
  USING (true);

CREATE TRIGGER trg_pagcorp_settlement_accounts_updated_at
  BEFORE UPDATE ON public.pagcorp_settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Colunas de rastreamento de baixa em pagcorp_integration_log
ALTER TABLE public.pagcorp_integration_log
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settlement_journal_entry integer,
  ADD COLUMN IF NOT EXISTS settlement_invoice_doc_entry integer,
  ADD COLUMN IF NOT EXISTS settlement_invoice_doc_num integer,
  ADD COLUMN IF NOT EXISTS settlement_error text,
  ADD COLUMN IF NOT EXISTS settlement_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS settlement_locked_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_pagcorp_log_settlement_status
  ON public.pagcorp_integration_log (settlement_status)
  WHERE settlement_status IN ('pending','awaiting_invoice','awaiting_settlement','error');
