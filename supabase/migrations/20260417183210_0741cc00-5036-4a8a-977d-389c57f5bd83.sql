CREATE TABLE public.suppliers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db TEXT,
  card_code TEXT,
  card_name TEXT NOT NULL,
  card_type TEXT NOT NULL DEFAULT 'S',
  federal_tax_id TEXT,
  u_fgr_taxid0 TEXT,
  email TEXT,
  phone1 TEXT,
  phone2 TEXT,
  currency TEXT NOT NULL DEFAULT 'BRL',
  bill_to_street TEXT,
  bill_to_zip TEXT,
  bill_to_city TEXT,
  bill_to_state TEXT,
  bill_to_country TEXT DEFAULT 'BR',
  bill_to_block TEXT,
  bill_to_building TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sap_sync_status TEXT NOT NULL DEFAULT 'pending',
  sap_sync_error TEXT,
  sap_last_synced_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_db, card_code),
  UNIQUE (company_db, federal_tax_id)
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access suppliers" ON public.suppliers
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated can read suppliers" ON public.suppliers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert suppliers" ON public.suppliers
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update suppliers" ON public.suppliers
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anon can read suppliers" ON public.suppliers
  FOR SELECT TO anon USING (true);

CREATE POLICY "Anon can insert suppliers" ON public.suppliers
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Anon can update suppliers" ON public.suppliers
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE INDEX idx_suppliers_company ON public.suppliers(company_db);
CREATE INDEX idx_suppliers_taxid ON public.suppliers(federal_tax_id);
CREATE INDEX idx_suppliers_active ON public.suppliers(is_active);

CREATE TRIGGER update_suppliers_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();