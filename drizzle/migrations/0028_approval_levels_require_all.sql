ALTER TABLE public.approval_rule_levels
  ADD COLUMN IF NOT EXISTS require_all boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.approval_rule_levels.require_all IS
  'Quando true, TODOS os aprovadores deste nivel precisam aprovar para o documento avancar (aprovacao unanime). Quando false, o primeiro que decidir encerra o nivel.';