CREATE TABLE public.approver_cost_centers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sap_email TEXT NOT NULL,
  company_db TEXT NOT NULL,
  cost_center TEXT NOT NULL,
  cost_center_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (sap_email, company_db, cost_center)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.approver_cost_centers TO authenticated;
GRANT ALL ON public.approver_cost_centers TO service_role;

ALTER TABLE public.approver_cost_centers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage approver_cost_centers"
  ON public.approver_cost_centers
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read approver_cost_centers"
  ON public.approver_cost_centers
  FOR SELECT
  TO authenticated
  USING (true);

CREATE INDEX idx_approver_cost_centers_lookup
  ON public.approver_cost_centers (lower(sap_email), company_db);

CREATE TRIGGER trg_approver_cost_centers_updated_at
  BEFORE UPDATE ON public.approver_cost_centers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();