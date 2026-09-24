ALTER TABLE public.accounts_payable_batches
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.accounts_payable_batches DROP CONSTRAINT IF EXISTS accounts_payable_batches_status_check;
ALTER TABLE public.accounts_payable_batches ADD CONSTRAINT accounts_payable_batches_status_check
  CHECK (status = ANY (ARRAY['generated','approved','return_imported','processing','processed','partial','error','cancelled']));
ALTER TABLE public.accounts_payable_batches ADD CONSTRAINT accounts_payable_batches_approver_differs
  CHECK (approved_by IS NULL OR lower(approved_by) <> lower(coalesce(generated_by,'')));

ALTER TABLE public.accounts_payable_supplier_payment_profiles
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.accounts_payable_supplier_payment_profiles ADD CONSTRAINT ap_supplier_profile_approval_status_check
  CHECK (approval_status IN ('pending','approved'));
ALTER TABLE public.accounts_payable_supplier_payment_profiles ADD CONSTRAINT ap_supplier_profile_approver_differs
  CHECK (approved_by IS NULL OR lower(approved_by) <> lower(coalesce(created_by,'')));