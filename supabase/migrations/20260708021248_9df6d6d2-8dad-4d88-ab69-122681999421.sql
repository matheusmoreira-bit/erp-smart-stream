-- Reconcilia a despesa 35c1d3a2 com o último delegate_approval registrado
-- no audit_log (a atualização anterior falhou silenciosamente por RLS).
UPDATE public.expenses
SET current_approver = 'douglas.vinicius@anagaming.com.br',
    original_approver = 'Matheus Moreira',
    updated_at = now()
WHERE id = '35c1d3a2-8d72-490c-955b-ffe1e29c9938'
  AND status = 'pendente_aprovacao'
  AND current_approver = 'Matheus Moreira';