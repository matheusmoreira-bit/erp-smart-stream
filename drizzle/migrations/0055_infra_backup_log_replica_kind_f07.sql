ALTER TABLE public.infra_backup_log DROP CONSTRAINT infra_backup_log_kind_check;
ALTER TABLE public.infra_backup_log ADD CONSTRAINT infra_backup_log_kind_check CHECK (kind = ANY (ARRAY['db','storage','replica']));
ALTER TABLE public.infra_backup_log DROP CONSTRAINT infra_backup_log_trigger_check;
ALTER TABLE public.infra_backup_log ADD CONSTRAINT infra_backup_log_trigger_check CHECK (trigger = ANY (ARRAY['cron','manual','chain','service_role','scheduler_secret','admin']));