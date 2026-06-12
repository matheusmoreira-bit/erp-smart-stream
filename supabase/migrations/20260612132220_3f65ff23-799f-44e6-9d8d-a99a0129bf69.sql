
CREATE TABLE public.pagcorp_card_mapping (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT NOT NULL,
  card_identifier TEXT,
  card_label TEXT,
  is_fallback BOOLEAN NOT NULL DEFAULT false,
  cost_center TEXT,
  project TEXT,
  item_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pagcorp_card_mapping_fallback_or_card CHECK (
    (is_fallback = true AND card_identifier IS NULL) OR
    (is_fallback = false AND card_identifier IS NOT NULL)
  )
);

CREATE UNIQUE INDEX pagcorp_card_mapping_uq_card
  ON public.pagcorp_card_mapping (company_db, card_identifier)
  WHERE is_fallback = false;

CREATE UNIQUE INDEX pagcorp_card_mapping_uq_fallback
  ON public.pagcorp_card_mapping (company_db)
  WHERE is_fallback = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagcorp_card_mapping TO authenticated;
GRANT ALL ON public.pagcorp_card_mapping TO service_role;

ALTER TABLE public.pagcorp_card_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access to pagcorp_card_mapping"
  ON public.pagcorp_card_mapping FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read pagcorp_card_mapping"
  ON public.pagcorp_card_mapping FOR SELECT
  TO authenticated USING (true);

CREATE TRIGGER trg_pagcorp_card_mapping_updated_at
  BEFORE UPDATE ON public.pagcorp_card_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
