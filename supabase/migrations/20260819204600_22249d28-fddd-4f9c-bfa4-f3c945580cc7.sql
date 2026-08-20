CREATE OR REPLACE FUNCTION public.is_email_allowed_for_company(_email text, _company_db text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH n AS (
    SELECT
      lower(coalesce(_email, ''))                     AS full_email,
      lower(split_part(coalesce(_email, ''), '@', 1)) AS local_part,
      coalesce(_company_db, '')                       AS company_db
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.user_group_assignments uga, n
    WHERE (uga.company_db = n.company_db OR uga.company_db IS NULL)
      AND (
        lower(uga.sap_email) = n.full_email
        OR lower(uga.sap_email) = n.local_part
        OR lower(uga.sap_email) LIKE n.local_part || '@%'
      )
      AND n.full_email <> ''
      AND n.company_db <> ''
  )
  OR EXISTS (
    -- Sem nenhum vínculo de grupo cadastrado para a empresa, não bloqueia a lista.
    SELECT 1 FROM n
    WHERE NOT EXISTS (
      SELECT 1 FROM public.user_group_assignments u2
      WHERE u2.company_db = n.company_db
    )
  );
$function$;

REVOKE ALL ON FUNCTION public.is_email_allowed_for_company(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_email_allowed_for_company(text, text) TO authenticated, service_role;