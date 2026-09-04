-- Dados complementares de pagamento do fornecedor para Contas a Pagar.
-- Acesso somente via Edge Function, com auditoria em audit_log.

CREATE TABLE IF NOT EXISTS public.accounts_payable_supplier_payment_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  supplier_code text NOT NULL,
  supplier_name text,
  supplier_tax_id text,
  payment_method text NOT NULL CHECK (payment_method IN ('pix', 'ted')),
  beneficiary_name text NOT NULL,
  beneficiary_tax_id text NOT NULL,
  bank_code text,
  branch text,
  branch_digit text,
  account_number text,
  account_digit text,
  account_type text,
  pix_key_type text,
  pix_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, supplier_code)
);

CREATE INDEX IF NOT EXISTS accounts_payable_supplier_payment_profiles_company_idx
  ON public.accounts_payable_supplier_payment_profiles(company_db, supplier_code);

ALTER TABLE public.accounts_payable_supplier_payment_profiles ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.accounts_payable_supplier_payment_profiles TO service_role;

CREATE POLICY "accounts_payable_supplier_payment_profiles service role only"
  ON public.accounts_payable_supplier_payment_profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TRIGGER accounts_payable_supplier_payment_profiles_updated_at
  BEFORE UPDATE ON public.accounts_payable_supplier_payment_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
