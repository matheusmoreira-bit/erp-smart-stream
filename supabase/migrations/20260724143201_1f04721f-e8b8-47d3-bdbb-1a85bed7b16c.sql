DO $$
DECLARE
  fn record;
  sig text;
BEGIN
  FOR fn IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef=true
      AND p.proname IN (
        'archive_audit_trail','audit_trigger','cascade_delete_company_credentials',
        'check_expense_action_idempotency_consistency','companies_auto_flag_test',
        'copilot_read_query','delete_email','email_queue_dispatch','email_queue_wake',
        'enable_audit_on','enqueue_email','move_to_dlq','read_email_batch'
      )
  LOOP
    sig := format('public.%I(%s)', fn.proname, fn.args);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
  END LOOP;
END $$;