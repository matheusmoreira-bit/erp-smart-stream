-- Enforce per-company segregation: company_db is mandatory in tables that hold per-company data.
ALTER TABLE public.approval_rules ALTER COLUMN company_db SET NOT NULL;
ALTER TABLE public.suppliers ALTER COLUMN company_db SET NOT NULL;
ALTER TABLE public.expenses ALTER COLUMN company_db SET NOT NULL;
ALTER TABLE public.approval_history ALTER COLUMN company_db SET NOT NULL;

-- Indexes to keep per-company queries fast.
CREATE INDEX IF NOT EXISTS idx_approval_rules_company_db ON public.approval_rules(company_db);
CREATE INDEX IF NOT EXISTS idx_suppliers_company_db ON public.suppliers(company_db);
CREATE INDEX IF NOT EXISTS idx_expenses_company_db ON public.expenses(company_db);
CREATE INDEX IF NOT EXISTS idx_approval_history_company_db ON public.approval_history(company_db);