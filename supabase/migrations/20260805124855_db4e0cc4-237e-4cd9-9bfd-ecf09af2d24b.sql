CREATE TABLE public.notification_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid,
  company_db text,
  doc_type text,
  channel text NOT NULL,
  recipient text NOT NULL,
  recipient_name text,
  recipient_role text NOT NULL DEFAULT 'approver',
  level_order integer,
  event_key text NOT NULL DEFAULT 'approval_pending',
  status text NOT NULL DEFAULT 'sent',
  resolution_source text,
  resolution_reason text,
  rule_id uuid,
  rule_name text,
  matrix_version text,
  cost_center text,
  project text,
  amount numeric,
  currency text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_audit_log TO authenticated;
GRANT ALL ON public.notification_audit_log TO service_role;

ALTER TABLE public.notification_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_audit_log_select ON public.notification_audit_log
  FOR SELECT TO authenticated USING (true);

CREATE INDEX idx_notification_audit_log_expense ON public.notification_audit_log (expense_id, created_at DESC);
CREATE INDEX idx_notification_audit_log_created ON public.notification_audit_log (created_at DESC);
CREATE INDEX idx_notification_audit_log_recipient ON public.notification_audit_log (lower(recipient));