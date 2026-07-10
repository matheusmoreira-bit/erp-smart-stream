ALTER TABLE public.approval_rule_levels
  DROP CONSTRAINT IF EXISTS approval_rule_levels_rule_id_level_order_key;
CREATE INDEX IF NOT EXISTS approval_rule_levels_rule_id_level_order_idx
  ON public.approval_rule_levels (rule_id, level_order);