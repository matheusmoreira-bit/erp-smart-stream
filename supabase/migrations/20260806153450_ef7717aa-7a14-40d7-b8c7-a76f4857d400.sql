-- Índices de apoio ao recorte de visibilidade de documentos
CREATE INDEX IF NOT EXISTS idx_expenses_current_approver_lower ON public.expenses (lower(current_approver));
CREATE INDEX IF NOT EXISTS idx_expenses_requester_email_lower ON public.expenses (lower(requester_email));
CREATE INDEX IF NOT EXISTS idx_expenses_created_by_email_lower ON public.expenses (lower(created_by_email));
CREATE INDEX IF NOT EXISTS idx_expenses_company_status_created ON public.expenses (company_db, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_items_cost_center ON public.expense_items (cost_center);

-- Índices nunca usados ocupando disco (banco em 77% de uso)
DROP INDEX IF EXISTS public.idx_audit_trail_table;
DROP INDEX IF EXISTS public.idx_audit_trail_actor;
DROP INDEX IF EXISTS public.idx_edge_function_metrics_fn_time;

ANALYZE public.expenses;
ANALYZE public.expense_items;