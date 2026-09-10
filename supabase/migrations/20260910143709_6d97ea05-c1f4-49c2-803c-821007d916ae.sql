CREATE OR REPLACE FUNCTION public.get_my_directorate_peers(_sap_user_name text DEFAULT NULL::text)
RETURNS TABLE (sap_email text, idp_email text, sap_user_code text, cost_center_code text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cc     text;
  v_branch text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  v_cc := public.get_my_idp_cost_center(_sap_user_name);
  IF v_cc IS NULL OR trim(v_cc) = '' THEN
    RETURN;
  END IF;

  -- Ramo (diretoria) = dois primeiros níveis do CC. Ex.: 1.6.1.2 -> 1.6
  IF split_part(v_cc, '.', 2) = '' THEN
    RETURN;
  END IF;
  v_branch := split_part(v_cc, '.', 1) || '.' || split_part(v_cc, '.', 2);

  RETURN QUERY
  SELECT lower(coalesce(m.sap_email, '')),
         lower(coalesce(m.idp_email, '')),
         lower(coalesce(m.sap_user_code, '')),
         m.cost_center_code
    FROM public.idp_user_mapping m
   WHERE m.cost_center_code IS NOT NULL
     AND (m.cost_center_code = v_branch OR m.cost_center_code LIKE v_branch || '.%')
     AND m.deprovisioned_at IS NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_my_directorate_peers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_directorate_peers(text) TO authenticated;