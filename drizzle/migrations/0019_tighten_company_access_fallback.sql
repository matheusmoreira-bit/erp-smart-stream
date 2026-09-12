-- Remove o fallback que liberava TODAS as empresas para usuários sem vínculo.
-- O reconhecimento passa a ignorar pontos (daniele.gomes = danielegomes) e
-- aceita também o vínculo pelo diretório de e-mails do ERP.
CREATE OR REPLACE FUNCTION public.is_email_allowed_for_company(_email text, _company_db text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH n AS (
    SELECT
      lower(coalesce(_email, ''))                                        AS full_email,
      lower(split_part(coalesce(_email, ''), '@', 1))                    AS local_part,
      replace(lower(split_part(coalesce(_email, ''), '@', 1)), '.', '')  AS local_flat,
      coalesce(_company_db, '')                                          AS company_db
  )
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        EXISTS (SELECT 1 FROM n WHERE n.full_email = public.current_auth_email() AND n.full_email <> '')
        AND (
          EXISTS (
            SELECT 1
            FROM public.user_group_assignments uga, n
            WHERE (uga.company_db = n.company_db OR uga.company_db IS NULL)
              AND n.company_db <> ''
              AND (
                lower(uga.sap_email) = n.full_email
                OR lower(uga.sap_email) = n.local_part
                OR replace(lower(uga.sap_email), '.', '') = n.local_flat
                OR lower(uga.sap_email) LIKE n.local_part || '@%'
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.sap_user_emails e, n
            WHERE n.company_db <> ''
              AND lower(e.email) = n.full_email
          )
        )
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
      lower(coalesce(_email, ''))                                        AS full_email,
      lower(split_part(coalesce(_email, ''), '@', 1))                    AS local_part,
      replace(lower(split_part(coalesce(_email, ''), '@', 1)), '.', '')  AS local_flat,
      coalesce(_company_db, '')                                          AS company_db
  )
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        EXISTS (SELECT 1 FROM n WHERE n.full_email = public.current_auth_email() AND n.full_email <> '')
        AND (
          EXISTS (
            SELECT 1
            FROM public.user_group_assignments uga, n
            WHERE (uga.company_db = n.company_db OR uga.company_db IS NULL)
              AND n.company_db <> ''
              AND (
                lower(uga.sap_email) = n.full_email
                OR lower(uga.sap_email) = n.local_part
                OR replace(lower(uga.sap_email), '.', '') = n.local_flat
                OR lower(uga.sap_email) LIKE n.local_part || '@%'
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.sap_user_emails e, n
            WHERE n.company_db <> ''
              AND lower(e.email) = n.full_email
          )
        )
      )
    );
$function$;