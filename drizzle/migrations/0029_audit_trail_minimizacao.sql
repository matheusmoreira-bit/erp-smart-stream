-- Minimização de dados da trilha de auditoria:
-- passa a registrar apenas quem, quando e o que foi alterado (tabela, operação,
-- chave do registro e nomes das colunas alteradas). Os conteúdos completos
-- antes/depois deixam de ser armazenados. A cadeia de hash continua sendo
-- calculada sobre o conteúdo, preservando a prova de integridade.
CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
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

  IF v_op = 'I' THEN
    SELECT array_agg(key) INTO v_changed FROM jsonb_each(v_new);
  END IF;

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
  v_hash := extensions.digest(convert_to(v_payload, 'UTF8'), 'sha256'::text);

  -- Minimização: old_data/new_data não são mais persistidos.
  INSERT INTO public.audit_trail (
    actor_id, actor_email, actor_role, session_jwt_sub,
    schema_name, table_name, op, row_pk, old_data, new_data, changed_cols,
    prev_hash, row_hash
  ) VALUES (
    v_actor_id, v_actor_email, current_user, v_jwt_sub,
    TG_TABLE_SCHEMA, TG_TABLE_NAME, v_op, v_pk, NULL, NULL, v_changed,
    v_prev, v_hash
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

COMMENT ON COLUMN public.audit_trail.old_data IS 'DEPRECATED: não é mais preenchido (minimização de dados). Mantido para registros históricos.';
COMMENT ON COLUMN public.audit_trail.new_data IS 'DEPRECATED: não é mais preenchido (minimização de dados). Mantido para registros históricos.';
