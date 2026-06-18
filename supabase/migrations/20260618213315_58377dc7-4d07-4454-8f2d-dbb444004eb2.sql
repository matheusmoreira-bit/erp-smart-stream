ALTER TABLE public.expenses
ADD COLUMN IF NOT EXISTS approval_rule_id UUID REFERENCES public.approval_rules(id) ON DELETE SET NULL;