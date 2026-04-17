ALTER TABLE public.approval_rules ADD COLUMN IF NOT EXISTS company_db text;
CREATE INDEX IF NOT EXISTS idx_approval_rules_company_db ON public.approval_rules(company_db);