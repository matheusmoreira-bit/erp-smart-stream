-- Acelera o relatório de último acesso (get_flow_last_login), hoje ~4,4 s.
CREATE INDEX IF NOT EXISTS idx_audit_log_actor_email_created
  ON public.audit_log (lower(actor_email), created_at DESC);

CREATE OR REPLACE FUNCTION public.get_flow_last_login()
RETURNS TABLE(email text, last_login timestamp with time zone, last_activity timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH me AS (
    SELECT lower(coalesce(public.current_auth_email(), '')) AS email,
           public.has_role(auth.uid(), 'admin'::app_role) AS is_admin
  )
  SELECT lower(u.email) AS email,
         u.last_sign_in_at AS last_login,
         greatest(u.last_sign_in_at, a.last_act) AS last_activity
  FROM auth.users u
  CROSS JOIN me
  LEFT JOIN LATERAL (
    SELECT al.created_at AS last_act
    FROM public.audit_log al
    WHERE lower(al.actor_email) = lower(u.email)
    ORDER BY al.created_at DESC
    LIMIT 1
  ) a ON true
  WHERE u.email IS NOT NULL
    AND (me.is_admin OR lower(u.email) = me.email);
$function$;