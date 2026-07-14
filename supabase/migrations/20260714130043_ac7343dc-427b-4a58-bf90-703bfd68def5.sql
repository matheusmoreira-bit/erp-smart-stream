
DROP TRIGGER IF EXISTS _audit_approval_history ON public.approval_history;
DROP TRIGGER IF EXISTS _audit_nf_entrada_settings ON public.nf_entrada_settings;

CREATE TABLE IF NOT EXISTS public.audit_trail_archive (
  id BIGINT PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  actor_id UUID,
  actor_email TEXT,
  actor_role TEXT,
  session_jwt_sub TEXT,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  op CHAR(1) NOT NULL,
  row_pk JSONB,
  old_data JSONB,
  new_data JSONB,
  changed_cols TEXT[],
  prev_hash BYTEA,
  row_hash BYTEA,
  app_context JSONB,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_trail_archive_ts ON public.audit_trail_archive (ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_archive_table ON public.audit_trail_archive (schema_name, table_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_trail_archive_actor ON public.audit_trail_archive (actor_id, ts DESC);

GRANT SELECT ON public.audit_trail_archive TO authenticated;
GRANT ALL ON public.audit_trail_archive TO service_role;

ALTER TABLE public.audit_trail_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_audit_archive" ON public.audit_trail_archive;
CREATE POLICY "admin_read_audit_archive" ON public.audit_trail_archive
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.archive_audit_trail(_keep_months INTEGER DEFAULT 6, _batch_limit INTEGER DEFAULT 50000)
RETURNS TABLE(archived_count BIGINT, cutoff TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ := now() - make_interval(months => _keep_months);
  v_count BIGINT := 0;
BEGIN
  PERFORM set_config('session_replication_role', 'replica', true);

  WITH moved AS (
    DELETE FROM public.audit_trail
    WHERE id IN (
      SELECT id FROM public.audit_trail
      WHERE ts < v_cutoff
      ORDER BY id ASC
      LIMIT _batch_limit
    )
    RETURNING *
  )
  INSERT INTO public.audit_trail_archive
    (id, ts, actor_id, actor_email, actor_role, session_jwt_sub,
     schema_name, table_name, op, row_pk, old_data, new_data, changed_cols, prev_hash, row_hash, app_context)
  SELECT id, ts, actor_id, actor_email, actor_role, session_jwt_sub,
         schema_name, table_name, op, row_pk, old_data, new_data, changed_cols, prev_hash, row_hash, app_context
  FROM moved;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('session_replication_role', 'origin', true);
  RETURN QUERY SELECT v_count, v_cutoff;
END;
$$;

REVOKE ALL ON FUNCTION public.archive_audit_trail(INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_audit_trail(INTEGER, INTEGER) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'archive-audit-trail-monthly') THEN
    PERFORM cron.unschedule('archive-audit-trail-monthly');
  END IF;
  PERFORM cron.schedule(
    'archive-audit-trail-monthly',
    '0 3 1 * *',
    $cron$ SELECT public.archive_audit_trail(6, 50000); $cron$
  );
END $$;

CREATE OR REPLACE VIEW public.audit_trail_all
WITH (security_invoker = true) AS
  SELECT id, ts, actor_id, actor_email, actor_role, session_jwt_sub,
         schema_name, table_name, op, row_pk, old_data, new_data, changed_cols,
         prev_hash, row_hash, app_context, false AS archived
  FROM public.audit_trail
  UNION ALL
  SELECT id, ts, actor_id, actor_email, actor_role, session_jwt_sub,
         schema_name, table_name, op, row_pk, old_data, new_data, changed_cols,
         prev_hash, row_hash, app_context, true AS archived
  FROM public.audit_trail_archive;

GRANT SELECT ON public.audit_trail_all TO authenticated;

UPDATE public.sap_nf_entrada_cache SET raw_json = '{}'::jsonb WHERE raw_json <> '{}'::jsonb;
ALTER TABLE public.sap_nf_entrada_cache ALTER COLUMN raw_json SET DEFAULT '{}'::jsonb;
