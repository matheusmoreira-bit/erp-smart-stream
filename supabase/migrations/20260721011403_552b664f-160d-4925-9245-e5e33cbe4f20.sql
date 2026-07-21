
CREATE OR REPLACE FUNCTION public.get_my_idp_cost_center(_sap_user_name text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_email text;
  v_local text;
  v_sap   text := lower(trim(coalesce(_sap_user_name, '')));
  v_cc    text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT lower(email) INTO v_email FROM auth.users WHERE id = auth.uid();
  v_local := split_part(coalesce(v_email,''), '@', 1);

  SELECT cost_center_code
    INTO v_cc
    FROM public.idp_user_mapping
   WHERE cost_center_code IS NOT NULL
     AND cost_center_code <> ''
     AND (
       lower(coalesce(sap_email,'')) = v_email
       OR lower(coalesce(idp_email,'')) = v_email
       OR lower(coalesce(sap_user_code,'')) = v_local
       OR (v_sap <> '' AND (
             lower(coalesce(sap_email,'')) = v_sap
             OR lower(coalesce(idp_email,'')) = v_sap
             OR lower(coalesce(sap_user_code,'')) = v_sap
             OR lower(coalesce(sap_email,'')) LIKE v_sap || '@%'
             OR lower(coalesce(idp_email,'')) LIKE v_sap || '@%'
       ))
     )
   ORDER BY attributes_synced_at DESC NULLS LAST
   LIMIT 1;

  RETURN v_cc;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_idp_cost_center(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_idp_cost_center(text) TO authenticated;
