CREATE TABLE public.sla_escalation_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  sla_business_hours integer NOT NULL DEFAULT 48,
  repeat_business_hours integer NOT NULL DEFAULT 24,
  prefer_substitute boolean NOT NULL DEFAULT true,
  escalate_to_next_level boolean NOT NULL DEFAULT true,
  fallback_email text,
  max_escalations integer NOT NULL DEFAULT 2,
  notify_in_app boolean NOT NULL DEFAULT true,
  notify_email boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sla_escalation_settings TO authenticated;
GRANT ALL ON public.sla_escalation_settings TO service_role;

ALTER TABLE public.sla_escalation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_settings_select_auth" ON public.sla_escalation_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sla_settings_insert_admin" ON public.sla_escalation_settings
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "sla_settings_update_admin" ON public.sla_escalation_settings
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "sla_settings_delete_admin" ON public.sla_escalation_settings
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_sla_escalation_settings_updated_at
BEFORE UPDATE ON public.sla_escalation_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.sla_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL,
  company_db text,
  doc_num text,
  doc_type text,
  supplier_name text,
  total_amount numeric,
  currency text,
  from_approver text,
  to_approver text,
  target_kind text NOT NULL,
  level_from integer,
  level_to integer,
  substitution_id uuid,
  pending_since timestamptz,
  sla_deadline timestamptz,
  escalation_index integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sla_escalations_expense ON public.sla_escalations (expense_id, created_at DESC);
CREATE INDEX idx_sla_escalations_company ON public.sla_escalations (company_db, created_at DESC);

GRANT SELECT ON public.sla_escalations TO authenticated;
GRANT ALL ON public.sla_escalations TO service_role;

ALTER TABLE public.sla_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sla_escalations_select_auth" ON public.sla_escalations
  FOR SELECT TO authenticated USING (true);

INSERT INTO public.sla_escalation_settings (company_db, enabled) VALUES (NULL, false);