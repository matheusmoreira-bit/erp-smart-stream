DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'copilot_reader') THEN
    CREATE ROLE copilot_reader NOLOGIN BYPASSRLS;
  END IF;
END $$;
GRANT copilot_reader TO postgres;
GRANT USAGE ON SCHEMA public TO copilot_reader;
CREATE SCHEMA IF NOT EXISTS copilot_ro;
REVOKE ALL ON SCHEMA copilot_ro FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA copilot_ro TO copilot_reader;

DO $$
DECLARE
  r record;
  cols text;
  sensitive_tables text[] := ARRAY[
    'system_credentials','system_credentials_v','user_sap_credentials','pagcorp_portal_sessions',
    'erp_session_cache','erp_session_revocations','auth_caller_cache','api_keys','approval_action_tokens',
    'email_unsubscribe_tokens','security_csrf_tokens','accounts_payable_bank_accounts',
    'accounts_payable_supplier_payment_profiles','nfse_email_settings'];
  col_rx text := '(secret|password|senha|token|api_key|app_key|private_key|cookie|csrf|hmac|_enc$|encrypted|pix_key|account_number|_url$|hana|service_layer)';
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind IN ('r','v','m','p') LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM copilot_reader', r.relname);
    IF r.relname = ANY(sensitive_tables) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=r.relname AND column_name ~* col_rx) THEN
      SELECT string_agg(quote_ident(column_name), ',') INTO cols FROM information_schema.columns
        WHERE table_schema='public' AND table_name=r.relname AND column_name !~* col_rx;
      IF cols IS NOT NULL THEN
        EXECUTE format('GRANT SELECT (%s) ON public.%I TO copilot_reader', cols, r.relname);
      END IF;
    ELSE
      EXECUTE format('GRANT SELECT ON public.%I TO copilot_reader', r.relname);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION copilot_ro.exec_readonly(p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_result jsonb;
BEGIN
  PERFORM set_config('statement_timeout', '15000', true);
  EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (SELECT * FROM (%s) _q LIMIT 1000) t', p_sql)
    INTO v_result;
  RETURN v_result;
END $fn$;
ALTER FUNCTION copilot_ro.exec_readonly(text) OWNER TO copilot_reader;
REVOKE ALL ON FUNCTION copilot_ro.exec_readonly(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.copilot_read_query(p_sql text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_clean text;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(), 'admin'::app_role), false) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  v_clean := rtrim(btrim(p_sql), ';');
  IF position(';' IN v_clean) > 0 THEN RAISE EXCEPTION 'only a single statement is allowed'; END IF;
  IF NOT (v_clean ~* '^(select|with)\s') THEN RAISE EXCEPTION 'only SELECT statements are allowed'; END IF;
  IF v_clean ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|do|set|reset|execute|prepare|listen|notify|lock|vacuum)\y' THEN
    RAISE EXCEPTION 'write keywords are not allowed';
  END IF;
  IF v_clean ~* '(\y(auth|vault|private|cron|net|storage|supabase_functions|pgsodium|extensions|copilot_ro)\s*\.|credential|secret|keyring|decrypt|pgp_|query_to_|xpath|dblink|\ylo_|pg_read|pg_ls|set_config|current_setting|pg_sleep|reveal_|email_queue|_run_|cascade_delete|list_duplicate)' THEN
    RAISE EXCEPTION 'blocked: sensitive object referenced';
  END IF;
  RETURN copilot_ro.exec_readonly(v_clean);
END $function$;

CREATE TABLE public.copilot_pending_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tool_name text NOT NULL,
  args jsonb NOT NULL,
  summary text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','failed')),
  decided_at timestamptz,
  result jsonb
);
GRANT ALL ON public.copilot_pending_actions TO service_role;
ALTER TABLE public.copilot_pending_actions ENABLE ROW LEVEL SECURITY;
CREATE INDEX copilot_pending_actions_user_idx ON public.copilot_pending_actions(user_id, created_at DESC);