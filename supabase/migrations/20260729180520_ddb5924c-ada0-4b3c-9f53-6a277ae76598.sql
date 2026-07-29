CREATE TABLE public.cc_project_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  user_email text,
  sap_user_name text,
  company_db text,
  line_index integer,
  cost_center_code text NOT NULL,
  cost_center_name text,
  project_code_at_alert text,
  project_name_at_alert text,
  is_institutional_project boolean NOT NULL DEFAULT false,
  decision text NOT NULL DEFAULT 'pending',
  final_project_code text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.cc_project_alerts TO authenticated;
GRANT ALL ON public.cc_project_alerts TO service_role;

ALTER TABLE public.cc_project_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own or admin select" ON public.cc_project_alerts
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "insert own" ON public.cc_project_alerts
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "update own" ON public.cc_project_alerts
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_cc_project_alerts_created_at ON public.cc_project_alerts (created_at DESC);
CREATE INDEX idx_cc_project_alerts_company ON public.cc_project_alerts (company_db);

CREATE TRIGGER update_cc_project_alerts_updated_at
BEFORE UPDATE ON public.cc_project_alerts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();