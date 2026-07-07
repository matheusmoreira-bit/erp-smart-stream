
ALTER TABLE public.expense_approval_log
  ADD COLUMN IF NOT EXISTS action_role text;

ALTER TABLE public.expense_audit_log
  ADD COLUMN IF NOT EXISTS action_role text;

COMMENT ON COLUMN public.expense_approval_log.action_role IS
  'Papel do usuário no momento da decisão: approver | substitute | delegation | admin_override | attempt_denied';
COMMENT ON COLUMN public.expense_audit_log.action_role IS
  'Papel do usuário no momento da decisão: approver | substitute | delegation | admin_override | attempt_denied';
