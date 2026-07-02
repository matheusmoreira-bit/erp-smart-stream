
-- Ensure pgcrypto for digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- ============================================================================
-- AUDIT TRAIL: append-only + hash chain
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_trail (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor_id     UUID,
  actor_email  TEXT,
  actor_role   TEXT,
  session_jwt_sub TEXT,
  schema_name  TEXT NOT NULL,
  table_name   TEXT NOT NULL,
  op           CHAR(1) NOT NULL CHECK (op IN ('I','U','D')),
  row_pk       JSONB,
  old_data     JSONB,
  new_data     JSONB,
  changed_cols TEXT[],
  prev_hash    BYTEA,
  row_hash     BYTEA NOT NULL,
  app_context  JSONB
);

CREATE INDEX IF NOT EXISTS idx_audit_trail_ts    ON public.audit_trail (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_table ON public.audit_trail (schema_name, table_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_actor ON public.audit_trail (actor_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_row   ON public.audit_trail (schema_name, table_name, (row_pk::text));

GRANT SELECT ON public.audit_trail TO authenticated;
GRANT SELECT ON public.audit_trail TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audit_trail FROM PUBLIC, anon, authenticated, service_role;
REVOKE USAGE, SELECT, UPDATE ON SEQUENCE public.audit_trail_id_seq FROM PUBLIC, anon, authenticated;

ALTER TABLE public.audit_trail ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_trail FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_trail_admin_read" ON public.audit_trail;
CREATE POLICY "audit_trail_admin_read"
  ON public.audit_trail FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- HELPERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public._audit_canonicalize(_data JSONB)
RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT '{' || string_agg(to_json(k) || ':' || v::text, ',' ORDER BY k) || '}'
     FROM jsonb_each(_data) AS e(k, v)),
    'null'
  );
$$;

CREATE OR REPLACE FUNCTION public._audit_row_pk(_tbl regclass, _row JSONB)
RETURNS JSONB
LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB := '{}'::jsonb;
  v_col TEXT;
BEGIN
  IF _row IS NULL THEN RETURN NULL; END IF;
  FOR v_col IN
    SELECT a.attname
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = _tbl AND i.indisprimary
  LOOP
    v_result := v_result || jsonb_build_object(v_col, _row -> v_col);
  END LOOP;
  RETURN CASE WHEN v_result = '{}'::jsonb THEN NULL ELSE v_result END;
END;
$$;

-- ============================================================================
-- AUDIT TRIGGER (hash chain)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_pk  JSONB;
  v_changed TEXT[];
  v_prev BYTEA;
  v_hash BYTEA;
  v_actor_id UUID;
  v_actor_email TEXT;
  v_jwt_sub TEXT;
  v_payload TEXT;
  v_op CHAR(1);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('public.audit_trail')::bigint);

  IF TG_OP = 'INSERT' THEN
    v_op := 'I'; v_old := NULL; v_new := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_op := 'U'; v_old := to_jsonb(OLD); v_new := to_jsonb(NEW);
    IF v_old = v_new THEN RETURN NEW; END IF;
    SELECT array_agg(key) INTO v_changed
      FROM jsonb_each(v_new) n
     WHERE n.value IS DISTINCT FROM (v_old -> n.key);
  ELSIF TG_OP = 'DELETE' THEN
    v_op := 'D'; v_old := to_jsonb(OLD); v_new := NULL;
  ELSE
    RETURN NULL;
  END IF;

  v_pk := public._audit_row_pk(TG_RELID::regclass, COALESCE(v_new, v_old));

  BEGIN v_actor_id := auth.uid(); EXCEPTION WHEN OTHERS THEN v_actor_id := NULL; END;
  BEGIN
    v_actor_email := current_setting('request.jwt.claims', true)::jsonb ->> 'email';
    v_jwt_sub     := current_setting('request.jwt.claims', true)::jsonb ->> 'sub';
  EXCEPTION WHEN OTHERS THEN v_actor_email := NULL; v_jwt_sub := NULL;
  END;

  SELECT row_hash INTO v_prev FROM public.audit_trail ORDER BY id DESC LIMIT 1;

  v_payload := COALESCE(encode(v_prev, 'hex'), '') || '|' ||
               TG_TABLE_SCHEMA || '|' || TG_TABLE_NAME || '|' || v_op || '|' ||
               COALESCE(v_actor_id::text, '') || '|' ||
               public._audit_canonicalize(v_old) || '|' ||
               public._audit_canonicalize(v_new);
  v_hash := public.digest(v_payload, 'sha256');

  INSERT INTO public.audit_trail (
    actor_id, actor_email, actor_role, session_jwt_sub,
    schema_name, table_name, op, row_pk, old_data, new_data, changed_cols,
    prev_hash, row_hash
  ) VALUES (
    v_actor_id, v_actor_email, current_user, v_jwt_sub,
    TG_TABLE_SCHEMA, TG_TABLE_NAME, v_op, v_pk, v_old, v_new, v_changed,
    v_prev, v_hash
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_trigger() FROM PUBLIC;

-- ============================================================================
-- APPEND-ONLY GUARD
-- ============================================================================

CREATE OR REPLACE FUNCTION public._audit_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_trail is append-only (op=%)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_trail_guard_upd ON public.audit_trail;
CREATE TRIGGER audit_trail_guard_upd
  BEFORE UPDATE ON public.audit_trail
  FOR EACH ROW EXECUTE FUNCTION public._audit_guard();

DROP TRIGGER IF EXISTS audit_trail_guard_del ON public.audit_trail;
CREATE TRIGGER audit_trail_guard_del
  BEFORE DELETE ON public.audit_trail
  FOR EACH ROW EXECUTE FUNCTION public._audit_guard();

DROP TRIGGER IF EXISTS audit_trail_guard_trunc ON public.audit_trail;
CREATE TRIGGER audit_trail_guard_trunc
  BEFORE TRUNCATE ON public.audit_trail
  FOR EACH STATEMENT EXECUTE FUNCTION public._audit_guard();

-- ============================================================================
-- CHAIN VERIFICATION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_audit_chain(_limit INT DEFAULT NULL)
RETURNS TABLE(first_broken_id BIGINT, total_checked BIGINT, ok BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_prev BYTEA := NULL;
  v_expected BYTEA;
  v_payload TEXT;
  v_count BIGINT := 0;
  v_broken BIGINT := NULL;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  FOR r IN
    SELECT id, actor_id, schema_name, table_name, op, old_data, new_data, prev_hash, row_hash
    FROM public.audit_trail
    ORDER BY id ASC
    LIMIT COALESCE(_limit, 2147483647)
  LOOP
    v_count := v_count + 1;
    IF r.prev_hash IS DISTINCT FROM v_prev THEN
      v_broken := r.id; EXIT;
    END IF;
    v_payload := COALESCE(encode(r.prev_hash, 'hex'), '') || '|' ||
                 r.schema_name || '|' || r.table_name || '|' || r.op || '|' ||
                 COALESCE(r.actor_id::text, '') || '|' ||
                 public._audit_canonicalize(r.old_data) || '|' ||
                 public._audit_canonicalize(r.new_data);
    v_expected := public.digest(v_payload, 'sha256');
    IF v_expected IS DISTINCT FROM r.row_hash THEN
      v_broken := r.id; EXIT;
    END IF;
    v_prev := r.row_hash;
  END LOOP;
  RETURN QUERY SELECT v_broken, v_count, v_broken IS NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_audit_chain(INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain(INT) TO authenticated;

-- ============================================================================
-- ATTACH HELPER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enable_audit_on(_table TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trigger TEXT := '_audit_' || _table;
BEGIN
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', v_trigger, _table);
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
    || 'FOR EACH ROW EXECUTE FUNCTION public.audit_trigger()',
    v_trigger, _table
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.enable_audit_on(TEXT) FROM PUBLIC;

-- ============================================================================
-- ATTACH to existing tables (excluding logs, caches, queues, self)
-- ============================================================================

DO $$
DECLARE
  v_table TEXT;
  v_excluded TEXT[] := ARRAY[
    'audit_trail','audit_log',
    'integration_log','pagcorp_integration_log','synapse_execution_log',
    'audit_console_logs','nf_entrada_logs',
    'sap_cache','watcher_runs',
    'email_send_log','email_send_state','email_unsubscribe_tokens',
    'suppressed_emails','notification_send_runs','po_notification_sent',
    'approval_history_sync_state',
    'whatsapp_login_alerts','whatsapp_approval_alerts','license_idle_alerts',
    'ai_chat_messages','ai_chat_threads'
  ];
BEGIN
  FOR v_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT (c.relname = ANY(v_excluded))
  LOOP
    PERFORM public.enable_audit_on(v_table);
  END LOOP;
END;
$$;
