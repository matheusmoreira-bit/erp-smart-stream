ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS trade_name text,
  ADD COLUMN IF NOT EXISTS tax_id text,
  ADD COLUMN IF NOT EXISTS foreign_name text,
  ADD COLUMN IF NOT EXISTS is_foreign boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS companies_tax_id_idx ON public.companies (tax_id);