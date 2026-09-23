CREATE TABLE public.pagcorp_card_supplier_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  card_identifier text NOT NULL,
  card_label text,
  supplier_code text NOT NULL,
  supplier_name text,
  cost_center text,
  project text,
  item_code text,
  account_code text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagcorp_cs_card_chk CHECK (length(btrim(card_identifier)) > 0),
  CONSTRAINT pagcorp_cs_supplier_chk CHECK (length(btrim(supplier_code)) > 0)
);

CREATE UNIQUE INDEX pagcorp_cs_unique_idx
  ON public.pagcorp_card_supplier_mapping (company_db, lower(btrim(card_identifier)), btrim(supplier_code));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagcorp_card_supplier_mapping TO authenticated;
GRANT ALL ON public.pagcorp_card_supplier_mapping TO service_role;

ALTER TABLE public.pagcorp_card_supplier_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins select pagcorp_card_supplier_mapping" ON public.pagcorp_card_supplier_mapping
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert pagcorp_card_supplier_mapping" ON public.pagcorp_card_supplier_mapping
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins update pagcorp_card_supplier_mapping" ON public.pagcorp_card_supplier_mapping
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins delete pagcorp_card_supplier_mapping" ON public.pagcorp_card_supplier_mapping
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER pagcorp_cs_updated_at
  BEFORE UPDATE ON public.pagcorp_card_supplier_mapping
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();