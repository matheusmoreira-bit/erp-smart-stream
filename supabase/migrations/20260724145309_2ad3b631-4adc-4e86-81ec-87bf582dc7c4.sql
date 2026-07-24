-- S4.3: server-side allowlist para login Google em empresas OMIE.
-- Antes: verificação era feita apenas no cliente lendo user_group_assignments direto.
-- Agora: função SECURITY DEFINER, callable por authenticated e service_role,
-- que responde apenas o boolean para o par (email, company_db) — sem expor a tabela.

CREATE OR REPLACE FUNCTION public.is_email_allowed_for_omie_company(
  _email      text,
  _company_db text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH n AS (
    SELECT
      lower(coalesce(_email, ''))                            AS full_email,
      lower(split_part(coalesce(_email, ''), '@', 1))        AS local_part,
      coalesce(_company_db, '')                              AS company_db
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
  );
$$;

REVOKE ALL ON FUNCTION public.is_email_allowed_for_omie_company(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_email_allowed_for_omie_company(text, text) TO authenticated, service_role;