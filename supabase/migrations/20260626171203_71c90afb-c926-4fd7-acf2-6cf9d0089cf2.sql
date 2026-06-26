-- Fase 1: Endurecer RLS sem alterar UX para usuários autenticados

-- 1) expenses: remover policies anon (mantém policies authenticated existentes)
DROP POLICY IF EXISTS "Anon can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can insert expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can update expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can delete expenses" ON public.expenses;

-- 2) expense_items: remover policies anon
DROP POLICY IF EXISTS "Anon can read expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can insert expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can update expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can delete expense_items" ON public.expense_items;

-- Revogar grants do anon (defensivo)
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.expenses FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.expense_items FROM anon;

-- 3) approval_rules / approval_rule_levels: derrubar leitura anônima
DROP POLICY IF EXISTS "Anon can read approval_rules" ON public.approval_rules;
DROP POLICY IF EXISTS "Anon can read approval_rule_levels" ON public.approval_rule_levels;
REVOKE SELECT ON public.approval_rules FROM anon;
REVOKE SELECT ON public.approval_rule_levels FROM anon;

-- 4) audit_log: bloquear INSERT direto; manter via SECURITY DEFINER (insert_audit_log)
DROP POLICY IF EXISTS "Authenticated can insert audit_log" ON public.audit_log;
REVOKE INSERT ON public.audit_log FROM authenticated, anon;
-- service_role e a função SECURITY DEFINER continuam podendo inserir
GRANT INSERT ON public.audit_log TO service_role;