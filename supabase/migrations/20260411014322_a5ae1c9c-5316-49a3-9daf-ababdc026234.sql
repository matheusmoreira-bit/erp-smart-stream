
CREATE TABLE public.enabled_erp_types (
  erp_type TEXT PRIMARY KEY,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.enabled_erp_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read enabled_erp_types"
  ON public.enabled_erp_types FOR SELECT
  USING (true);

CREATE POLICY "Admins can manage enabled_erp_types"
  ON public.enabled_erp_types FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Seed all known ERP types, only sap and omie active
INSERT INTO public.enabled_erp_types (erp_type, is_active) VALUES
  ('sap', true),
  ('omie', true),
  ('s4hana_cloud', false),
  ('s4hana_cloud_private', false),
  ('s4hana_onprem', false),
  ('totvs_protheus', false),
  ('totvs_rm', false),
  ('totvs_datasul', false),
  ('netsuite', false);

CREATE TRIGGER update_enabled_erp_types_updated_at
  BEFORE UPDATE ON public.enabled_erp_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
