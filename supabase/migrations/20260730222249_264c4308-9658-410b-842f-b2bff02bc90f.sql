
CREATE TABLE IF NOT EXISTS public.notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text,
  event_key text NOT NULL,
  label text NOT NULL,
  description text,
  enabled boolean NOT NULL DEFAULT true,
  channels text[] NOT NULL DEFAULT ARRAY['in_app']::text[],
  frequency text NOT NULL DEFAULT 'immediate',
  frequency_minutes integer,
  window_start_hour integer,
  window_end_hour integer,
  weekdays_only boolean NOT NULL DEFAULT true,
  subject_template text,
  body_template text,
  html_template text,
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS notification_settings_scope_key
  ON public.notification_settings (COALESCE(company_db, '*'), event_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_settings TO authenticated;
GRANT ALL ON public.notification_settings TO service_role;

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_settings_select ON public.notification_settings;
CREATE POLICY notification_settings_select ON public.notification_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS notification_settings_insert ON public.notification_settings;
CREATE POLICY notification_settings_insert ON public.notification_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS notification_settings_update ON public.notification_settings;
CREATE POLICY notification_settings_update ON public.notification_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS notification_settings_delete ON public.notification_settings;
CREATE POLICY notification_settings_delete ON public.notification_settings
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_notification_settings_updated_at ON public.notification_settings;
CREATE TRIGGER trg_notification_settings_updated_at
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.get_notification_deliveries(
  p_from timestamptz DEFAULT (now() - interval '7 days'),
  p_to timestamptz DEFAULT now(),
  p_company_db text DEFAULT NULL,
  p_limit integer DEFAULT 500
)
RETURNS TABLE (
  id text,
  occurred_at timestamptz,
  channel text,
  source text,
  event text,
  recipient text,
  subject text,
  status text,
  error_message text,
  company_db text,
  metadata jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_admin boolean := public.has_role(auth.uid(), 'admin');
  v_email text := lower(coalesce(public.current_auth_email(), ''));
  v_key text := public.canonical_user_key(v_email);
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 2000);
BEGIN
  RETURN QUERY
  WITH unified AS (
    SELECT n.id::text, n.created_at, 'in_app'::text AS channel, 'notifications'::text AS source,
           coalesce(n.category, 'system') AS event, n.user_identifier AS recipient,
           n.title AS subject, CASE WHEN n.is_read THEN 'read' ELSE 'unread' END AS status,
           NULL::text AS error_message, n.company_db, coalesce(n.metadata, '{}'::jsonb) AS metadata
    FROM public.notifications n
    UNION ALL
    SELECT e.id::text, e.created_at, 'email', 'email_send_log',
           coalesce(e.template_name, 'email'), e.recipient_email,
           coalesce(e.template_name, 'E-mail'), e.status, e.error_message,
           NULL::text, coalesce(e.metadata, '{}'::jsonb)
    FROM public.email_send_log e
    UNION ALL
    SELECT f.id::text, f.created_at, 'email', 'nfse_email_log', 'nfse_enviada',
           array_to_string(f.to_emails, ', '), f.subject, f.status, f.error_message,
           f.company_db,
           jsonb_build_object('expense_id', f.expense_id, 'nfse_number', f.nfse_number,
                              'project_code', f.project_code, 'sent_by', f.sent_by)
    FROM public.nfse_email_log f
    UNION ALL
    SELECT p.id::text, p.sent_at, 'email', 'po_notification_sent', coalesce(p.milestone, 'pedido_compra'),
           p.recipient_email, p.email_subject, p.status, p.error_message, p.company_db,
           jsonb_build_object('po_doc_num', p.po_doc_num, 'po_doc_entry', p.po_doc_entry)
    FROM public.po_notification_sent p
    UNION ALL
    SELECT o.id::text, o.sent_at, 'whatsapp', 'overdue_reminder_log', 'lembrete_vencido',
           coalesce(o.recipient_name, o.recipient_phone), 'Lembrete de documento vencido',
           o.status, o.response, o.company_db,
           jsonb_build_object('expense_id', o.expense_id, 'recipient_role', o.recipient_role)
    FROM public.overdue_reminder_log o
    UNION ALL
    SELECT w.id::text, w.sent_at, 'whatsapp', 'whatsapp_approval_alerts', 'aprovacao_pendente',
           coalesce(w.whatsapp_to, w.approver_code), 'Alerta de aprovação (WhatsApp)',
           'sent', NULL::text, w.company_db, coalesce(w.payload, '{}'::jsonb)
    FROM public.whatsapp_approval_alerts w
    UNION ALL
    SELECT l.id::text, l.sent_at, 'whatsapp', 'whatsapp_login_alerts', 'falha_login',
           coalesce(l.whatsapp_to, l.user_code), 'Alerta de falha de login (WhatsApp)',
           'sent', NULL::text, l.company_db, coalesce(l.payload, '{}'::jsonb)
    FROM public.whatsapp_login_alerts l
    UNION ALL
    SELECT r.id::text, r.created_at, 'email', 'registration_sla_reminder_log', coalesce(r.kind, 'sla_cadastro'),
           array_to_string(r.recipients, ', '), 'Lembrete de SLA de cadastro', r.status, r.detail,
           NULL::text, jsonb_build_object('request_id', r.request_id)
    FROM public.registration_sla_reminder_log r
    UNION ALL
    SELECT s.id::text, s.sent_at, 'batch', 'notification_send_runs', coalesce(s.function_name, 'rotina'),
           coalesce(s.recipients_count, 0)::text || ' destinatário(s)',
           coalesce(s.function_name, 'Rotina de envio'), s.status, s.error_message,
           NULL::text, coalesce(s.details, '{}'::jsonb)
    FROM public.notification_send_runs s
  )
  SELECT u.id, u.created_at, u.channel, u.source, u.event, u.recipient, u.subject,
         u.status, u.error_message, u.company_db, u.metadata
  FROM unified u
  WHERE u.created_at >= p_from
    AND u.created_at <= p_to
    AND (p_company_db IS NULL OR u.company_db IS NULL OR u.company_db = p_company_db)
    AND (
      v_admin
      OR (
        v_email <> ''
        AND (
          lower(coalesce(u.recipient, '')) LIKE '%' || v_email || '%'
          OR public.canonical_user_key(coalesce(u.recipient, '')) = v_key
        )
      )
    )
  ORDER BY u.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_notification_deliveries(timestamptz, timestamptz, text, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.get_notification_deliveries(timestamptz, timestamptz, text, integer) TO authenticated, service_role;
