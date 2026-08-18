CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.credentials_encryption_key()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  key_value text;
BEGIN
  key_value := coalesce(
    nullif(current_setting('app.settings.credentials_encryption_key', true), ''),
    nullif(current_setting('app.settings.jwt_secret', true), '')
  );
  IF key_value IS NULL OR length(key_value) < 32 THEN
    RAISE EXCEPTION 'credentials encryption key is not configured';
  END IF;
  RETURN key_value;
END;
$$;

ALTER TABLE public.system_credentials
  RENAME TO system_credentials_store;

ALTER TABLE public.system_credentials_store
  ADD COLUMN credential_ciphertext bytea;

UPDATE public.system_credentials_store
SET credential_ciphertext = extensions.pgp_sym_encrypt(
  credential_value,
  private.credentials_encryption_key(),
  'cipher-algo=aes256,compress-algo=1'
);

ALTER TABLE public.system_credentials_store
  ALTER COLUMN credential_ciphertext SET NOT NULL,
  DROP COLUMN credential_value;

ALTER TABLE public.system_credentials_store
  DROP CONSTRAINT IF EXISTS system_credentials_company_system_key;
ALTER TABLE public.system_credentials_store
  ADD CONSTRAINT system_credentials_store_company_system_key
  UNIQUE NULLS NOT DISTINCT (company_db, system_name, credential_key);

CREATE OR REPLACE FUNCTION private.decrypt_system_credential(ciphertext bytea)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT extensions.pgp_sym_decrypt(ciphertext, private.credentials_encryption_key());
$$;

CREATE VIEW public.system_credentials
WITH (security_invoker = true)
AS
SELECT
  id,
  system_name,
  credential_key,
  private.decrypt_system_credential(credential_ciphertext) AS credential_value,
  created_at,
  updated_at,
  company_db
FROM public.system_credentials_store;

CREATE OR REPLACE FUNCTION public.cascade_delete_company_credentials()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.system_credentials_store
  WHERE company_db = OLD.company_db;

  INSERT INTO public.audit_log (action, entity_type, entity_id, details)
  VALUES (
    'cascade_delete',
    'system_credentials',
    OLD.company_db,
    jsonb_build_object('reason', 'company_deleted', 'company_name', OLD.display_name)
  );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_system_credential(
  _system_name text,
  _credential_key text,
  _credential_value text,
  _company_db text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.system_credentials_store (
    system_name, credential_key, credential_ciphertext, company_db
  ) VALUES (
    _system_name,
    _credential_key,
    extensions.pgp_sym_encrypt(
      _credential_value,
      private.credentials_encryption_key(),
      'cipher-algo=aes256,compress-algo=1'
    ),
    _company_db
  )
  ON CONFLICT (company_db, system_name, credential_key)
  DO UPDATE SET
    credential_ciphertext = EXCLUDED.credential_ciphertext,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_system_credentials(
  _system_name text,
  _company_db text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.system_credentials_store
  WHERE system_name = _system_name
    AND company_db IS NOT DISTINCT FROM _company_db;
$$;

REVOKE ALL ON public.system_credentials FROM PUBLIC, anon;
GRANT SELECT ON public.system_credentials TO authenticated, service_role;
GRANT SELECT ON public.system_credentials_store TO authenticated;
GRANT ALL ON public.system_credentials_store TO service_role;

REVOKE ALL ON FUNCTION private.credentials_encryption_key() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.decrypt_system_credential(bytea) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.decrypt_system_credential(bytea) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.upsert_system_credential(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_system_credentials(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_system_credential(text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_system_credentials(text, text) TO service_role;
