-- Fase S2.1 — remover políticas de escrita anônimas/authenticated abertas
-- em approval_rules e approval_rule_levels. Escrita fica só para admins
-- (policy "Admins can manage ..." já existente) ou service_role (bypass RLS).

-- approval_rules
DROP POLICY IF EXISTS "Anon can insert approval_rules"          ON public.approval_rules;
DROP POLICY IF EXISTS "Anon can update approval_rules"          ON public.approval_rules;
DROP POLICY IF EXISTS "Anon can delete approval_rules"          ON public.approval_rules;
DROP POLICY IF EXISTS "Authenticated can insert approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Authenticated can update approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Authenticated can delete approval_rules" ON public.approval_rules;

-- approval_rule_levels
DROP POLICY IF EXISTS "Anon can insert approval_rule_levels"          ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Anon can update approval_rule_levels"          ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Anon can delete approval_rule_levels"          ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Authenticated can insert approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Authenticated can update approval_rule_levels" ON public.approval_rule_levels;
DROP POLICY IF EXISTS "Authenticated can delete approval_rule_levels" ON public.approval_rule_levels;

-- SELECT permanece aberto (Anon/Authenticated can read *) — o app precisa ler
-- as regras para decidir aprovadores. Admin ALL policy cobre escrita legítima.