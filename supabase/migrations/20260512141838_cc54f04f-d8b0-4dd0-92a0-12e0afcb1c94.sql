CREATE TABLE public.license_idle_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  user_code text NOT NULL,
  alert_week text NOT NULL,
  license_type text,
  days_idle integer,
  whatsapp_to text,
  email_to text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, user_code, alert_week)
);

ALTER TABLE public.license_idle_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage license_idle_alerts" ON public.license_idle_alerts
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read license_idle_alerts" ON public.license_idle_alerts
  FOR SELECT TO authenticated USING (true);