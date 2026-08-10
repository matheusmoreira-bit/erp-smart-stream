CREATE OR REPLACE FUNCTION public.get_flow_last_login()
RETURNS TABLE(email text, last_login timestamptz, last_activity timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT lower(coalesce(public.current_auth_email(), '')) AS email,
           public.has_role(auth.uid(), 'admin'::app_role) AS is_admin
  )
  SELECT lower(u.email) AS email,
         u.last_sign_in_at AS last_login,
         greatest(u.last_sign_in_at, a.last_act) AS last_activity
  FROM auth.users u
  LEFT JOIN LATERAL (
    SELECT max(al.created_at) AS last_act
    FROM public.audit_log al
    WHERE lower(al.actor_email) = lower(u.email)
  ) a ON true, me
  WHERE u.email IS NOT NULL
    AND (me.is_admin OR lower(u.email) = me.email);
$$;

GRANT EXECUTE ON FUNCTION public.get_flow_last_login() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_flow_last_login() FROM anon;