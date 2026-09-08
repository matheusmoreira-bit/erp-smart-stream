CREATE TABLE IF NOT EXISTS public.whatsapp_flow_approval_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  expense_id uuid NOT NULL,
  approver_code text NOT NULL,
  whatsapp_to text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wfaa_lookup ON public.whatsapp_flow_approval_alerts (company_db, expense_id, approver_code, sent_at DESC);
GRANT ALL ON public.whatsapp_flow_approval_alerts TO service_role;
ALTER TABLE public.whatsapp_flow_approval_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wfaa_admin_read" ON public.whatsapp_flow_approval_alerts;
CREATE POLICY "wfaa_admin_read" ON public.whatsapp_flow_approval_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.whatsapp_flow_approval_alerts TO authenticated;