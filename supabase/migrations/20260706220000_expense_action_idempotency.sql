-- Idempotência para expense-approval-action.
-- Guarda a resposta original por Idempotency-Key para que retries
-- (perda de conexão, botão pressionado duas vezes) não gerem
-- processamento duplicado.

CREATE TABLE IF NOT EXISTS public.expense_action_idempotency (
  idempotency_key text PRIMARY KEY,
  expense_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('approve', 'reject')),
  status_code integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT ALL ON public.expense_action_idempotency TO service_role;

ALTER TABLE public.expense_action_idempotency ENABLE ROW LEVEL SECURITY;

-- Sem policies: apenas o service_role (edge function) lê/escreve.
-- Nenhum papel `anon`/`authenticated` deve consultar chaves de idempotência.

CREATE INDEX IF NOT EXISTS idx_expense_action_idempotency_expense
  ON public.expense_action_idempotency (expense_id);
CREATE INDEX IF NOT EXISTS idx_expense_action_idempotency_created
  ON public.expense_action_idempotency (created_at);
