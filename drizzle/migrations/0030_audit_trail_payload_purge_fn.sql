-- Rotina de minimização retroativa: apaga em lotes o conteúdo antes/depois
-- dos registros históricos da trilha de auditoria, preservando quem, quando
-- e o que foi alterado.
CREATE OR REPLACE FUNCTION public.purge_audit_trail_payloads(_batch_limit int DEFAULT 5000)
RETURNS TABLE(cleared bigint, remaining bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count bigint := 0;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);
  WITH victims AS (
    SELECT id FROM public.audit_trail
     WHERE old_data IS NOT NULL OR new_data IS NOT NULL
     ORDER BY id ASC
     LIMIT _batch_limit
  )
  UPDATE public.audit_trail a SET old_data = NULL, new_data = NULL
    FROM victims v WHERE a.id = v.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('session_replication_role', 'origin', true);
  RETURN QUERY SELECT v_count,
    (SELECT count(*) FROM public.audit_trail WHERE old_data IS NOT NULL OR new_data IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_audit_trail_payloads(int) FROM PUBLIC, anon, authenticated;
