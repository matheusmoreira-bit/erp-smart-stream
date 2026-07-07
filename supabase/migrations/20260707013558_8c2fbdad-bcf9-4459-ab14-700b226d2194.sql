-- Backfill
UPDATE public.companies
SET is_test = true
WHERE is_test = false
  AND (display_name ILIKE 'TST%' OR company_db ILIKE 'TST%');

-- Auto-flag trigger on companies
CREATE OR REPLACE FUNCTION public.companies_auto_flag_test()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.display_name ILIKE 'TST%' OR NEW.company_db ILIKE 'TST%') THEN
    NEW.is_test := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_companies_auto_flag_test ON public.companies;
CREATE TRIGGER trg_companies_auto_flag_test
BEFORE INSERT OR UPDATE OF display_name, company_db
ON public.companies
FOR EACH ROW
EXECUTE FUNCTION public.companies_auto_flag_test();

-- Skip-insert trigger on notifications for test companies
CREATE OR REPLACE FUNCTION public.notifications_skip_test_companies()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_test boolean;
BEGIN
  IF NEW.company_db IS NULL OR NEW.company_db = '' THEN
    RETURN NEW;
  END IF;
  SELECT c.is_test INTO v_is_test
    FROM public.companies c
   WHERE c.company_db = NEW.company_db
   LIMIT 1;
  IF v_is_test THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_skip_test_companies ON public.notifications;
CREATE TRIGGER trg_notifications_skip_test_companies
BEFORE INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.notifications_skip_test_companies();