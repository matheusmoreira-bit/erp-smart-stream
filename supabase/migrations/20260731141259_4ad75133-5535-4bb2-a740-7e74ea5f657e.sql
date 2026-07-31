CREATE OR REPLACE FUNCTION public.is_registration_agent()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := public.current_auth_email();
  v_key text := public.canonical_user_key(public.current_auth_email());
BEGIN
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN true;
  END IF;
  IF coalesce(v_email, '') = '' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.user_group_assignments a
    JOIN public.permission_groups g ON g.id = a.group_id
    WHERE lower(btrim(g.name)) IN ('facilities', 'admin')
      AND (
        lower(a.sap_email) = v_email
        OR lower(a.sap_email) = split_part(v_email, '@', 1)
        OR public.canonical_user_key(a.sap_email) = v_key
      )
  );
END;
$$;