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
  v_key text := public.canonical_user_key(lower(coalesce(public.current_auth_email(), '')));
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
    SELECT dr.id::text, coalesce(dr.sent_at, d.sent_at, d.scheduled_at, d.created_at), d.channel, 'notification_dispatches',
           d.event_key, coalesce(dr.channel_address, dr.recipient_email, dr.recipient_phone, dr.recipient_name),
           d.rendered_subject, coalesce(dr.status, d.status), coalesce(dr.error_message, d.error_message),
           d.company_db,
           jsonb_build_object(
             'dispatch_id', d.id,
             'recipient_id', dr.id,
             'source_module', d.source_module,
             'source_entity_type', d.source_entity_type,
             'source_entity_id', d.source_entity_id,
             'template_id', d.template_id,
             'template_version', d.template_version,
             'rendered_body', d.rendered_body,
             'rendered_html', d.rendered_html,
             'payload_snapshot', d.payload_snapshot,
             'metadata', d.metadata
           )
    FROM public.notification_dispatches d
    LEFT JOIN public.notification_dispatch_recipients dr ON dr.dispatch_id = d.id
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