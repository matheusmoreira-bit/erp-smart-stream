ALTER TABLE public.approval_rules
  ADD COLUMN IF NOT EXISTS auto_approve boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.approval_rules.auto_approve IS
  'When true, matching documents are approved automatically without approval levels.';
