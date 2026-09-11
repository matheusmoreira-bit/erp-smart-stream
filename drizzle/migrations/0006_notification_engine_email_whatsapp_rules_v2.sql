ALTER TABLE public.notification_rule_recipients
  DROP CONSTRAINT IF EXISTS notification_rule_recipients_recipient_type_check;
ALTER TABLE public.notification_rule_recipients
  ADD CONSTRAINT notification_rule_recipients_recipient_type_check
  CHECK (recipient_type = ANY (ARRAY['fixed_user','fixed_email','role','department','requester','approver','supplier','custom_phone','expression','payload_list']));

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
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  expression_key text;
  raw_value text;
BEGIN
  IF p_recipient_type = 'fixed_email' THEN
    RETURN QUERY SELECT p_value, p_value, NULL::text, p_value;
  ELSIF p_recipient_type = 'fixed_user' THEN
    RETURN QUERY SELECT p_value, NULL::text, NULL::text, p_value;
  ELSIF p_recipient_type = 'custom_phone' THEN
    RETURN QUERY SELECT p_value, NULL::text, p_value, p_value;
  ELSIF p_recipient_type = 'payload_list' THEN
    expression_key := coalesce(nullif(trim(coalesce(p_value, '')), ''), 'recipients');
    IF jsonb_typeof(p_payload -> expression_key) = 'array' THEN
      RETURN QUERY
        SELECT
          elem.v,
          CASE WHEN elem.v LIKE '%@%' THEN elem.v ELSE NULL END,
          CASE WHEN elem.v LIKE '%@%' THEN NULL ELSE elem.v END,
          elem.v
        FROM (
          SELECT trim(both '"' FROM value::text) AS v
          FROM jsonb_array_elements(p_payload -> expression_key)
        ) elem
        WHERE coalesce(elem.v, '') <> '';
    END IF;
  ELSIF p_recipient_type = 'requester' THEN
    RETURN QUERY SELECT
      coalesce(p_payload ->> 'requester_name', p_payload ->> 'solicitante', p_payload ->> 'requester_email'),
      p_payload ->> 'requester_email',
      p_payload ->> 'requester_phone',
      coalesce(p_payload ->> 'requester_email', p_payload ->> 'requester_user', p_payload ->> 'solicitante');
  ELSIF p_recipient_type = 'approver' THEN
    RETURN QUERY SELECT
      coalesce(p_payload ->> 'approver_name', p_payload ->> 'aprovador', p_payload ->> 'approver_email'),
      coalesce(
        p_payload ->> 'approver_email',
        CASE WHEN coalesce(p_payload ->> 'approver', '') LIKE '%@%' THEN p_payload ->> 'approver' END
      ),
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
      raw_value := p_payload ->> expression_key;
      RETURN QUERY SELECT
        coalesce(p_payload ->> (expression_key || '_name'), raw_value),
        coalesce(
          p_payload ->> (expression_key || '_email'),
          CASE WHEN coalesce(raw_value, '') LIKE '%@%' THEN raw_value END
        ),
        p_payload ->> (expression_key || '_phone'),
        coalesce(p_payload ->> (expression_key || '_email'), p_payload ->> (expression_key || '_phone'), raw_value);
    END IF;
  ELSE
    RETURN QUERY SELECT p_value, NULL::text, NULL::text, p_value;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_notification_recipient(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_notification_recipient(text, text, jsonb) TO authenticated, service_role;

INSERT INTO public.notification_triggers (name, event_key, source_module, description, active, debounce_seconds)
SELECT v.name, v.event_key, 'approvals', v.descr, true, 0
FROM (VALUES
  ('Ação de aprovação solicitada', 'action.approval.requested', 'Documento aguardando ação de aprovação'),
  ('Ação de aprovação concluída', 'action.approval.completed', 'Aprovação concluída, rejeitada ou devolvida')
) AS v(name, event_key, descr)
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_triggers t WHERE t.event_key = v.event_key AND t.company_db IS NULL
);

