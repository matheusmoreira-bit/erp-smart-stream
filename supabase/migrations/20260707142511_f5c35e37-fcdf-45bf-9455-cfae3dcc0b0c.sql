ALTER TABLE public.expense_action_idempotency
  DROP CONSTRAINT IF EXISTS expense_action_idempotency_action_chk;
ALTER TABLE public.expense_action_idempotency
  ADD CONSTRAINT expense_action_idempotency_action_chk
  CHECK (action IN ('approve','reject'));

ALTER TABLE public.expense_action_idempotency
  DROP CONSTRAINT IF EXISTS expense_action_idempotency_completion_chk;
ALTER TABLE public.expense_action_idempotency
  ADD CONSTRAINT expense_action_idempotency_completion_chk
  CHECK (
    (completed_at IS NULL AND status_code IS NULL)
    OR (completed_at IS NOT NULL AND status_code IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS expense_action_idempotency_created_at_idx
  ON public.expense_action_idempotency (created_at);

CREATE INDEX IF NOT EXISTS expense_action_idempotency_inflight_idx
  ON public.expense_action_idempotency (created_at)
  WHERE completed_at IS NULL;

CREATE OR REPLACE FUNCTION public.purge_expense_action_idempotency(
  _stale_reservation_minutes int DEFAULT 15,
  _completed_retention_hours int DEFAULT 24
)
RETURNS TABLE(stale_removed bigint, completed_removed bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_stale bigint;
  v_completed bigint;
BEGIN
  DELETE FROM public.expense_action_idempotency
   WHERE completed_at IS NULL
     AND created_at < now() - make_interval(mins => _stale_reservation_minutes);
  GET DIAGNOSTICS v_stale = ROW_COUNT;

  DELETE FROM public.expense_action_idempotency
   WHERE completed_at IS NOT NULL
     AND completed_at < now() - make_interval(hours => _completed_retention_hours);
  GET DIAGNOSTICS v_completed = ROW_COUNT;

  IF v_stale > 0 OR v_completed > 0 THEN
    RAISE LOG 'purge_expense_action_idempotency: stale=% completed=%', v_stale, v_completed;
  END IF;

  RETURN QUERY SELECT v_stale, v_completed;
END;
$fn$;

REVOKE ALL ON FUNCTION public.purge_expense_action_idempotency(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expense_action_idempotency(int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.check_expense_action_idempotency_consistency()
RETURNS TABLE(
  total bigint,
  in_flight bigint,
  stale_in_flight bigint,
  completed bigint,
  expired_completed bigint,
  oldest_in_flight timestamptz,
  oldest_completed timestamptz
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE completed_at IS NULL) AS in_flight,
    count(*) FILTER (WHERE completed_at IS NULL AND created_at < now() - interval '15 minutes') AS stale_in_flight,
    count(*) FILTER (WHERE completed_at IS NOT NULL) AS completed,
    count(*) FILTER (WHERE completed_at IS NOT NULL AND completed_at < now() - interval '24 hours') AS expired_completed,
    min(created_at) FILTER (WHERE completed_at IS NULL) AS oldest_in_flight,
    min(completed_at) FILTER (WHERE completed_at IS NOT NULL) AS oldest_completed
  FROM public.expense_action_idempotency;
$fn$;

REVOKE ALL ON FUNCTION public.check_expense_action_idempotency_consistency() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_expense_action_idempotency_consistency() TO service_role, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-expense-action-idempotency') THEN
    PERFORM cron.unschedule('purge-expense-action-idempotency');
  END IF;
  PERFORM cron.schedule(
    'purge-expense-action-idempotency',
    '*/5 * * * *',
    $cron$ SELECT public.purge_expense_action_idempotency(); $cron$
  );
END $$;