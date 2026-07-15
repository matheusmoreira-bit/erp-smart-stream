CREATE OR REPLACE FUNCTION public.sap_user_has_module(_sap_username text, _module_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH normalized AS (
    SELECT lower(trim(coalesce(_sap_username, ''))) AS identifier,
           lower(trim(coalesce(_module_key, ''))) AS module_key
  )
  SELECT CASE
    WHEN (SELECT identifier FROM normalized) = '' THEN false
    WHEN (SELECT module_key FROM normalized) = '' THEN false
    WHEN public.is_sap_user_admin((SELECT identifier FROM normalized)) THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.user_group_assignments uga
      JOIN public.permission_group_modules pgm ON pgm.group_id = uga.group_id
      CROSS JOIN normalized n
      WHERE pgm.module_key = n.module_key
        AND coalesce(pgm.can_view, true) = true
        AND (
          lower(uga.sap_email) = n.identifier
          OR lower(uga.sap_email) LIKE n.identifier || '@%'
        )
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.sap_user_has_module(text, text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "SAP users module can read idp_user_mapping" ON public.idp_user_mapping;
CREATE POLICY "SAP users module can read idp_user_mapping"
ON public.idp_user_mapping
FOR SELECT
TO anon
USING (public.sap_user_has_module(current_setting('request.headers', true)::json ->> 'x-sap-user', 'users'));

GRANT SELECT ON public.idp_user_mapping TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.idp_user_mapping TO authenticated;
GRANT ALL ON public.idp_user_mapping TO service_role;