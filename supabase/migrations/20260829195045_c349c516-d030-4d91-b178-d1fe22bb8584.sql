-- 1) user_profiles: remover leitura anônima (PII)
DROP POLICY IF EXISTS "Authenticated read user_profiles" ON public.user_profiles;
CREATE POLICY "Authenticated read user_profiles"
  ON public.user_profiles FOR SELECT
  TO authenticated
  USING (true);
REVOKE SELECT ON public.user_profiles FROM anon;
GRANT SELECT ON public.user_profiles TO authenticated;

-- 2) acesso a empresas: exigir sessão e vincular ao próprio e-mail
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
  SELECT
    -- exige sessão autenticada
    auth.uid() IS NOT NULL
    AND (
      -- admin do backoffice entra em qualquer empresa e pode consultar qualquer e-mail
      public.has_role(auth.uid(), 'admin')
      OR (
        -- demais usuários só podem consultar o próprio acesso
        EXISTS (SELECT 1 FROM n WHERE n.full_email = public.current_auth_email() AND n.full_email <> '')
        AND (
          EXISTS (
            SELECT 1
            FROM public.user_group_assignments uga, n
            WHERE (uga.company_db = n.company_db OR uga.company_db IS NULL)
              AND (
                lower(uga.sap_email) = n.full_email
                OR lower(uga.sap_email) = n.local_part
                OR lower(uga.sap_email) LIKE n.local_part || '@%'
              )
              AND n.company_db <> ''
          )
          -- usuário ainda sem vínculo de grupo continua enxergando as empresas
          OR EXISTS (
            SELECT 1 FROM n
            WHERE NOT EXISTS (
              SELECT 1 FROM public.user_group_assignments u2
              WHERE lower(u2.sap_email) = n.full_email
                 OR lower(u2.sap_email) = n.local_part
                 OR lower(u2.sap_email) LIKE n.local_part || '@%'
            )
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
      lower(coalesce(_email, ''))                     AS full_email,
      lower(split_part(coalesce(_email, ''), '@', 1)) AS local_part,
      coalesce(_company_db, '')                       AS company_db
  )
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (
        EXISTS (SELECT 1 FROM n WHERE n.full_email = public.current_auth_email() AND n.full_email <> '')
        AND EXISTS (
          SELECT 1
          FROM public.user_group_assignments uga, n
          WHERE (uga.company_db = n.company_db OR uga.company_db IS NULL)
            AND (
              lower(uga.sap_email) = n.full_email
              OR lower(uga.sap_email) = n.local_part
              OR lower(uga.sap_email) LIKE n.local_part || '@%'
            )
            AND n.company_db <> ''
        )
      )
    );
$function$;