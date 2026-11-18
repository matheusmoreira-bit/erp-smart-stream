CREATE OR REPLACE FUNCTION public.caller_owns_identifier(_identifier text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(auth.role(), '') = 'service_role'
    OR public.has_role(auth.uid(), 'admin')
    OR (public.current_auth_email() <> '' AND (
         lower(coalesce(_identifier, '')) = public.current_auth_email()
      OR lower(coalesce(_identifier, '')) = split_part(public.current_auth_email(), '@', 1)
      OR EXISTS (SELECT 1 FROM public.sap_user_emails s
                 WHERE lower(s.email) = public.current_auth_email()
                   AND (lower(s.user_key) = lower(_identifier)
                        OR lower(split_part(s.user_key, '@', 1)) = lower(_identifier)))));
$$;
REVOKE ALL ON FUNCTION public.caller_owns_identifier(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_owns_identifier(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_employee_integration(_user_id uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$BEGIN
 PERFORM public.assert_erp_rpc_access();
 IF coalesce(auth.role(), '') <> 'service_role' AND _user_id IS DISTINCT FROM auth.uid()
    AND NOT public.has_role(auth.uid(), 'admin') THEN
   RETURN false;
 END IF;
 RETURN (
  SELECT public.has_role(_user_id, 'admin')
      OR EXISTS (
        SELECT 1 FROM public.user_group_assignments uga
        JOIN auth.users u ON lower(u.email) = lower(uga.sap_email)
        JOIN public.permission_group_modules pgm ON pgm.group_id = uga.group_id
        WHERE u.id = _user_id
          AND pgm.module_key IN ('employee_integration.view','employee_integration.manage','employee_integration.execute','employee_integration.view_logs')
          AND COALESCE(pgm.can_view, true) = true));
END;$function$;

CREATE OR REPLACE FUNCTION public.company_tax_id(_company_db text)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_tax text;
BEGIN
 PERFORM public.assert_erp_rpc_access();
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  IF NOT public.user_can_access_company(public.current_auth_email(), _company_db) THEN RETURN NULL; END IF;
  SELECT c.tax_id INTO v_tax FROM public.companies c
  WHERE c.company_db = _company_db AND c.is_active LIMIT 1;
  RETURN v_tax;
END;
$function$;

CREATE OR REPLACE FUNCTION public.find_open_registration_duplicate(p_type text, p_tax_id text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_company_db text DEFAULT NULL::text)
  RETURNS TABLE(id uuid, title text, status text, requester_email text, requester_name text, due_at timestamp with time zone, created_at timestamp with time zone, already_linked boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$#variable_conflict use_column
DECLARE v_priv boolean;
BEGIN
 PERFORM public.assert_erp_rpc_access();
 v_priv := public.has_role(auth.uid(), 'admin') OR public.is_registration_agent();
 RETURN QUERY
  SELECT q.id, q.title, q.status,
         CASE WHEN v_priv OR q.linked THEN q.requester_email END,
         CASE WHEN v_priv OR q.linked THEN q.requester_name END,
         q.due_at, q.created_at, q.linked
  FROM (
    SELECT r.id, r.title, r.status::text AS status, r.requester_email, r.requester_name, r.due_at, r.created_at,
           (lower(r.requester_email) = current_auth_email() OR current_auth_email() = ANY (r.followers)) AS linked
    FROM public.registration_requests r
    WHERE r.request_type::text = p_type
      AND r.status::text NOT IN ('concluido', 'cancelado')
      AND (p_company_db IS NULL OR lower(coalesce(r.company_db, '')) = lower(p_company_db))
      AND (
        (nullif(regexp_replace(coalesce(p_tax_id, ''), '\D', '', 'g'), '') IS NOT NULL
         AND regexp_replace(coalesce(r.federal_tax_id, ''), '\D', '', 'g') = regexp_replace(p_tax_id, '\D', '', 'g'))
        OR (nullif(btrim(coalesce(p_title, '')), '') IS NOT NULL AND lower(btrim(r.title)) = lower(btrim(p_title))))
    ORDER BY r.created_at DESC
    LIMIT 1) q;
END;$function$;

CREATE OR REPLACE FUNCTION public.find_open_registration_duplicate(p_type text, p_tax_id text DEFAULT NULL::text, p_title text DEFAULT NULL::text)
  RETURNS TABLE(id uuid, title text, status text, requester_email text, requester_name text, due_at timestamp with time zone, created_at timestamp with time zone, already_linked boolean)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$#variable_conflict use_column
BEGIN
 RETURN QUERY SELECT * FROM public.find_open_registration_duplicate(p_type, p_tax_id, p_title, NULL::text);
END;$function$;

CREATE OR REPLACE FUNCTION public.active_officials_for_substitute(_substitute_identifier text)
 RETURNS TABLE(official_email text, official_name text, id uuid, ends_at timestamp with time zone, company_db text, cost_center_prefixes text[])
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$#variable_conflict use_column
BEGIN
 PERFORM public.assert_erp_rpc_access();
 IF NOT public.caller_owns_identifier(_substitute_identifier) THEN RETURN; END IF;
 RETURN QUERY
  SELECT s.official_email, s.official_name, s.id, s.ends_at, s.company_db, s.cost_center_prefixes
  FROM public.approver_substitutes s
  WHERE s.revoked_at IS NULL AND s.starts_at <= now() AND s.ends_at > now()
    AND (lower(s.substitute_email) = lower(_substitute_identifier)
      OR lower(split_part(s.substitute_email, '@', 1)) = lower(_substitute_identifier));
END;$function$;

CREATE OR REPLACE FUNCTION public.substitute_grants_for_me(_substitute_identifier text)
 RETURNS TABLE(id uuid, official_email text, official_name text, starts_at timestamp with time zone, ends_at timestamp with time zone, company_db text, cost_center_prefixes text[])
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$#variable_conflict use_column
BEGIN
 PERFORM public.assert_erp_rpc_access();
 IF NOT public.caller_owns_identifier(_substitute_identifier) THEN RETURN; END IF;
 RETURN QUERY
  SELECT s.id, s.official_email, s.official_name, s.starts_at, s.ends_at, s.company_db, s.cost_center_prefixes
  FROM public.approver_substitutes s
  WHERE s.revoked_at IS NULL
    AND (lower(s.substitute_email) = lower(_substitute_identifier)
      OR lower(split_part(s.substitute_email, '@', 1)) = lower(_substitute_identifier));
END;$function$;