CREATE TABLE public.notification_channel_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text,
  event_key text NOT NULL DEFAULT 'approval_pending',
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  slack_enabled boolean NOT NULL DEFAULT true,
  whatsapp_enabled boolean NOT NULL DEFAULT true,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX notification_channel_settings_global_uniq
  ON public.notification_channel_settings (event_key) WHERE company_db IS NULL;
CREATE UNIQUE INDEX notification_channel_settings_company_uniq
  ON public.notification_channel_settings (company_db, event_key) WHERE company_db IS NOT NULL;

GRANT SELECT ON public.notification_channel_settings TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.notification_channel_settings TO authenticated;
GRANT ALL ON public.notification_channel_settings TO service_role;

ALTER TABLE public.notification_channel_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_channel_settings_select ON public.notification_channel_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY notification_channel_settings_insert ON public.notification_channel_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY notification_channel_settings_update ON public.notification_channel_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY notification_channel_settings_delete ON public.notification_channel_settings
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_notification_channel_settings_updated_at
  BEFORE UPDATE ON public.notification_channel_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.notification_channel_settings (company_db, event_key)
VALUES (NULL, 'approval_pending'), (NULL, 'overdue_reminder'), (NULL, 'sla_escalation');