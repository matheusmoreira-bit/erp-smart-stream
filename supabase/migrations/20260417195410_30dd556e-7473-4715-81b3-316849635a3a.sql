
CREATE TABLE public.pagcorp_supplier_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db text,
  -- Identifier extracted from the receipt by AI
  federal_tax_id text,
  card_name_key text,
  -- Resolution
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  card_code text,
  card_name text,
  -- 'imported' = created via integration; 'linked' = bound to existing; 'ignored' = skip forever
  resolution text NOT NULL DEFAULT 'linked',
  resolved_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pagcorp_links_tax ON public.pagcorp_supplier_links (company_db, federal_tax_id);
CREATE INDEX idx_pagcorp_links_name ON public.pagcorp_supplier_links (company_db, card_name_key);

ALTER TABLE public.pagcorp_supplier_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access pagcorp_supplier_links"
  ON public.pagcorp_supplier_links FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anon can read pagcorp_supplier_links"
  ON public.pagcorp_supplier_links FOR SELECT TO anon USING (true);
CREATE POLICY "Authenticated can read pagcorp_supplier_links"
  ON public.pagcorp_supplier_links FOR SELECT TO authenticated USING (true);

CREATE POLICY "Anon can insert pagcorp_supplier_links"
  ON public.pagcorp_supplier_links FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Authenticated can insert pagcorp_supplier_links"
  ON public.pagcorp_supplier_links FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Anon can update pagcorp_supplier_links"
  ON public.pagcorp_supplier_links FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can update pagcorp_supplier_links"
  ON public.pagcorp_supplier_links FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anon can delete pagcorp_supplier_links"
  ON public.pagcorp_supplier_links FOR DELETE TO anon USING (true);
CREATE POLICY "Authenticated can delete pagcorp_supplier_links"
  ON public.pagcorp_supplier_links FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_pagcorp_supplier_links_updated_at
  BEFORE UPDATE ON public.pagcorp_supplier_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
