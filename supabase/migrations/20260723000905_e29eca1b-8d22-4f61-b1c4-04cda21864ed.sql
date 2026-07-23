
CREATE TABLE IF NOT EXISTS public.infra_backup_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('db','storage')),
  status text NOT NULL CHECK (status IN ('running','ok','error','partial')),
  trigger text NOT NULL DEFAULT 'cron' CHECK (trigger IN ('cron','manual')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms bigint,
  bucket text,
  s3_prefix text,
  tables_count integer,
  objects_count integer,
  total_bytes bigint,
  manifest jsonb,
  error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.infra_backup_log TO authenticated;
GRANT ALL ON public.infra_backup_log TO service_role;

ALTER TABLE public.infra_backup_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read infra_backup_log" ON public.infra_backup_log;
CREATE POLICY "admins read infra_backup_log" ON public.infra_backup_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_infra_backup_log_kind_started
  ON public.infra_backup_log (kind, started_at DESC);

DROP TRIGGER IF EXISTS trg_infra_backup_log_updated ON public.infra_backup_log;
CREATE TRIGGER trg_infra_backup_log_updated
  BEFORE UPDATE ON public.infra_backup_log
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
