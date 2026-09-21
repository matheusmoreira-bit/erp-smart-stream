-- Relatório read-only de contas duplicadas entre domínios de e-mail
-- (mesmo nome antes do @ em domínios diferentes). Só administradores.
CREATE OR REPLACE FUNCTION public.list_duplicate_identities()
RETURNS TABLE(
  local_part text,
  email text,
  user_id uuid,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  has_sap_credentials boolean,
  group_count integer,
  is_admin boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH u AS (
    SELECT au.id,
           lower(au.email) AS email,
           split_part(lower(au.email), '@', 1) AS local_part,
           au.last_sign_in_at,
           au.created_at
    FROM auth.users au
    WHERE au.email IS NOT NULL
  ),
  dup AS (
    SELECT local_part FROM u GROUP BY local_part HAVING count(*) > 1
  )
  SELECT u.local_part,
         u.email,
         u.id,
         u.last_sign_in_at,
         u.created_at,
         EXISTS (SELECT 1 FROM public.user_sap_credentials c WHERE c.user_id = u.id) AS has_sap_credentials,
         (SELECT count(*)::int FROM public.user_group_assignments g WHERE lower(g.sap_email) = u.email) AS group_count,
         public.has_role(u.id, 'admin'::app_role) AS is_admin
  FROM u
  JOIN dup ON dup.local_part = u.local_part
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY u.local_part, u.last_sign_in_at DESC NULLS LAST;
$function$;

REVOKE ALL ON FUNCTION public.list_duplicate_identities() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_duplicate_identities() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_duplicate_identities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_duplicate_identities() TO service_role;