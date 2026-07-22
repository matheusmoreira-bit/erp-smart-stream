
CREATE OR REPLACE FUNCTION public.copilot_read_query(p_sql text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin boolean;
  v_clean text;
  v_result jsonb;
BEGIN
  -- Autorização: apenas admins
  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO v_is_admin;
  IF NOT COALESCE(v_is_admin, false) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  v_clean := btrim(p_sql);

  -- Só permite uma sentença
  IF position(';' IN rtrim(v_clean, ';')) > 0 THEN
    RAISE EXCEPTION 'only a single statement is allowed';
  END IF;

  -- Só permite SELECT (ou CTE começando com WITH ... SELECT)
  IF NOT (v_clean ~* '^(select|with)\s') THEN
    RAISE EXCEPTION 'only SELECT statements are allowed';
  END IF;

  -- Bloqueia palavras-chave de escrita
  IF v_clean ~* '\y(insert|update|delete|drop|alter|truncate|grant|revoke|create|copy|call|do)\y' THEN
    RAISE EXCEPTION 'write keywords are not allowed';
  END IF;

  -- Timeout curto para evitar consultas pesadas
  PERFORM set_config('statement_timeout', '15000', true);

  -- Executa e agrega resultado em jsonb (limita 1000 linhas)
  EXECUTE format(
    'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (SELECT * FROM (%s) _q LIMIT 1000) t',
    rtrim(v_clean, ';')
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.copilot_read_query(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.copilot_read_query(text) TO authenticated;
