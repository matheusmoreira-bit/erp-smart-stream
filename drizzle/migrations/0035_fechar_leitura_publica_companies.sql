-- 1) Remove leitura anônima da tabela companies (expunha service_layer_url, tax_id, legal_name)
DROP POLICY IF EXISTS "Public can read active companies" ON public.companies;
REVOKE SELECT ON public.companies FROM anon;

-- 2) Função pública mínima para a tela de login (sem dados sensíveis)
CREATE OR REPLACE FUNCTION public.list_login_companies()
RETURNS TABLE (company_db text, display_name text, erp_type text, is_test boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.company_db, c.display_name, coalesce(c.erp_type, 'sap'), coalesce(c.is_test, false)
  FROM public.companies c
  WHERE c.is_active = true
  ORDER BY c.display_name
$$;

REVOKE ALL ON FUNCTION public.list_login_companies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_login_companies() TO anon, authenticated, service_role;