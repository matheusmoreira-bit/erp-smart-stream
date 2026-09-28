-- B01: autorização explícita também no Omie; aplicar antes das Edge Functions.
-- Não cria vínculos ou permissões automaticamente: revisar grupos em homologação.
CREATE OR REPLACE FUNCTION public.user_can_access_company(_email text, _company_db text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH n AS (
    SELECT lower(trim(coalesce(_email, ''))) AS e,
           lower(split_part(trim(coalesce(_email, '')), '@', 1)) AS l,
           coalesce(_company_db, '') AS c
  ), adm AS (
    SELECT EXISTS (SELECT 1 FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id AND r.role = 'admin', n WHERE lower(u.email) = n.e) AS a
  )
  SELECT (SELECT e FROM n) <> '' AND (SELECT c FROM n) <> '' AND EXISTS (SELECT 1 FROM public.companies co, n WHERE co.company_db = n.c)
  AND (
    (SELECT a FROM adm)
    OR (
      -- Lotus Blanca: somente ANA Gaming
      ((SELECT e FROM n) NOT LIKE '%@lotusblanca.net' OR (SELECT c FROM n) = 'SBO_ANAGAMING')
      AND (
        EXISTS (SELECT 1 FROM public.user_company_access a, n WHERE lower(a.email) = n.e AND a.company_db = n.c)
        OR EXISTS (SELECT 1 FROM public.user_group_assignments uga, n
                   WHERE uga.company_db = n.c AND (lower(uga.sap_email) = n.e OR lower(uga.sap_email) = n.l))
        OR EXISTS (SELECT 1 FROM public.sap_user_emails s JOIN public.user_licenses ul ON lower(ul.user_code) = lower(s.user_key), n
                   WHERE lower(s.email) = n.e AND ul.company_db = n.c)
        OR EXISTS (SELECT 1 FROM public.user_licenses ul, n WHERE ul.company_db = n.c AND lower(ul.user_code) = n.l)
      )
    )
  );
$function$;
REVOKE ALL ON FUNCTION public.user_can_access_company(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_company(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.has_module_action(
  _user_id uuid,
  _company_db text,
  _module text,
  _action text
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_user_key text;
  v_erp_ok boolean := false;
  v_sap_has_map boolean := false;
  v_sap_ok boolean := false;
BEGIN
  IF _user_id IS NULL OR _module IS NULL OR _action IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_role(_user_id, 'admin') THEN
    RETURN true;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = _user_id LIMIT 1;
  IF v_email IS NULL THEN
    RETURN false;
  END IF;
  IF _company_db IS NOT NULL AND NOT public.user_can_access_company(v_email, _company_db) THEN
    RETURN false;
  END IF;
  v_user_key := public.canonical_user_key(v_email);
  IF coalesce(v_user_key, '') = '' THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_group_assignments uga
    JOIN public.permission_group_modules pgm ON pgm.group_id = uga.group_id
    WHERE public.canonical_user_key(uga.sap_email) = v_user_key
      AND (uga.company_db IS NULL OR uga.company_db = _company_db)
      AND pgm.module_key = _module
      AND CASE _action
            WHEN 'view' THEN coalesce(pgm.can_view, true)
            WHEN 'create' THEN coalesce(pgm.can_create, false)
            WHEN 'edit' THEN coalesce(pgm.can_edit, false)
            WHEN 'delete' THEN coalesce(pgm.can_delete, false)
            WHEN 'approve' THEN coalesce(pgm.can_approve, false)
            WHEN 'integrate' THEN coalesce(pgm.can_integrate, false)
            WHEN 'export' THEN coalesce(pgm.can_export, false)
            ELSE false
          END
  ) INTO v_erp_ok;

  IF NOT v_erp_ok THEN
    RETURN false;
  END IF;

  IF _company_db IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.sap_group_mapping
      WHERE company_db = _company_db AND module_key = _module
    ) INTO v_sap_has_map;
  END IF;

  IF NOT v_sap_has_map THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.sap_cache sc
    JOIN public.sap_group_mapping m
      ON m.company_db = _company_db
     AND m.module_key = _module
    WHERE sc.company_db = _company_db
      AND (
        public.canonical_user_key(sc.data ->> 'eMail') = v_user_key
        OR public.canonical_user_key(sc.data ->> 'UserCode') = v_user_key
      )
      AND m.sap_group_code = ANY (
        SELECT jsonb_array_elements_text(coalesce(sc.data -> 'Groups', '[]'::jsonb))
      )
      AND CASE _action
            WHEN 'view' THEN m.can_view
            WHEN 'create' THEN m.can_create
            WHEN 'edit' THEN m.can_edit
            WHEN 'delete' THEN m.can_delete
            WHEN 'approve' THEN m.can_approve
            WHEN 'integrate' THEN m.can_integrate
            WHEN 'export' THEN m.can_export
            ELSE false
          END
  ) INTO v_sap_ok;

  RETURN v_sap_ok;
END;
$$;

REVOKE ALL ON FUNCTION public.has_module_action(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_module_action(uuid, text, text, text) TO authenticated, service_role;

-- Sessão SAP já comprovada pelo servidor: ação e empresa, não apenas view.
CREATE OR REPLACE FUNCTION public.sap_user_has_module_action(
  _sap_username text, _company_db text, _module_key text, _action text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(_company_db, '') <> '' AND coalesce(_sap_username, '') <> '' AND EXISTS (
    SELECT 1 FROM public.user_group_assignments uga
    JOIN public.permission_group_modules pgm ON pgm.group_id = uga.group_id
    WHERE public.canonical_user_key(uga.sap_email) = public.canonical_user_key(_sap_username)
      AND (uga.company_db IS NULL OR uga.company_db = _company_db)
      AND pgm.module_key = _module_key
      AND CASE _action
        WHEN 'view' THEN coalesce(pgm.can_view, false)
        WHEN 'create' THEN coalesce(pgm.can_create, false)
        WHEN 'edit' THEN coalesce(pgm.can_edit, false)
        WHEN 'delete' THEN coalesce(pgm.can_delete, false)
        WHEN 'approve' THEN coalesce(pgm.can_approve, false)
        WHEN 'integrate' THEN coalesce(pgm.can_integrate, false)
        WHEN 'export' THEN coalesce(pgm.can_export, false)
        ELSE false END
  ) AND (
    NOT EXISTS (SELECT 1 FROM public.sap_group_mapping WHERE company_db = _company_db AND module_key = _module_key)
    OR EXISTS (
      SELECT 1 FROM public.sap_cache sc JOIN public.sap_group_mapping m
        ON m.company_db = _company_db AND m.module_key = _module_key
      WHERE sc.company_db = _company_db
        AND (public.canonical_user_key(sc.data->>'UserCode') = public.canonical_user_key(_sap_username)
          OR public.canonical_user_key(sc.data->>'eMail') = public.canonical_user_key(_sap_username))
        AND m.sap_group_code = ANY (SELECT jsonb_array_elements_text(coalesce(sc.data->'Groups', '[]'::jsonb)))
        AND CASE _action
          WHEN 'view' THEN m.can_view WHEN 'create' THEN m.can_create WHEN 'edit' THEN m.can_edit
          WHEN 'delete' THEN m.can_delete WHEN 'approve' THEN m.can_approve
          WHEN 'integrate' THEN m.can_integrate WHEN 'export' THEN m.can_export ELSE false END
    )
  );
$$;
REVOKE ALL ON FUNCTION public.sap_user_has_module_action(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sap_user_has_module_action(text,text,text,text) TO service_role;
