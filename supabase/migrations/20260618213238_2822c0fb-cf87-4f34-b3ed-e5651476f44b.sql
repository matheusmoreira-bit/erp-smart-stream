CREATE TABLE public.expense_approval_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  level_order INTEGER,
  approver_name TEXT,
  approver_email TEXT,
  decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','submitted','created','cancelled','integrated','integration_failed')),
  remarks TEXT,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_approval_log_expense_id ON public.expense_approval_log(expense_id, decided_at);

GRANT SELECT, INSERT ON public.expense_approval_log TO authenticated;
GRANT ALL ON public.expense_approval_log TO service_role;

ALTER TABLE public.expense_approval_log ENABLE ROW LEVEL SECURITY;

-- Quem pode ler: o solicitante, o aprovador atual da despesa, ou admin
CREATE POLICY "Read approval log of accessible expenses"
ON public.expense_approval_log
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.expenses e
    JOIN auth.users u ON u.id = auth.uid()
    WHERE e.id = expense_approval_log.expense_id
      AND (
        lower(e.requester_email) = lower(u.email)
        OR lower(e.created_by_email) = lower(u.email)
        OR lower(COALESCE(e.current_approver, '')) = lower(u.email)
        OR lower(COALESCE(e.current_approver, '')) = lower(split_part(u.email, '@', 1))
      )
  )
);

-- Inserts: somente para despesas que o usuário enxerga
CREATE POLICY "Insert approval log for accessible expenses"
ON public.expense_approval_log
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.expenses e
    JOIN auth.users u ON u.id = auth.uid()
    WHERE e.id = expense_approval_log.expense_id
      AND (
        lower(e.requester_email) = lower(u.email)
        OR lower(e.created_by_email) = lower(u.email)
        OR lower(COALESCE(e.current_approver, '')) = lower(u.email)
        OR lower(COALESCE(e.current_approver, '')) = lower(split_part(u.email, '@', 1))
      )
  )
);