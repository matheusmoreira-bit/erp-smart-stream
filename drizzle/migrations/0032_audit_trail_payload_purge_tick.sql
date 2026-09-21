-- Passo automático da limpeza retroativa: roda um lote e se auto-remove da
-- agenda quando não houver mais registros com conteúdo detalhado.
CREATE OR REPLACE FUNCTION public.purge_audit_trail_payloads_tick()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_rem bigint;
BEGIN
  SELECT remaining INTO v_rem FROM public.purge_audit_trail_payloads(50000);
  IF v_rem = 0 THEN
    PERFORM cron.unschedule('audit-trail-payload-purge');
    RETURN 'done';
  END IF;
  RETURN 'remaining=' || v_rem;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_audit_trail_payloads_tick() FROM PUBLIC, anon, authenticated;
