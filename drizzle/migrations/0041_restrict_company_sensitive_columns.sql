-- Fecha a leitura dos campos sensíveis da tabela companies (endereço do
-- Service Layer do SAP, CNPJ, razão social) para usuários comuns.
-- O acesso completo passa a ser feito por função com validação de papel.

REVOKE SELECT ON public.companies FROM authenticated;
REVOKE SELECT ON public.companies FROM anon;

GRANT SELECT (
  id, company_db, display_name, is_active, created_at, updated_at,
  targets, erp_type, default_currency, timezone, logo_url,
  trade_name, is_foreign, is_test
) ON public.companies TO authenticated;

COMMENT ON COLUMN public.companies.service_layer_url IS 'Sensível: leitura apenas por admin via admin_list_companies().';
COMMENT ON COLUMN public.companies.tax_id IS 'Sensível: leitura apenas por admin via admin_list_companies() ou company_tax_id().';

-- Lista completa de empresas para telas administrativas.
CREATE OR REPLACE FUNCTION public.admin_list_companies()
RETURNS SETOF public.companies
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN QUERY SELECT * FROM public.companies ORDER BY display_name;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_companies() TO authenticated, service_role;

-- CNPJ de UMA empresa ativa, para conferência de NF de entrada pelo app.
CREATE OR REPLACE FUNCTION public.company_tax_id(_company_db text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tax text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT c.tax_id INTO v_tax
  FROM public.companies c
  WHERE c.company_db = _company_db AND c.is_active
  LIMIT 1;
  RETURN v_tax;
END;
$$;

REVOKE ALL ON FUNCTION public.company_tax_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.company_tax_id(text) TO authenticated, service_role;