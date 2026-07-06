CREATE TABLE IF NOT EXISTS public.expense_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('approve', 'reject')),
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  level_order integer,
  actor_identity text NOT NULL,
  actor_email text,
  actor_source text NOT NULL CHECK (actor_source IN ('sap', 'cloud_admin', 'unknown')),
  is_cloud_admin boolean NOT NULL DEFAULT false,
  is_sap_superuser boolean NOT NULL DEFAULT false,
  override_used boolean NOT NULL DEFAULT false,
  substitution_id uuid,
  substituted_for_email text,
  substituted_for_name text,
  reason text,
  remarks text,
  ip_address text,
  user_agent text,
  request_id text,
  idempotency_key text,
  company_db text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_audit_log_expense
  ON public.expense_audit_log (expense_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_audit_log_actor
  ON public.expense_audit_log (actor_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expense_audit_log_created_at
  ON public.expense_audit_log (created_at DESC);

GRANT ALL ON public.expense_audit_log TO service_role;

ALTER TABLE public.expense_audit_log ENABLE ROW LEVEL SECURITY;
-- Nenhuma policy para anon/authenticated: escrita/leitura restrita ao
-- service_role (edge functions), garantindo integridade do audit trail.