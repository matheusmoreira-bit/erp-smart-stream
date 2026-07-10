ALTER TABLE public.pagcorp_settlement_accounts
  ADD COLUMN IF NOT EXISTS currency text;

DROP INDEX IF EXISTS public.pagcorp_settlement_accounts_uq_card;
DROP INDEX IF EXISTS public.pagcorp_settlement_accounts_uq_fallback;

-- Uma conta por (empresa, cartão, moeda). currency NULL = "qualquer moeda".
CREATE UNIQUE INDEX pagcorp_settlement_accounts_uq_card
  ON public.pagcorp_settlement_accounts (company_db, card_identifier, COALESCE(currency, ''))
  WHERE card_identifier IS NOT NULL;

-- Fallback por (empresa, moeda). Duas linhas por empresa: uma BRL, uma USD (ou uma sem moeda para retrocompatibilidade).
CREATE UNIQUE INDEX pagcorp_settlement_accounts_uq_fallback
  ON public.pagcorp_settlement_accounts (company_db, COALESCE(currency, ''))
  WHERE card_identifier IS NULL;