
CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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
  v_hash := extensions.digest(v_payload::bytea, 'sha256'::text);

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

CREATE OR REPLACE FUNCTION public.verify_audit_chain(_limit INT DEFAULT NULL)
RETURNS TABLE(first_broken_id BIGINT, total_checked BIGINT, ok BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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
    v_expected := extensions.digest(v_payload::bytea, 'sha256'::text);
    IF v_expected IS DISTINCT FROM r.row_hash THEN
      v_broken := r.id; EXIT;
    END IF;
    v_prev := r.row_hash;
  END LOOP;
  RETURN QUERY SELECT v_broken, v_count, v_broken IS NULL;
END;
$$;
