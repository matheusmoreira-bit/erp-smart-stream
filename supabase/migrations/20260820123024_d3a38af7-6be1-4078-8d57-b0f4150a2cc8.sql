ALTER TABLE public.erp_session_cache ADD COLUMN IF NOT EXISTS is_service boolean NOT NULL DEFAULT false;
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
   WHERE conrelid = 'public.erp_session_cache'::regclass AND contype = 'u';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE public.erp_session_cache DROP CONSTRAINT %I', c); END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS erp_session_cache_user_company_service_key
  ON public.erp_session_cache (user_id, company_db, is_service);