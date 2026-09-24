CREATE TABLE IF NOT EXISTS public.user_company_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  company_db text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  UNIQUE (email, company_db)
);
GRANT SELECT ON public.user_company_access TO authenticated;
GRANT ALL ON public.user_company_access TO service_role;
ALTER TABLE public.user_company_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY uca_select_own_or_admin ON public.user_company_access FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt()->>'email','')) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY uca_insert_admin ON public.user_company_access FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY uca_update_admin ON public.user_company_access FOR UPDATE TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY uca_delete_admin ON public.user_company_access FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
GRANT INSERT, UPDATE, DELETE ON public.user_company_access TO authenticated;

CREATE OR REPLACE FUNCTION public.user_can_access_company(_email text, _company_db text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH n AS (
    SELECT lower(trim(coalesce(_email, ''))) AS e,
           lower(split_part(trim(coalesce(_email, '')), '@', 1)) AS l,
           coalesce(_company_db, '') AS c
  ), adm AS (
    SELECT EXISTS (SELECT 1 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'admin', n WHERE lower(u.email) = n.e) AS a
  )
  SELECT (SELECT e FROM n) <> '' AND (SELECT c FROM n) <> '' AND EXISTS (SELECT 1 FROM public.companies co, n WHERE co.company_db = n.c)
  AND (
    (SELECT a FROM adm)
    OR (
      -- Lotus Blanca: somente ANA Gaming
      ((SELECT e FROM n) NOT LIKE '%@lotusblanca.net' OR (SELECT c FROM n) = 'SBO_ANAGAMING')
      AND (
        EXISTS (SELECT 1 FROM public.companies co, n WHERE co.company_db = n.c AND lower(coalesce(co.erp_type, '')) = 'omie')
        OR EXISTS (SELECT 1 FROM public.user_company_access a, n WHERE lower(a.email) = n.e AND a.company_db = n.c)
        OR EXISTS (SELECT 1 FROM public.user_group_assignments uga, n
                   WHERE uga.company_db = n.c AND (lower(uga.sap_email) = n.e OR lower(uga.sap_email) = n.l))
        OR EXISTS (SELECT 1 FROM public.sap_user_emails s JOIN public.user_licenses ul ON lower(ul.user_code) = lower(s.user_key), n
                   WHERE lower(s.email) = n.e AND ul.company_db = n.c)
        OR EXISTS (SELECT 1 FROM public.user_licenses ul, n WHERE ul.company_db = n.c AND lower(ul.user_code) = n.l)
      )
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.user_can_access_company(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_company(text, text) TO service_role;