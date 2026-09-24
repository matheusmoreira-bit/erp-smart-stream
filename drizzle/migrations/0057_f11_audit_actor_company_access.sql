-- F11: autor da auditoria vem da sessão; só o servidor (service_role) informa autor explicitamente.
CREATE OR REPLACE FUNCTION public.insert_audit_log(p_action text, p_entity_type text, p_entity_id text DEFAULT NULL::text, p_actor_email text DEFAULT NULL::text, p_company_db text DEFAULT NULL::text, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    IF p_actor_email IS NOT NULL AND lower(p_actor_email) <> lower(coalesce(v_email, '')) THEN
      v_details := v_details || jsonb_build_object('claimed_actor_ignored', p_actor_email);
    END IF;
  ELSIF coalesce(auth.role(), current_setting('request.jwt.claim.role', true)) = 'service_role'
        OR current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    v_email := p_actor_email;
  ELSE
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.audit_log (actor_id, actor_email, action, entity_type, entity_id, company_db, details)
  VALUES (v_uid, v_email, p_action, p_entity_type, p_entity_id, p_company_db, v_details);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.insert_audit_log(text, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.insert_audit_log(text, text, text, text, text, jsonb) TO authenticated, service_role;

-- F11: vínculo usuário (e-mail) x empresa, para uso só no servidor.
CREATE OR REPLACE FUNCTION public.user_can_access_company(_email text, _company_db text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH n AS (
    SELECT lower(trim(coalesce(_email, ''))) AS e,
           lower(split_part(trim(coalesce(_email, '')), '@', 1)) AS l,
           coalesce(_company_db, '') AS c
  )
  SELECT (SELECT e FROM n) <> '' AND (SELECT c FROM n) <> '' AND EXISTS (SELECT 1 FROM public.companies co, n WHERE co.company_db = n.c)
  AND (
    EXISTS (SELECT 1 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'admin', n WHERE lower(u.email) = n.e)
    OR EXISTS (SELECT 1 FROM public.companies co, n WHERE co.company_db = n.c AND lower(coalesce(co.erp_type, '')) = 'omie')
    OR EXISTS (SELECT 1 FROM public.user_group_assignments uga, n
               WHERE uga.company_db = n.c AND (lower(uga.sap_email) = n.e OR lower(uga.sap_email) = n.l))
    OR EXISTS (SELECT 1 FROM public.sap_user_emails s JOIN public.user_licenses ul ON lower(ul.user_code) = lower(s.user_key), n
               WHERE lower(s.email) = n.e AND ul.company_db = n.c)
    OR EXISTS (SELECT 1 FROM public.user_licenses ul, n WHERE ul.company_db = n.c AND lower(ul.user_code) = n.l)
  );
$function$;
REVOKE EXECUTE ON FUNCTION public.user_can_access_company(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_company(text, text) TO service_role;