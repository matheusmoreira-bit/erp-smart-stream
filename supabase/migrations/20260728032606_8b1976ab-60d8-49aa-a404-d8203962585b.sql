ALTER TABLE public.gdrive_backup_settings
  ADD COLUMN IF NOT EXISTS run_status text,
  ADD COLUMN IF NOT EXISTS run_progress text,
  ADD COLUMN IF NOT EXISTS run_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS run_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS run_trigger text,
  ADD COLUMN IF NOT EXISTS run_error text,
  ADD COLUMN IF NOT EXISTS last_snapshot text;