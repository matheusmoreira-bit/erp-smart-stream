CREATE OR REPLACE FUNCTION public.is_sap_user_admin(_sap_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    WHERE ur.role = 'admin'
      AND (
        lower(u.email) = lower(_sap_username)
        OR lower(split_part(u.email, '@', 1)) = lower(_sap_username)
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_sap_user_admin(text) TO anon, authenticated;