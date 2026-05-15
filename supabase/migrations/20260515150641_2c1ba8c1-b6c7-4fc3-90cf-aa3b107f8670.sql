
CREATE TABLE public.synapse_global_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_key text UNIQUE NOT NULL,
  is_active_global boolean NOT NULL DEFAULT true,
  interval_minutes integer NOT NULL DEFAULT 15,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.synapse_global_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage synapse_global_settings"
ON public.synapse_global_settings FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read synapse_global_settings"
ON public.synapse_global_settings FOR SELECT TO authenticated
USING (true);

CREATE TRIGGER update_synapse_global_settings_updated_at
BEFORE UPDATE ON public.synapse_global_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.po_notification_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  po_doc_entry integer NOT NULL,
  po_doc_num integer,
  milestone text NOT NULL,
  recipient_email text,
  email_subject text,
  email_html text,
  status text NOT NULL DEFAULT 'sent',
  error_message text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT po_notif_milestone_check CHECK (milestone IN ('approved','grpo','ap_invoice','ap_paid')),
  CONSTRAINT po_notif_unique UNIQUE (company_db, po_doc_entry, milestone)
);

CREATE INDEX idx_po_notif_company_sent ON public.po_notification_sent (company_db, sent_at DESC);

ALTER TABLE public.po_notification_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage po_notification_sent"
ON public.po_notification_sent FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read po_notification_sent"
ON public.po_notification_sent FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Service role insert po_notification_sent"
ON public.po_notification_sent FOR INSERT TO anon
WITH CHECK (true);

INSERT INTO public.synapse_global_settings (integration_key, is_active_global, interval_minutes, parameters)
VALUES (
  'purchase_order_notifications',
  true,
  15,
  jsonb_build_object(
    'days_back', 30,
    'email_from_label', 'Notificações de Compras'
  )
)
ON CONFLICT (integration_key) DO NOTHING;
