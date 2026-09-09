CREATE TABLE IF NOT EXISTS public.uber_user_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  source text NOT NULL DEFAULT 'uber',
  employee_key text NOT NULL,
  employee_name text NOT NULL,
  employee_email text,
  cost_center_code text NOT NULL,
  cost_center_label text,
  origin text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, source, employee_key)
);

GRANT SELECT ON public.uber_user_mappings TO authenticated;
GRANT ALL ON public.uber_user_mappings TO service_role;
ALTER TABLE public.uber_user_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read uber user mappings"
  ON public.uber_user_mappings FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.uber_cost_center_project_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  cost_center_code text NOT NULL,
  cost_center_label text,
  project_code text NOT NULL,
  project_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, cost_center_code)
);

GRANT SELECT ON public.uber_cost_center_project_defaults TO authenticated;
GRANT ALL ON public.uber_cost_center_project_defaults TO service_role;
ALTER TABLE public.uber_cost_center_project_defaults ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read uber project defaults"
  ON public.uber_cost_center_project_defaults FOR SELECT TO authenticated USING (true);

CREATE TRIGGER update_uber_user_mappings_updated_at
  BEFORE UPDATE ON public.uber_user_mappings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_uber_cc_project_defaults_updated_at
  BEFORE UPDATE ON public.uber_cost_center_project_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();