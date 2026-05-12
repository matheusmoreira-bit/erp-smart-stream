CREATE OR REPLACE FUNCTION public.sync_user_license_across_companies()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Evita loop infinito do trigger
  IF current_setting('app.syncing_license', true) = 'on' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.syncing_license', 'on', true);

  UPDATE public.user_licenses
  SET license_type = NEW.license_type,
      has_license  = NEW.has_license,
      updated_at   = now()
  WHERE lower(user_code) = lower(NEW.user_code)
    AND id <> NEW.id
    AND (license_type IS DISTINCT FROM NEW.license_type
         OR has_license IS DISTINCT FROM NEW.has_license);

  PERFORM set_config('app.syncing_license', 'off', true);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_user_license ON public.user_licenses;
CREATE TRIGGER trg_sync_user_license
AFTER INSERT OR UPDATE OF license_type, has_license ON public.user_licenses
FOR EACH ROW
EXECUTE FUNCTION public.sync_user_license_across_companies();