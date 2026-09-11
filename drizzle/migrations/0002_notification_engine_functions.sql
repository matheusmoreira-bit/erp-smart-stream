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
    actor_email, action, entity_type, entity_id, before_data, after_data
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
SET search_path TO 'public'
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
SET search_path TO 'public'
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
SET search_path TO 'public'
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
    event_key, source_module, source_entity_type, source_entity_id, company_db, payload_json, idempotency_key
  )
  VALUES (
    p_event_key, p_source_module, p_source_entity_type, p_source_entity_id, p_company_db,
    coalesce(p_payload, '{}'::jsonb), p_idempotency_key
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
      event_id, event_key, source_module, source_entity_type, source_entity_id, company_db,
      rule_id, template_id, template_version, status, channel, scheduled_at, sent_at,
      idempotency_key, payload_snapshot, rendered_subject, rendered_body, rendered_html, metadata
    )
    VALUES (
      v_event_id, p_event_key, p_source_module, p_source_entity_type, p_source_entity_id, p_company_db,
      r.rule_id, r.template_id, r.template_version, v_dispatch_status, r.channel, v_scheduled_at,
      CASE WHEN v_dispatch_status = 'sent' THEN now() ELSE NULL END,
      v_dedupe, coalesce(p_payload, '{}'::jsonb), nullif(v_subject, ''), v_body, nullif(v_html, ''),
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
        dispatch_id, recipient_name, recipient_email, recipient_phone, channel_address,
        recipient_type, status, sent_at, metadata
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

REVOKE ALL ON FUNCTION public.enqueue_notification_event(text, text, text, text, text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.enqueue_notification_event(text, text, text, text, text, jsonb, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.notification_conditions_match(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.notification_conditions_match(jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.render_notification_template(text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.render_notification_template(text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.resolve_notification_recipient(text, text, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_notification_recipient(text, text, jsonb) TO authenticated, service_role;

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
  SELECT id FROM (
    SELECT id FROM public.notification_triggers WHERE event_key = 'document.pending_approval' ORDER BY created_at LIMIT 1
  ) existing
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