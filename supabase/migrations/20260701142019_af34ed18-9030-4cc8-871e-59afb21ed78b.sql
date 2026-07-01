-- Retorna o primeiro admin da empresa (ou global) como aprovador padrão
CREATE OR REPLACE FUNCTION public.get_default_expense_approver(_company_db text DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    -- 1) admin com escopo para a empresa (via user_group_assignments)
    (
      SELECT split_part(u.email, '@', 1)
      FROM public.user_roles ur
      JOIN auth.users u ON u.id = ur.user_id
      LEFT JOIN public.user_group_assignments uga
             ON lower(uga.sap_email) = lower(u.email)
            AND (uga.company_db = _company_db OR uga.company_db IS NULL)
      WHERE ur.role = 'admin'
        AND (_company_db IS NULL OR uga.sap_email IS NOT NULL)
      ORDER BY u.created_at ASC
      LIMIT 1
    ),
    -- 2) qualquer admin
    (
      SELECT split_part(u.email, '@', 1)
      FROM public.user_roles ur
      JOIN auth.users u ON u.id = ur.user_id
      WHERE ur.role = 'admin'
      ORDER BY u.created_at ASC
      LIMIT 1
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_default_expense_approver(text) TO authenticated, service_role;

-- Backfill de despesas pendentes sem aprovador
UPDATE public.expenses
   SET current_approver = public.get_default_expense_approver(company_db)
 WHERE status = 'pendente_aprovacao'
   AND (current_approver IS NULL OR current_approver = '');