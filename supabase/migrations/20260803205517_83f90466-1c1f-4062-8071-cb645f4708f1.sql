CREATE OR REPLACE FUNCTION public.get_default_expense_approver(_company_db text DEFAULT NULL)
RETURNS text
LANGUAGE sql
IMMUTABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'juliana.gavineli@anagaming.com.br'::text;
$$;

GRANT EXECUTE ON FUNCTION public.get_default_expense_approver(text) TO authenticated, service_role;