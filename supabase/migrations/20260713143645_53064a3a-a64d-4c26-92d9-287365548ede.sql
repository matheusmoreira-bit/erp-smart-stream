
DROP INDEX IF EXISTS public.pagcorp_settlement_accounts_uq_fallback;
DROP INDEX IF EXISTS public.pagcorp_settlement_accounts_uq_card;

CREATE UNIQUE INDEX pagcorp_settlement_accounts_uq_fallback
  ON public.pagcorp_settlement_accounts
  (company_db, COALESCE(event_classification, ''), COALESCE(currency, ''))
  WHERE card_identifier IS NULL;

CREATE UNIQUE INDEX pagcorp_settlement_accounts_uq_card
  ON public.pagcorp_settlement_accounts
  (company_db, card_identifier, COALESCE(event_classification, ''), COALESCE(currency, ''))
  WHERE card_identifier IS NOT NULL;
