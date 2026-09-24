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
  v_company_type text;
BEGIN
  IF _user_id IS NULL OR _module IS NULL OR _action IS NULL THEN
    RETURN false;
  END IF;

  IF public.has_role(_user_id, 'admin') THEN
    RETURN true;
  END IF;

  IF _company_db IS NOT NULL THEN
    SELECT lower(coalesce(erp_type, '')) INTO v_company_type
    FROM public.companies WHERE company_db = _company_db LIMIT 1;
    IF v_company_type = 'omie' THEN
      RETURN true;
    END IF;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = _user_id LIMIT 1;
  IF v_email IS NULL THEN
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