CREATE FUNCTION public.assert_erp_rpc_access() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.role() IN ('anon','authenticated') AND NOT public.erp_access_admitted() THEN
  RAISE EXCEPTION 'Seu acesso ao ERP Flow está temporariamente bloqueado.' USING ERRCODE='42501';
 END IF;
END; $$;
REVOKE ALL ON FUNCTION public.assert_erp_rpc_access() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_erp_rpc_access() TO anon,authenticated,service_role;

DO $migration$
DECLARE f record; definition text; body text; guarded text;
BEGIN
 FOR f IN
  SELECT p.oid,p.proname,p.prosrc,l.lanname,p.proretset
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
  WHERE n.nspname='public' AND p.prosecdef
  AND p.proname=ANY(ARRAY[
   'find_open_registration_duplicate','close_access_review_campaign','can_access_registration_attachment',
   'list_duplicate_identities','admin_list_companies','company_tax_id','can_access_audit_console',
   'check_applicable_approval_rules','audit_trail_filter_options','get_db_query_metrics_by_target',
   'reveal_system_credential','can_manage_nfse_recipients','is_registration_agent','list_baixas_by_invoice',
   'can_manage_employee_integration','release_cancelled_document_hashes','is_email_allowed_for_omie_company',
   'is_email_allowed_for_company','get_nf_entrada_cache_by_po','get_document_timeline','get_edge_metrics_timeseries',
   'get_system_activity','get_legacy_po_chain','get_sap_sync_health','apply_unified_purchase_approval',
   'get_notification_deliveries','has_module_action','get_flow_stage_metrics','get_my_directorate_peers',
   'verify_audit_chain','get_notification_delivery_attempts','list_login_companies','get_flow_user_activity',
   'get_edge_function_metrics','get_flow_user_productivity','get_db_query_metrics_by_screen',
   'open_access_review_campaign','get_flow_last_login','active_officials_for_substitute',
   'substitute_grants_for_me','join_registration_request','get_expense_read_metrics',
   'get_integration_health','get_my_idp_cost_center'
  ])
 LOOP
  definition:=pg_get_functiondef(f.oid);
  IF position('assert_erp_rpc_access' in f.prosrc)>0 THEN CONTINUE; END IF;
  IF f.lanname='plpgsql' THEN
   IF f.prosrc !~* '\mBEGIN\M' THEN RAISE EXCEPTION 'Missing body start in %',f.proname; END IF;
   guarded:=regexp_replace(f.prosrc,'\mBEGIN\M',E'BEGIN\n PERFORM public.assert_erp_rpc_access();','i');
  ELSIF f.lanname='sql' THEN
   body:=regexp_replace(btrim(f.prosrc),';[[:space:]]*$','');
   IF f.proretset THEN
    guarded:=E'#variable_conflict use_column\nBEGIN\n PERFORM public.assert_erp_rpc_access();\n RETURN QUERY\n'||body||E';\nEND;';
   ELSE
    guarded:=E'BEGIN\n PERFORM public.assert_erp_rpc_access();\n RETURN (\n'||body||E'\n);\nEND;';
   END IF;
   definition:=replace(definition,'LANGUAGE sql','LANGUAGE plpgsql');
  ELSE RAISE EXCEPTION 'Unsupported language for %',f.proname;
  END IF;
  definition:=replace(definition,'$function$'||f.prosrc||'$function$','$function$'||guarded||'$function$');
  EXECUTE definition;
 END LOOP;
END;
$migration$;