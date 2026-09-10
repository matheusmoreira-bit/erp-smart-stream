CREATE TABLE IF NOT EXISTS public.notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'whatsapp', 'sms', 'webhook', 'slack')),
  subject_template text,
  body_template text NOT NULL DEFAULT '',
  html_template text,
  variables_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  event_key text NOT NULL,
  source_module text,
  description text,
  company_db text,
  active boolean NOT NULL DEFAULT true,
  debounce_seconds integer NOT NULL DEFAULT 0 CHECK (debounce_seconds >= 0),
  conditions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_id uuid NOT NULL REFERENCES public.notification_triggers(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.notification_templates(id) ON DELETE RESTRICT,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app', 'email', 'whatsapp', 'sms', 'webhook', 'slack')),
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  recipient_strategy text NOT NULL DEFAULT 'configured',
  conditions_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  fallback_rule_id uuid REFERENCES public.notification_rules(id) ON DELETE SET NULL,
  created_by text,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_rule_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES public.notification_rules(id) ON DELETE CASCADE,
  recipient_type text NOT NULL CHECK (recipient_type IN ('fixed_user', 'fixed_email', 'role', 'department', 'requester', 'approver', 'supplier', 'custom_phone', 'expression')),
  value text,
  filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  source_module text,
  source_entity_type text,
  source_entity_id text,
  company_db text,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.notification_events(id) ON DELETE SET NULL,
  event_key text NOT NULL,
  source_module text,
  source_entity_type text,
  source_entity_id text,
  company_db text,
  rule_id uuid REFERENCES public.notification_rules(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.notification_templates(id) ON DELETE SET NULL,
  template_version integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'sent', 'failed', 'skipped', 'canceled')),
  channel text NOT NULL CHECK (channel IN ('in_app', 'email', 'whatsapp', 'sms', 'webhook', 'slack')),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  error_message text,
  idempotency_key text,
  payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_subject text,
  rendered_body text,
  rendered_html text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_dispatch_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.notification_dispatches(id) ON DELETE CASCADE,
  recipient_name text,
  recipient_email text,
  recipient_phone text,
  recipient_user_id uuid,
  channel_address text,
  recipient_type text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'sent', 'failed', 'skipped', 'canceled')),
  provider_message_id text,
  sent_at timestamptz,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notification_rule_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_active ON public.notification_templates(active, channel);
