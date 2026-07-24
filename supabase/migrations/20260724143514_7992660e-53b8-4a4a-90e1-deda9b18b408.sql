-- 1) service_role only
DO $$
DECLARE fn record; sig text;
BEGIN
  FOR fn IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN (
        'sync_user_license_across_companies','notifications_skip_test_companies',
        'sync_collab_phone_to_companies','set_baixa_criado_por',
        'register_external_api_success','register_external_api_failure',
        'check_external_api_access','try_watcher_lock','release_watcher_lock',
        'prune_old_integration_data','_run_pagcorp_attachment_backfill','create_item_variante'
      )
  LOOP
    sig := format('public.%I(%s)', fn.proname, fn.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;

-- 2) verify_audit_chain: authenticated + service_role (Backoffice + admin auditing)
REVOKE ALL ON FUNCTION public.verify_audit_chain(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain(integer) TO authenticated, service_role;