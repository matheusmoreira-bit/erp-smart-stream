-- Permitir leitura de decisões finalizadas do histórico de aprovações
-- (alinha com a política já existente na tabela expenses, que é lida pelo mesmo cliente).
DROP POLICY IF EXISTS "Read finalized approval log" ON public.expense_approval_log;
CREATE POLICY "Read finalized approval log"
ON public.expense_approval_log
FOR SELECT
TO anon, authenticated
USING (decision IN ('approved','rejected','integrated','cancelled'));

GRANT SELECT ON public.expense_approval_log TO anon;