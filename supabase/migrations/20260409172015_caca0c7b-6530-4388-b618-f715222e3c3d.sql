
-- Approval rules table
CREATE TABLE public.approval_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority INTEGER NOT NULL DEFAULT 0,
  min_value NUMERIC(18,2),
  max_value NUMERIC(18,2),
  cost_center TEXT,
  project TEXT,
  requester_pattern TEXT,
  doc_type TEXT,
  created_by TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Approval rule levels (N levels per rule)
CREATE TABLE public.approval_rule_levels (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_id UUID NOT NULL REFERENCES public.approval_rules(id) ON DELETE CASCADE,
  level_order INTEGER NOT NULL,
  approver_name TEXT NOT NULL,
  approver_email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(rule_id, level_order)
);

-- Enable RLS
ALTER TABLE public.approval_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_rule_levels ENABLE ROW LEVEL SECURITY;

-- Open policies (SAP auth)
CREATE POLICY "Allow all access to approval_rules" ON public.approval_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all access to approval_rule_levels" ON public.approval_rule_levels FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX idx_approval_rules_active ON public.approval_rules(is_active);
CREATE INDEX idx_approval_rule_levels_rule ON public.approval_rule_levels(rule_id);

-- Trigger
CREATE TRIGGER update_approval_rules_updated_at
  BEFORE UPDATE ON public.approval_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
