
CREATE TABLE IF NOT EXISTS public.edge_rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.edge_rate_limits TO service_role;

ALTER TABLE public.edge_rate_limits ENABLE ROW LEVEL SECURITY;

-- No public policies: only service_role (bypass RLS) may touch this table.

CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  _key text,
  _max integer,
  _window_seconds integer
) RETURNS TABLE(allowed boolean, retry_after integer, current_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.edge_rate_limits;
  v_cutoff timestamptz := now() - make_interval(secs => _window_seconds);
BEGIN
  -- housekeeping: drop expired rows opportunistically (bounded)
  DELETE FROM public.edge_rate_limits
   WHERE window_started_at < now() - interval '1 day';

  SELECT * INTO v_row FROM public.edge_rate_limits WHERE key = _key FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO public.edge_rate_limits(key, window_started_at, count, updated_at)
    VALUES (_key, now(), 1, now());
    RETURN QUERY SELECT true, 0, 1;
    RETURN;
  END IF;

  IF v_row.window_started_at < v_cutoff THEN
    UPDATE public.edge_rate_limits
       SET window_started_at = now(), count = 1, updated_at = now()
     WHERE key = _key;
    RETURN QUERY SELECT true, 0, 1;
    RETURN;
  END IF;

  IF v_row.count >= _max THEN
    RETURN QUERY SELECT
      false,
      GREATEST(1, _window_seconds - EXTRACT(epoch FROM (now() - v_row.window_started_at))::int),
      v_row.count;
    RETURN;
  END IF;

  UPDATE public.edge_rate_limits
     SET count = count + 1, updated_at = now()
   WHERE key = _key;
  RETURN QUERY SELECT true, 0, v_row.count + 1;
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer) TO service_role;
