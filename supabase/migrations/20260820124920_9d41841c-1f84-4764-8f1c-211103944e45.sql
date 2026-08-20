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
  -- Admin do backoffice entra em qualquer empresa
  SELECT public.has_role(auth.uid(), 'admin')
  OR EXISTS (
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
  -- Usuário sem nenhum vínculo de grupo: não bloqueia a lista de empresas
  OR EXISTS (
    SELECT 1 FROM n
    WHERE n.full_email <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.user_group_assignments u2
        WHERE lower(u2.sap_email) = n.full_email
           OR lower(u2.sap_email) = n.local_part
           OR lower(u2.sap_email) LIKE n.local_part || '@%'
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_email_allowed_for_omie_company(_email text, _company_db text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH n AS (
    SELECT
      lower(coalesce(_email, ''))                            AS full_email,
      lower(split_part(coalesce(_email, ''), '@', 1))        AS local_part,
      coalesce(_company_db, '')                              AS company_db
  )
  SELECT public.has_role(auth.uid(), 'admin')
  OR EXISTS (
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
  );
$function$;