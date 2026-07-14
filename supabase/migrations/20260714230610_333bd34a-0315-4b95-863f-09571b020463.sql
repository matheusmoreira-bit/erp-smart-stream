
CREATE TABLE public.roi_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_db text UNIQUE,
  salario_aprovador numeric(14,2) NOT NULL DEFAULT 50000,
  salario_solicitante numeric(14,2) NOT NULL DEFAULT 6000,
  tempo_lancar_sap_min integer NOT NULL DEFAULT 15,
  tempo_aprovar_sap_min integer NOT NULL DEFAULT 10,
  tempo_lancar_flow_min integer NOT NULL DEFAULT 3,
  tempo_aprovar_flow_min integer NOT NULL DEFAULT 1,
  custo_licenca_aprovador_sap numeric(14,2) NOT NULL DEFAULT 1350,
  custo_licenca_solicitante_sap numeric(14,2) NOT NULL DEFAULT 947,
  custo_licenca_flow numeric(14,2) NOT NULL DEFAULT 0,
  multa_percent numeric(6,3) NOT NULL DEFAULT 2.0,
  juros_mes_percent numeric(6,3) NOT NULL DEFAULT 1.0,
  horas_mes integer NOT NULL DEFAULT 220,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX roi_parameters_global_uniq
  ON public.roi_parameters ((company_db IS NULL))
  WHERE company_db IS NULL;

GRANT SELECT ON public.roi_parameters TO authenticated;
GRANT ALL ON public.roi_parameters TO service_role;

ALTER TABLE public.roi_parameters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roi_parameters_select_authenticated"
  ON public.roi_parameters FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "roi_parameters_admin_insert"
  ON public.roi_parameters FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "roi_parameters_admin_update"
  ON public.roi_parameters FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "roi_parameters_admin_delete"
  ON public.roi_parameters FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER roi_parameters_set_updated_at
  BEFORE UPDATE ON public.roi_parameters
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.roi_parameters (company_db) VALUES (NULL);
