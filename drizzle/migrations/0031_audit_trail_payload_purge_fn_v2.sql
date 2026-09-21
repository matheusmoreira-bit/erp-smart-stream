-- Ajusta a rotina para desabilitar temporariamente a proteção append-only
-- apenas durante a limpeza do conteúdo detalhado.
CREATE OR REPLACE FUNCTION public.purge_audit_trail_payloads(_batch_limit int DEFAULT 5000)
RETURNS TABLE(cleared bigint, remaining bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count bigint := 0;
BEGIN
  ALTER TABLE public.audit_trail DISABLE TRIGGER audit_trail_guard_upd;
  WITH victims AS (
    SELECT id FROM public.audit_trail
     WHERE old_data IS NOT NULL OR new_data IS NOT NULL
     ORDER BY id ASC
     LIMIT _batch_limit
  )
  UPDATE public.audit_trail a SET old_data = NULL, new_data = NULL
    FROM victims v WHERE a.id = v.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  ALTER TABLE public.audit_trail ENABLE TRIGGER audit_trail_guard_upd;
  RETURN QUERY SELECT v_count,
    (SELECT count(*) FROM public.audit_trail WHERE old_data IS NOT NULL OR new_data IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.purge_audit_trail_payloads(int) FROM PUBLIC, anon, authenticated;
