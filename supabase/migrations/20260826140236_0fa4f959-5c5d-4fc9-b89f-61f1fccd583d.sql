ALTER TABLE public.approval_rules
  ADD COLUMN IF NOT EXISTS auto_approve boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.approval_rules.auto_approve IS
  'Quando true, documentos que casarem com esta regra sao aprovados automaticamente.';