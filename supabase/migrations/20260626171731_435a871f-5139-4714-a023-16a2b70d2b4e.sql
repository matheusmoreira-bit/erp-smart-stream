CREATE TABLE IF NOT EXISTS public.watcher_runs (
  watcher_name text PRIMARY KEY,
  locked_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz,
  last_status text,
  last_message text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.watcher_runs TO authenticated;
GRANT ALL ON public.watcher_runs TO service_role;
ALTER TABLE public.watcher_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read watcher_runs" ON public.watcher_runs
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.try_watcher_lock(_name text, _ttl_minutes int DEFAULT 10)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE acquired boolean;
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
$$;

CREATE OR REPLACE FUNCTION public.release_watcher_lock(_name text, _status text DEFAULT 'ok', _message text DEFAULT NULL)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.watcher_runs
     SET locked_at = NULL,
         last_finished_at = now(),
         last_status = _status,
         last_message = _message,
         updated_at = now()
   WHERE watcher_name = _name;
$$;

REVOKE ALL ON FUNCTION public.try_watcher_lock(text, int) FROM public;
REVOKE ALL ON FUNCTION public.release_watcher_lock(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.try_watcher_lock(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_watcher_lock(text, text, text) TO service_role;