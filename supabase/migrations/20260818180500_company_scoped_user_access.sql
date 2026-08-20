-- Permite controlar acesso de usuários por empresa usando user_group_assignments.
-- company_db NULL permanece como acesso global/legado.

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.user_group_assignments'::regclass
       AND contype = 'u'
  LOOP
    EXECUTE 'ALTER TABLE public.user_group_assignments DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
END$$;

DROP INDEX IF EXISTS public.uq_user_group_company;
DROP INDEX IF EXISTS public.user_group_assignments_email_company_unique;

WITH ranked AS (
  SELECT
      id,
      ROW_NUMBER() OVER (
      PARTITION BY public.canonical_user_key(sap_email), COALESCE(company_db, '')
      ORDER BY created_at, id
    ) AS rn
  FROM public.user_group_assignments
)
DELETE FROM public.user_group_assignments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

CREATE UNIQUE INDEX IF NOT EXISTS user_group_assignments_email_company_unique
  ON public.user_group_assignments (public.canonical_user_key(sap_email), COALESCE(company_db, ''));

CREATE OR REPLACE FUNCTION public.is_email_allowed_for_company(
  _email text,
  _company_db text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH n AS (
    SELECT
      lower(coalesce(_email, '')) AS full_email,
      lower(split_part(coalesce(_email, ''), '@', 1)) AS local_part,
      public.canonical_user_key(_email) AS user_key,
      coalesce(_company_db, '') AS company_db
  )
  SELECT EXISTS (
    SELECT 1
    FROM public.user_group_assignments uga, n
    WHERE (uga.company_db = n.company_db OR uga.company_db IS NULL)
      AND (
        public.canonical_user_key(uga.sap_email) = n.user_key
        OR public.canonical_user_key(uga.sap_email) = public.canonical_user_key(n.local_part)
        OR
        lower(uga.sap_email) = n.full_email
        OR lower(uga.sap_email) = n.local_part
        OR lower(uga.sap_email) LIKE n.local_part || '@%'
      )
      AND n.full_email <> ''
      AND n.company_db <> ''
  );
$$;

REVOKE ALL ON FUNCTION public.is_email_allowed_for_company(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_email_allowed_for_company(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_email_allowed_for_omie_company(
  _email text,
  _company_db text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_email_allowed_for_company(_email, _company_db);
$$;

REVOKE ALL ON FUNCTION public.is_email_allowed_for_omie_company(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_email_allowed_for_omie_company(text, text) TO authenticated, service_role;
