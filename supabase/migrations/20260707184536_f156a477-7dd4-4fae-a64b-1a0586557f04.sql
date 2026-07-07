
-- Fix: try_watcher_lock declarava `acquired boolean` mas comparava com ROW_COUNT (integer),
-- causando erro "operator does not exist: boolean > integer" e travando toda a sincronização.
CREATE OR REPLACE FUNCTION public.try_watcher_lock(_name text, _ttl_minutes integer DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  acquired integer;
BEGIN
  INSERT INTO public.watcher_runs (watcher_name, locked_at, last_started_at, updated_at)
  VALUES (_name, now(), now(), now())
  ON CONFLICT (watcher_name) DO UPDATE
    SET locked_at = now(),
        last_started_at = now(),
        updated_at = now()
    WHERE public.watcher_runs.locked_at IS NULL
       OR public.watcher_runs.locked_at < now() - (_ttl_minutes || ' minutes')::interval;
  GET DIAGNOSTICS acquired = ROW_COUNT;
  RETURN acquired > 0;
END;
$function$;

-- Remove documento residual da JobHome (tentativa anterior, cancelada, sap_doc_num=13/sap_doc_entry=68).
DELETE FROM public.expenses
WHERE id = '03af9154-f9a4-49ca-9031-2e2682ace3bf'
  AND status = 'cancelado'
  AND sap_doc_entry = 68
  AND sap_doc_num = 13;
