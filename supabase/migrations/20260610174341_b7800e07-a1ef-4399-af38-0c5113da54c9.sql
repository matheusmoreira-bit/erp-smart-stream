CREATE TABLE public.pagcorp_nondeductible_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  card_identifier text NOT NULL,
  card_label text,
  card_holder text,
  supplier_code text NOT NULL,
  supplier_name text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, card_identifier)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagcorp_nondeductible_cards TO authenticated;
GRANT ALL ON public.pagcorp_nondeductible_cards TO service_role;

ALTER TABLE public.pagcorp_nondeductible_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read nondeductible cards"
  ON public.pagcorp_nondeductible_cards FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Admins manage nondeductible cards (insert)"
  ON public.pagcorp_nondeductible_cards FOR INSERT
  TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage nondeductible cards (update)"
  ON public.pagcorp_nondeductible_cards FOR UPDATE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins manage nondeductible cards (delete)"
  ON public.pagcorp_nondeductible_cards FOR DELETE
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_pagcorp_nondeductible_cards_updated_at
  BEFORE UPDATE ON public.pagcorp_nondeductible_cards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();