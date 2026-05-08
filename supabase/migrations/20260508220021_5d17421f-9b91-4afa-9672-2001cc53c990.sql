
-- Telefones de usuários (manual ou sincronizado do SAP)
CREATE TABLE IF NOT EXISTS public.user_phones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  user_code text NOT NULL,
  phone text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, user_code)
);

ALTER TABLE public.user_phones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read user_phones"
  ON public.user_phones FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated upsert user_phones"
  ON public.user_phones FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated update user_phones"
  ON public.user_phones FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Admins manage user_phones"
  ON public.user_phones FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_user_phones_updated_at
  BEFORE UPDATE ON public.user_phones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Dedup de alertas de aprovações via WhatsApp (re-lembrar a cada 24h)
CREATE TABLE IF NOT EXISTS public.whatsapp_approval_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  approval_request_id bigint NOT NULL,
  approver_code text NOT NULL,
  whatsapp_to text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_approval_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read whatsapp_approval_alerts"
  ON public.whatsapp_approval_alerts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage whatsapp_approval_alerts"
  ON public.whatsapp_approval_alerts FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_wpp_appr_alerts_lookup
  ON public.whatsapp_approval_alerts (company_db, approval_request_id, sent_at DESC);
