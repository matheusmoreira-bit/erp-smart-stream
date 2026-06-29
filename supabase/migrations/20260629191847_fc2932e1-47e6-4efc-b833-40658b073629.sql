
CREATE TABLE IF NOT EXISTS public.pagcorp_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  card_identifier text NOT NULL,
  card_name text,
  card_last_digits text,
  card_label text,
  account_alias text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, card_identifier)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagcorp_cards TO authenticated;
GRANT ALL ON public.pagcorp_cards TO service_role;

ALTER TABLE public.pagcorp_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pagcorp_cards"
  ON public.pagcorp_cards FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can upsert pagcorp_cards"
  ON public.pagcorp_cards FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update pagcorp_cards"
  ON public.pagcorp_cards FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS pagcorp_cards_company_idx
  ON public.pagcorp_cards (company_db, last_seen_at DESC);

CREATE TRIGGER trg_pagcorp_cards_updated_at
  BEFORE UPDATE ON public.pagcorp_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