INSERT INTO public.notification_templates (name, description, channel, subject_template, body_template, html_template, active, version)
SELECT v.name, v.descr, v.channel, v.subj, v.body, v.html, true, 1
FROM (VALUES
  (
    'E-mail padrão ERP Flow', 'Modelo genérico de e-mail do motor de notificações', 'email',
    '[ERP Flow] {{title}}',
    E'{{summary}}\n\nEmpresa: {{company_name}}\nFornecedor/Cliente: {{supplier_name}}\nValor: {{amount_label}}\nSolicitante: {{requester_name}}',
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111"><h2 style="font-size:16px;margin:0 0 12px">{{title}}</h2><p style="margin:0 0 12px">{{summary}}</p><p style="margin:0 0 4px"><b>Empresa:</b> {{company_name}}</p><p style="margin:0 0 4px"><b>Fornecedor/Cliente:</b> {{supplier_name}}</p><p style="margin:0 0 4px"><b>Valor:</b> {{amount_label}}</p><p style="margin:0 0 12px"><b>Solicitante:</b> {{requester_name}}</p></div>'
  ),
  (
    'WhatsApp padrão ERP Flow', 'Modelo genérico de WhatsApp do motor de notificações', 'whatsapp',
    'ERP Flow — {{title}}',
    E'{{summary}}\n\nEmpresa: {{company_name}}\nValor: {{amount_label}}',
    NULL
  ),
  (
    'E-mail — baixa de cartão pendente', 'Baixa PagCorp aguardando lançamento', 'email',
    '[ERP Flow] {{title}}',
    E'Pedido de compra: {{po_doc_num}}\nNF de entrada: {{invoice_doc_num}}\nFornecedor: {{vendor_name}}\nValor: {{amount}} {{currency}}',
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111"><h2 style="font-size:16px;margin:0 0 12px">{{title}}</h2><p style="margin:0 0 4px"><b>Pedido de compra:</b> {{po_doc_num}}</p><p style="margin:0 0 4px"><b>NF de entrada:</b> {{invoice_doc_num}}</p><p style="margin:0 0 4px"><b>Fornecedor:</b> {{vendor_name}}</p><p style="margin:0 0 4px"><b>Valor:</b> {{amount}} {{currency}}</p></div>'
  )
) AS v(name, descr, channel, subj, body, html)
WHERE NOT EXISTS (SELECT 1 FROM public.notification_templates t WHERE t.name = v.name);

DO $seed$
DECLARE
  t_email uuid;
  t_wpp uuid;
  t_card uuid;
  trg uuid;
  rule uuid;
  spec record;
BEGIN
  SELECT id INTO t_email FROM public.notification_templates WHERE name = 'E-mail padrão ERP Flow' LIMIT 1;
  SELECT id INTO t_wpp FROM public.notification_templates WHERE name = 'WhatsApp padrão ERP Flow' LIMIT 1;
  SELECT id INTO t_card FROM public.notification_templates WHERE name = 'E-mail — baixa de cartão pendente' LIMIT 1;

  FOR spec IN
    SELECT * FROM (VALUES
      ('document.pending_approval', 'whatsapp', 'WhatsApp — documento pendente de aprovação', 'approver', NULL::text),
      ('sales_order.pending_approval', 'whatsapp', 'WhatsApp — venda pendente de aprovação', 'approver', NULL),
      ('action.approval.requested', 'whatsapp', 'WhatsApp — ação de aprovação solicitada', 'expression', 'recipient'),
      ('action.approval.completed', 'whatsapp', 'WhatsApp — aprovação concluída/devolvida', 'expression', 'recipient'),
      ('sales.nfse_settled', 'whatsapp', 'WhatsApp — baixa de recebimento registrada', 'payload_list', 'recipients'),
      ('cards.settlement_pending', 'email', 'E-mail — baixa de cartão pendente', 'fixed_email', 'blenda.pinheiro@anagaming.com.br')
    ) AS v(event_key, channel, rule_name, recipient_type, recipient_value)
  LOOP
    SELECT id INTO trg FROM public.notification_triggers
      WHERE event_key = spec.event_key AND company_db IS NULL LIMIT 1;
    CONTINUE WHEN trg IS NULL;

    SELECT id INTO rule FROM public.notification_rules WHERE name = spec.rule_name LIMIT 1;
    IF rule IS NULL THEN
      INSERT INTO public.notification_rules (trigger_id, template_id, name, channel, priority, active, recipient_strategy, conditions_json, created_by)
      VALUES (
        trg,
        CASE WHEN spec.event_key = 'cards.settlement_pending' THEN t_card
             WHEN spec.channel = 'email' THEN t_email ELSE t_wpp END,
        spec.rule_name, spec.channel, 100, true, spec.recipient_type, '{}'::jsonb, 'system'
      )
      RETURNING id INTO rule;
    ELSE
      UPDATE public.notification_rules SET active = true, channel = spec.channel, updated_at = now() WHERE id = rule;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.notification_rule_recipients rr
      WHERE rr.rule_id = rule AND rr.recipient_type = spec.recipient_type
        AND coalesce(rr.value, '') = coalesce(spec.recipient_value, '')
    ) THEN
      INSERT INTO public.notification_rule_recipients (rule_id, recipient_type, value, filters_json, active)
      VALUES (rule, spec.recipient_type, spec.recipient_value, '{}'::jsonb, true);
    END IF;
  END LOOP;

  SELECT id INTO trg FROM public.notification_triggers WHERE event_key = 'cards.settlement_pending' AND company_db IS NULL LIMIT 1;
  IF trg IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.notification_rules WHERE name = 'WhatsApp — baixa de cartão pendente') THEN
    INSERT INTO public.notification_rules (trigger_id, template_id, name, channel, priority, active, recipient_strategy, conditions_json, created_by)
    VALUES (trg, t_wpp, 'WhatsApp — baixa de cartão pendente', 'whatsapp', 110, true, 'custom_phone', '{}'::jsonb, 'system')
    RETURNING id INTO rule;
    INSERT INTO public.notification_rule_recipients (rule_id, recipient_type, value, filters_json, active)
    VALUES (rule, 'custom_phone', '5531996749771', '{}'::jsonb, true);
  END IF;
END;
$seed$;

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_pending
  ON public.notification_dispatches (status, scheduled_at)
  WHERE status = 'pending';