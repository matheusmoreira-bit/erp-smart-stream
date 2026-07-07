
CREATE TABLE IF NOT EXISTS public.expense_action_idempotency (
  idempotency_key text PRIMARY KEY,
  expense_id uuid NOT NULL,
  action text NOT NULL,
  status_code integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS expense_action_idempotency_expense_idx
  ON public.expense_action_idempotency(expense_id, created_at DESC);

GRANT ALL ON public.expense_action_idempotency TO service_role;

ALTER TABLE public.expense_action_idempotency ENABLE ROW LEVEL SECURITY;

-- Nenhuma política pública: somente o service_role (edge function) acessa.
CREATE POLICY "service_role only" ON public.expense_action_idempotency
  FOR ALL TO service_role USING (true) WITH CHECK (true);
