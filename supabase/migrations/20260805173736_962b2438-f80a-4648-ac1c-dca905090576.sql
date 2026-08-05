CREATE TABLE public.cost_center_redirects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text NOT NULL,
  from_cost_center text NOT NULL,
  to_cost_center text NOT NULL,
  to_project text,
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_db, from_cost_center)
);

GRANT SELECT ON public.cost_center_redirects TO authenticated;
GRANT ALL ON public.cost_center_redirects TO service_role;

ALTER TABLE public.cost_center_redirects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read cc redirects"
  ON public.cost_center_redirects FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage cc redirects"
  ON public.cost_center_redirects FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_cost_center_redirects_updated_at
  BEFORE UPDATE ON public.cost_center_redirects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();