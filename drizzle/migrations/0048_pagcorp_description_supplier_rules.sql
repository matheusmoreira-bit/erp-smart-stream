CREATE TABLE public.pagcorp_description_supplier_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  pattern text NOT NULL,
  match_type text NOT NULL DEFAULT 'startswith',
  supplier_code text NOT NULL,
  supplier_name text,
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagcorp_desc_rule_match_type_chk CHECK (match_type IN ('startswith','contains')),
  CONSTRAINT pagcorp_desc_rule_pattern_chk CHECK (length(btrim(pattern)) > 0)
);

CREATE UNIQUE INDEX pagcorp_desc_rule_unique_idx
  ON public.pagcorp_description_supplier_rules (company_db, lower(btrim(pattern)), match_type);

CREATE INDEX pagcorp_desc_rule_company_idx
  ON public.pagcorp_description_supplier_rules (company_db) WHERE is_active;

GRANT SELECT ON public.pagcorp_description_supplier_rules TO authenticated;
GRANT ALL ON public.pagcorp_description_supplier_rules TO service_role;

ALTER TABLE public.pagcorp_description_supplier_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pagcorp_description_supplier_rules"
  ON public.pagcorp_description_supplier_rules FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins full access to pagcorp_description_supplier_rules"
  ON public.pagcorp_description_supplier_rules FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER pagcorp_desc_rule_updated_at
  BEFORE UPDATE ON public.pagcorp_description_supplier_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
