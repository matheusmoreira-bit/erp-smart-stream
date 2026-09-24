-- F06 (etapa 2): cifra os segredos gravados e todos os novos.
CREATE OR REPLACE FUNCTION public.system_credentials_encrypt_trg()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, private, extensions AS $$
BEGIN
  IF public.is_secret_credential_key(NEW.credential_key)
     AND NEW.credential_value IS NOT NULL AND NEW.credential_value <> ''
     AND NEW.credential_value NOT LIKE 'enc:v1:%' THEN
    NEW.credential_value := 'enc:v1:' || encode(
      extensions.pgp_sym_encrypt(NEW.credential_value, private.cred_material(), 'cipher-algo=aes256'), 'base64');
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.system_credentials_encrypt_trg() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS system_credentials_encrypt_biu ON public.system_credentials;
CREATE TRIGGER system_credentials_encrypt_biu
  BEFORE INSERT OR UPDATE ON public.system_credentials
  FOR EACH ROW EXECUTE FUNCTION public.system_credentials_encrypt_trg();

UPDATE public.system_credentials
   SET credential_value = credential_value
 WHERE public.is_secret_credential_key(credential_key)
   AND credential_value IS NOT NULL AND credential_value <> ''
   AND credential_value NOT LIKE 'enc:v1:%';

COMMENT ON COLUMN public.system_credentials.credential_value IS
  'Segredos cifrados (enc:v1:). Backend lê decifrado via public.system_credentials_v.';

-- lovable-cron-fallback-reviewed: only switches the token lookup to the decrypting view; schedule unchanged.
SELECT cron.alter_job(jobid, command := replace(command, 'public.system_credentials where', 'public.system_credentials_v where'))
  FROM cron.job WHERE jobname = 'audit-console-monthly';