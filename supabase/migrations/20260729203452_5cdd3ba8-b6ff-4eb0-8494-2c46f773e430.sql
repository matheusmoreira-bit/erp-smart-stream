-- 1) Fecha leitura pública de despesas (pentest 3.2)
DROP POLICY IF EXISTS "Anon can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated can read expenses" ON public.expenses;
DROP POLICY IF EXISTS "Anon can read expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Authenticated can read expense_items" ON public.expense_items;
DROP POLICY IF EXISTS "Anon can read expense_attachments" ON public.expense_attachments;
DROP POLICY IF EXISTS "Authenticated can read expense_attachments" ON public.expense_attachments;

REVOKE SELECT ON public.expenses FROM anon;
REVOKE SELECT ON public.expense_items FROM anon;
REVOKE SELECT ON public.expense_attachments FROM anon;

GRANT ALL ON public.expenses TO service_role;
GRANT ALL ON public.expense_items TO service_role;
GRANT ALL ON public.expense_attachments TO service_role;

-- Admin autenticado do Backoffice mantém acesso (política "Admins can manage ..." já existente)

-- 2) Idempotência da criação de pedidos (pentest 3.4 — race condition)
CREATE TABLE IF NOT EXISTS public.expense_create_idempotency (
  idempotency_key text PRIMARY KEY,
  caller_identity text NOT NULL,
  company_db text,
  fingerprint text NOT NULL,
  expense_id uuid,
  response jsonb,
  status_code integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

GRANT ALL ON public.expense_create_idempotency TO service_role;

ALTER TABLE public.expense_create_idempotency ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages expense_create_idempotency"
  ON public.expense_create_idempotency
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS expense_create_idempotency_fingerprint_idx
  ON public.expense_create_idempotency (fingerprint, created_at DESC);

CREATE INDEX IF NOT EXISTS expense_create_idempotency_created_at_idx
  ON public.expense_create_idempotency (created_at);