ALTER TABLE public.idp_user_mapping
  ADD COLUMN IF NOT EXISTS employee_id text,
  ADD COLUMN IF NOT EXISTS employee_type text,
  ADD COLUMN IF NOT EXISTS job_title text,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS cost_center_code text,
  ADD COLUMN IF NOT EXISTS cost_center_label text,
  ADD COLUMN IF NOT EXISTS manager_idp_id text,
  ADD COLUMN IF NOT EXISTS attributes_synced_at timestamptz;