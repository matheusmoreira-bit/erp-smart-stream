
CREATE TABLE public.pagcorp_nondeductible_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pagcorp_expense_id bigint NOT NULL,
  company_db text NOT NULL,
  supplier_code text,
  supplier_name text,
  reason text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pagcorp_expense_id, company_db)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pagcorp_nondeductible_expenses TO authenticated;
GRANT ALL ON public.pagcorp_nondeductible_expenses TO service_role;

ALTER TABLE public.pagcorp_nondeductible_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read nondeductible expenses"
  ON public.pagcorp_nondeductible_expenses FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert nondeductible expenses"
  ON public.pagcorp_nondeductible_expenses FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can update nondeductible expenses"
  ON public.pagcorp_nondeductible_expenses FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete nondeductible expenses"
  ON public.pagcorp_nondeductible_expenses FOR DELETE TO authenticated
  USING (true);

CREATE TRIGGER trg_pagcorp_nd_expenses_updated_at
  BEFORE UPDATE ON public.pagcorp_nondeductible_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pagcorp_nd_expenses_company ON public.pagcorp_nondeductible_expenses (company_db);
CREATE INDEX idx_pagcorp_nd_expenses_expense ON public.pagcorp_nondeductible_expenses (pagcorp_expense_id);