CREATE INDEX IF NOT EXISTS idx_notification_triggers_event ON public.notification_triggers(event_key, active, company_db);
CREATE INDEX IF NOT EXISTS idx_notification_rules_trigger ON public.notification_rules(trigger_id, active, priority);
CREATE INDEX IF NOT EXISTS idx_notification_rule_recipients_rule ON public.notification_rule_recipients(rule_id, active);
CREATE INDEX IF NOT EXISTS idx_notification_events_lookup ON public.notification_events(event_key, source_entity_type, source_entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_dispatches_created ON public.notification_dispatches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_dispatches_status ON public.notification_dispatches(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_notification_dispatches_source ON public.notification_dispatches(source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_recipients_dispatch ON public.notification_dispatch_recipients(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_notification_dispatch_recipients_address ON public.notification_dispatch_recipients(lower(coalesce(channel_address, recipient_email, recipient_phone, '')));

CREATE UNIQUE INDEX IF NOT EXISTS notification_events_idempotency_uniq
  ON public.notification_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS notification_templates_name_channel_uniq
  ON public.notification_templates (lower(name), channel);

CREATE UNIQUE INDEX IF NOT EXISTS notification_triggers_scope_event_uniq
  ON public.notification_triggers (COALESCE(company_db, '*'), event_key);

CREATE UNIQUE INDEX IF NOT EXISTS notification_rules_trigger_name_uniq
  ON public.notification_rules (trigger_id, lower(name));

CREATE UNIQUE INDEX IF NOT EXISTS notification_dispatches_idempotency_uniq
  ON public.notification_dispatches(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON public.notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at
  BEFORE UPDATE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notification_triggers_updated_at ON public.notification_triggers;
CREATE TRIGGER trg_notification_triggers_updated_at
  BEFORE UPDATE ON public.notification_triggers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notification_rules_updated_at ON public.notification_rules;
CREATE TRIGGER trg_notification_rules_updated_at
  BEFORE UPDATE ON public.notification_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notification_rule_recipients_updated_at ON public.notification_rule_recipients;
CREATE TRIGGER trg_notification_rule_recipients_updated_at
  BEFORE UPDATE ON public.notification_rule_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notification_dispatches_updated_at ON public.notification_dispatches;
CREATE TRIGGER trg_notification_dispatches_updated_at
  BEFORE UPDATE ON public.notification_dispatches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_notification_dispatch_recipients_updated_at ON public.notification_dispatch_recipients;
CREATE TRIGGER trg_notification_dispatch_recipients_updated_at
  BEFORE UPDATE ON public.notification_dispatch_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.notification_config_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.notification_rule_audit_log (
    actor_email,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data
  )
  VALUES (
    lower(coalesce(public.current_auth_email(), 'sistema')),
    TG_OP,
    TG_TABLE_NAME,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notification_templates_audit ON public.notification_templates;
CREATE TRIGGER trg_notification_templates_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_templates
  FOR EACH ROW EXECUTE FUNCTION public.notification_config_audit();

DROP TRIGGER IF EXISTS trg_notification_triggers_audit ON public.notification_triggers;
CREATE TRIGGER trg_notification_triggers_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_triggers
  FOR EACH ROW EXECUTE FUNCTION public.notification_config_audit();

DROP TRIGGER IF EXISTS trg_notification_rules_audit ON public.notification_rules;
CREATE TRIGGER trg_notification_rules_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_rules
  FOR EACH ROW EXECUTE FUNCTION public.notification_config_audit();

DROP TRIGGER IF EXISTS trg_notification_rule_recipients_audit ON public.notification_rule_recipients;
CREATE TRIGGER trg_notification_rule_recipients_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.notification_rule_recipients
  FOR EACH ROW EXECUTE FUNCTION public.notification_config_audit();

CREATE OR REPLACE FUNCTION public.notification_conditions_match(p_conditions jsonb, p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k text;
  v jsonb;
  payload_value jsonb;
BEGIN
  IF p_conditions IS NULL OR p_conditions = '{}'::jsonb THEN
    RETURN true;
  END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(p_conditions)
  LOOP
    payload_value := p_payload -> k;
    IF jsonb_typeof(v) = 'array' THEN
      IF payload_value IS NULL OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(v) allowed
        WHERE allowed = trim(both '"' FROM payload_value::text)
      ) THEN
        RETURN false;
      END IF;
    ELSIF jsonb_typeof(v) = 'object' THEN
      IF v ? 'eq' AND coalesce(payload_value, 'null'::jsonb) <> v -> 'eq' THEN
        RETURN false;
      END IF;
      IF v ? 'gte' AND (payload_value IS NULL OR (trim(both '"' FROM payload_value::text))::numeric < (v ->> 'gte')::numeric) THEN
        RETURN false;
      END IF;
      IF v ? 'lte' AND (payload_value IS NULL OR (trim(both '"' FROM payload_value::text))::numeric > (v ->> 'lte')::numeric) THEN
        RETURN false;
      END IF;
    ELSE
      IF coalesce(payload_value, 'null'::jsonb) <> v THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN others THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.render_notification_template(p_template text, p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result text := coalesce(p_template, '');
  k text;
  v jsonb;
  rendered text;
BEGIN
  FOR k, v IN SELECT key, value FROM jsonb_each(coalesce(p_payload, '{}'::jsonb))
  LOOP
    rendered := CASE
      WHEN jsonb_typeof(v) IN ('object', 'array') THEN v::text
      ELSE trim(both '"' FROM v::text)
    END;
    result := replace(result, '{{' || k || '}}', coalesce(rendered, ''));
    result := replace(result, '{{ ' || k || ' }}', coalesce(rendered, ''));
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_notification_recipient(
  p_recipient_type text,
  p_value text,
  p_payload jsonb
)
RETURNS TABLE (
  recipient_name text,
  recipient_email text,
  recipient_phone text,
  channel_address text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  expression_key text;
BEGIN
  IF p_recipient_type = 'fixed_email' THEN
    RETURN QUERY SELECT p_value, p_value, NULL::text, p_value;
  ELSIF p_recipient_type = 'fixed_user' THEN
    RETURN QUERY SELECT p_value, NULL::text, NULL::text, p_value;
  ELSIF p_recipient_type = 'custom_phone' THEN
    RETURN QUERY SELECT p_value, NULL::text, p_value, p_value;
  ELSIF p_recipient_type = 'requester' THEN
    RETURN QUERY SELECT
      coalesce(p_payload ->> 'requester_name', p_payload ->> 'solicitante', p_payload ->> 'requester_email'),
      p_payload ->> 'requester_email',
      p_payload ->> 'requester_phone',
      coalesce(p_payload ->> 'requester_email', p_payload ->> 'requester_user', p_payload ->> 'solicitante');
  ELSIF p_recipient_type = 'approver' THEN
    RETURN QUERY SELECT
      coalesce(p_payload ->> 'approver_name', p_payload ->> 'aprovador', p_payload ->> 'approver_email'),
      p_payload ->> 'approver_email',
      p_payload ->> 'approver_phone',
      coalesce(p_payload ->> 'approver_email', p_payload ->> 'approver_user', p_payload ->> 'aprovador');
  ELSIF p_recipient_type = 'supplier' THEN
    RETURN QUERY SELECT
      coalesce(p_payload ->> 'supplier_name', p_payload ->> 'fornecedor', p_payload ->> 'supplier_email'),
      p_payload ->> 'supplier_email',
      p_payload ->> 'supplier_phone',
      coalesce(p_payload ->> 'supplier_email', p_payload ->> 'supplier_phone');
  ELSIF p_recipient_type = 'expression' THEN
    expression_key := nullif(trim(coalesce(p_value, '')), '');
    IF expression_key IS NOT NULL THEN
      RETURN QUERY SELECT
        coalesce(p_payload ->> (expression_key || '_name'), p_payload ->> expression_key),
        p_payload ->> (expression_key || '_email'),
        p_payload ->> (expression_key || '_phone'),
        coalesce(p_payload ->> (expression_key || '_email'), p_payload ->> (expression_key || '_phone'), p_payload ->> expression_key);
    END IF;
  ELSE
    RETURN QUERY SELECT p_value, NULL::text, NULL::text, p_value;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_notification_event(
  p_event_key text,
  p_source_module text DEFAULT NULL,
  p_source_entity_type text DEFAULT NULL,
  p_source_entity_id text DEFAULT NULL,
  p_company_db text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS TABLE (
  event_id uuid,
  dispatches_created integer,
  recipients_created integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id uuid;
  v_dispatches integer := 0;
  v_recipients integer := 0;
  r record;
  rec record;
  v_dispatch_id uuid;
  v_subject text;
  v_body text;
  v_html text;
  v_scheduled_at timestamptz;
  v_dispatch_status text;
  v_recipient_count integer;
  v_dedupe text;
BEGIN
  INSERT INTO public.notification_events (
    event_key,
    source_module,
    source_entity_type,
    source_entity_id,
    company_db,
    payload_json,
    idempotency_key
  )
  VALUES (
    p_event_key,
    p_source_module,
    p_source_entity_type,
    p_source_entity_id,
    p_company_db,
    coalesce(p_payload, '{}'::jsonb),
    p_idempotency_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
  DO UPDATE SET payload_json = EXCLUDED.payload_json
  RETURNING id INTO v_event_id;

  FOR r IN
    SELECT
      nr.id AS rule_id,
      nr.channel,
      nr.conditions_json AS rule_conditions,
      nt.id AS template_id,
      nt.version AS template_version,
      nt.subject_template,
      nt.body_template,
      nt.html_template,
      trg.debounce_seconds,
      trg.conditions_json AS trigger_conditions
    FROM public.notification_triggers trg
    JOIN public.notification_rules nr ON nr.trigger_id = trg.id
    JOIN public.notification_templates nt ON nt.id = nr.template_id
    WHERE trg.event_key = p_event_key
      AND trg.active = true
      AND nr.active = true
      AND nt.active = true
      AND (trg.company_db IS NULL OR trg.company_db = p_company_db)
    ORDER BY nr.priority ASC, nr.created_at ASC
  LOOP
    IF NOT public.notification_conditions_match(r.trigger_conditions, coalesce(p_payload, '{}'::jsonb))
       OR NOT public.notification_conditions_match(r.rule_conditions, coalesce(p_payload, '{}'::jsonb)) THEN
      CONTINUE;
    END IF;

    v_subject := public.render_notification_template(r.subject_template, coalesce(p_payload, '{}'::jsonb));
    v_body := public.render_notification_template(r.body_template, coalesce(p_payload, '{}'::jsonb));
    v_html := public.render_notification_template(r.html_template, coalesce(p_payload, '{}'::jsonb));
    v_scheduled_at := now() + make_interval(secs => coalesce(r.debounce_seconds, 0));
    v_dispatch_status := CASE WHEN r.channel = 'in_app' AND coalesce(r.debounce_seconds, 0) = 0 THEN 'sent' ELSE 'pending' END;
    v_dedupe := coalesce(
      p_idempotency_key || ':' || r.rule_id::text,
      p_event_key || ':' || coalesce(p_source_entity_type, '-') || ':' || coalesce(p_source_entity_id, '-') || ':' || r.rule_id::text
    );

    INSERT INTO public.notification_dispatches (
      event_id,
      event_key,
      source_module,
      source_entity_type,
      source_entity_id,
      company_db,
      rule_id,
      template_id,
      template_version,
      status,
      channel,
      scheduled_at,
      sent_at,
      idempotency_key,
      payload_snapshot,
      rendered_subject,
      rendered_body,
      rendered_html,
      metadata
    )
    VALUES (
      v_event_id,
      p_event_key,
      p_source_module,
      p_source_entity_type,
      p_source_entity_id,
      p_company_db,
      r.rule_id,
      r.template_id,
      r.template_version,
      v_dispatch_status,
      r.channel,
      v_scheduled_at,
      CASE WHEN v_dispatch_status = 'sent' THEN now() ELSE NULL END,
      v_dedupe,
      coalesce(p_payload, '{}'::jsonb),
      nullif(v_subject, ''),
      v_body,
      nullif(v_html, ''),
      jsonb_build_object('engine', 'notification_engine')
    )
    ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
    DO UPDATE SET updated_at = now()
    RETURNING id INTO v_dispatch_id;

    v_dispatches := v_dispatches + 1;

    FOR rec IN
      SELECT rr.recipient_type, rr.value, rr.filters_json
      FROM public.notification_rule_recipients rr
      WHERE rr.rule_id = r.rule_id
        AND rr.active = true
    LOOP
      INSERT INTO public.notification_dispatch_recipients (
        dispatch_id,
        recipient_name,
        recipient_email,
        recipient_phone,
        channel_address,
        recipient_type,
        status,
        sent_at,
        metadata
      )
      SELECT
        v_dispatch_id,
        resolved.recipient_name,
        resolved.recipient_email,
        resolved.recipient_phone,
        resolved.channel_address,
        rec.recipient_type,
        CASE WHEN r.channel = 'in_app' AND coalesce(r.debounce_seconds, 0) = 0 THEN 'sent' ELSE 'pending' END,
        CASE WHEN r.channel = 'in_app' AND coalesce(r.debounce_seconds, 0) = 0 THEN now() ELSE NULL END,
        jsonb_build_object('filters', rec.filters_json)
      FROM public.resolve_notification_recipient(rec.recipient_type, rec.value, coalesce(p_payload, '{}'::jsonb)) resolved
      WHERE nullif(trim(coalesce(resolved.channel_address, resolved.recipient_email, resolved.recipient_phone, resolved.recipient_name, '')), '') IS NOT NULL;

      GET DIAGNOSTICS v_recipient_count = ROW_COUNT;
      v_recipients := v_recipients + coalesce(v_recipient_count, 0);

      IF r.channel = 'in_app' AND coalesce(r.debounce_seconds, 0) = 0 THEN
        INSERT INTO public.notifications (user_identifier, company_db, title, body, category, link, metadata)
        SELECT
          coalesce(resolved.channel_address, resolved.recipient_email, resolved.recipient_name),
          p_company_db,
          coalesce(nullif(v_subject, ''), p_event_key),
          nullif(v_body, ''),
          coalesce(p_payload ->> 'category', split_part(p_event_key, '.', 1), 'system'),
          p_payload ->> 'link',
          jsonb_build_object(
            'notification_event_id', v_event_id,
            'notification_dispatch_id', v_dispatch_id,
            'event_key', p_event_key,
            'source_entity_type', p_source_entity_type,
            'source_entity_id', p_source_entity_id
          )
        FROM public.resolve_notification_recipient(rec.recipient_type, rec.value, coalesce(p_payload, '{}'::jsonb)) resolved
        WHERE nullif(trim(coalesce(resolved.channel_address, resolved.recipient_email, resolved.recipient_name, '')), '') IS NOT NULL;
      END IF;
    END LOOP;
  END LOOP;

  RETURN QUERY SELECT v_event_id, v_dispatches, v_recipients;
END;
$$;

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
REVOKE ALL ON FUNCTION public.enqueue_notification_event(text, text, text, text, text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_event(text, text, text, text, text, jsonb, text) TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_triggers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_rule_recipients TO authenticated;
GRANT SELECT ON public.notification_events TO authenticated;
GRANT SELECT, UPDATE ON public.notification_dispatches TO authenticated;
GRANT SELECT, UPDATE ON public.notification_dispatch_recipients TO authenticated;
GRANT SELECT ON public.notification_rule_audit_log TO authenticated;

GRANT ALL ON public.notification_templates TO service_role;
GRANT ALL ON public.notification_triggers TO service_role;
GRANT ALL ON public.notification_rules TO service_role;
GRANT ALL ON public.notification_rule_recipients TO service_role;
GRANT ALL ON public.notification_events TO service_role;
GRANT ALL ON public.notification_dispatches TO service_role;
GRANT ALL ON public.notification_dispatch_recipients TO service_role;
GRANT ALL ON public.notification_rule_audit_log TO service_role;

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_rule_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_dispatch_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_rule_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_templates_select ON public.notification_templates;
CREATE POLICY notification_templates_select ON public.notification_templates
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS notification_templates_admin ON public.notification_templates;
CREATE POLICY notification_templates_admin ON public.notification_templates
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS notification_triggers_select ON public.notification_triggers;
CREATE POLICY notification_triggers_select ON public.notification_triggers
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS notification_triggers_admin ON public.notification_triggers;
CREATE POLICY notification_triggers_admin ON public.notification_triggers
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS notification_rules_select ON public.notification_rules;
CREATE POLICY notification_rules_select ON public.notification_rules
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS notification_rules_admin ON public.notification_rules;
CREATE POLICY notification_rules_admin ON public.notification_rules
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS notification_rule_recipients_select ON public.notification_rule_recipients;
CREATE POLICY notification_rule_recipients_select ON public.notification_rule_recipients
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS notification_rule_recipients_admin ON public.notification_rule_recipients;
CREATE POLICY notification_rule_recipients_admin ON public.notification_rule_recipients
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS notification_events_select ON public.notification_events;
CREATE POLICY notification_events_select ON public.notification_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS notification_dispatches_select ON public.notification_dispatches;
CREATE POLICY notification_dispatches_select ON public.notification_dispatches
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1
      FROM public.notification_dispatch_recipients r
      WHERE r.dispatch_id = notification_dispatches.id
        AND lower(coalesce(r.channel_address, r.recipient_email, r.recipient_phone, r.recipient_name, '')) LIKE '%' || lower(coalesce(public.current_auth_email(), '')) || '%'
    )
  );

DROP POLICY IF EXISTS notification_dispatches_admin_update ON public.notification_dispatches;
CREATE POLICY notification_dispatches_admin_update ON public.notification_dispatches
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS notification_dispatch_recipients_select ON public.notification_dispatch_recipients;
CREATE POLICY notification_dispatch_recipients_select ON public.notification_dispatch_recipients
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin')
    OR lower(coalesce(channel_address, recipient_email, recipient_phone, recipient_name, '')) LIKE '%' || lower(coalesce(public.current_auth_email(), '')) || '%'
  );

DROP POLICY IF EXISTS notification_dispatch_recipients_admin_update ON public.notification_dispatch_recipients;
CREATE POLICY notification_dispatch_recipients_admin_update ON public.notification_dispatch_recipients
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS notification_rule_audit_log_select ON public.notification_rule_audit_log;
CREATE POLICY notification_rule_audit_log_select ON public.notification_rule_audit_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.notification_templates (name, description, channel, subject_template, body_template, variables_schema, created_by)
VALUES
  (
    'Aprovação pendente',
    'Mensagem padrão para documentos que entram em aprovação.',
    'in_app',
    'Aprovação pendente: {{document_number}}',
    '{{supplier_name}} - {{currency}} {{amount}} está aguardando {{approver_name}}.',
    '{"document_number":"Número do documento","supplier_name":"Fornecedor","currency":"Moeda","amount":"Valor","approver_name":"Aprovador"}'::jsonb,
    'migration'
  ),
  (
    'Falha de integração',
    'Mensagem padrão para falhas de integração com ERP ou serviços externos.',
    'in_app',
    'Falha de integração em {{source_module}}',
    '{{message}}',
    '{"source_module":"Módulo origem","message":"Mensagem de erro","link":"Link de destino"}'::jsonb,
    'migration'
  )
ON CONFLICT DO NOTHING;

WITH approval_template AS (
  SELECT id FROM public.notification_templates WHERE name = 'Aprovação pendente' ORDER BY created_at LIMIT 1
),
trigger_row AS (
  INSERT INTO public.notification_triggers (name, event_key, source_module, description, created_by)
  VALUES ('Documento pendente de aprovação', 'document.pending_approval', 'approvals', 'Disparado quando um documento entra em aprovação.', 'migration')
  ON CONFLICT DO NOTHING
  RETURNING id
),
existing_trigger AS (
  SELECT id FROM trigger_row
  UNION ALL
  SELECT id FROM public.notification_triggers WHERE event_key = 'document.pending_approval' ORDER BY created_at LIMIT 1
),
rule_row AS (
  INSERT INTO public.notification_rules (trigger_id, template_id, name, channel, priority, created_by)
  SELECT existing_trigger.id, approval_template.id, 'Notificar aprovador atual', 'in_app', 10, 'migration'
  FROM existing_trigger, approval_template
  ON CONFLICT DO NOTHING
  RETURNING id
)
INSERT INTO public.notification_rule_recipients (rule_id, recipient_type, value)
SELECT rule_row.id, 'approver', NULL
FROM rule_row
ON CONFLICT DO NOTHING;
