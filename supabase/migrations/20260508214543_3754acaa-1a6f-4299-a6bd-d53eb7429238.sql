CREATE TABLE public.whatsapp_login_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_db text NOT NULL,
  user_code text NOT NULL,
  failure_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  whatsapp_to text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT whatsapp_login_alerts_unique UNIQUE (company_db, user_code, failure_key)
);

CREATE INDEX idx_whatsapp_login_alerts_sent_at ON public.whatsapp_login_alerts (sent_at DESC);

ALTER TABLE public.whatsapp_login_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage whatsapp_login_alerts"
ON public.whatsapp_login_alerts
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read whatsapp_login_alerts"
ON public.whatsapp_login_alerts
FOR SELECT TO authenticated
USING (true);