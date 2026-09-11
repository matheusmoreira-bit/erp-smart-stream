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