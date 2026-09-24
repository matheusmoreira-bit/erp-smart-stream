-- F06 (etapa 1): chave interna fora do schema público + leitura decifrada só para o backend.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.credential_keyring (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  material text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.credential_keyring FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO private.credential_keyring (id, material)
VALUES (1, encode(extensions.gen_random_bytes(48), 'base64'))
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.is_secret_credential_key(_key text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(_key, '') ~* '(password|secret|token|private_key|api_key|app_key|aes_key|hmac_key|client_key)'
$$;

CREATE OR REPLACE FUNCTION private.cred_material() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = private AS $$
  SELECT material FROM private.credential_keyring WHERE id = 1
$$;
REVOKE ALL ON FUNCTION private.cred_material() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reveal_system_credential(_stored text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, private, extensions AS $$
DECLARE r text;
BEGIN
  IF _stored IS NULL OR _stored NOT LIKE 'enc:v1:%' THEN RETURN _stored; END IF;
  r := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  IF session_user NOT IN ('postgres', 'supabase_admin') AND r <> 'service_role' THEN
    RETURN NULL;
  END IF;
  RETURN extensions.pgp_sym_decrypt(decode(substr(_stored, 8), 'base64'), private.cred_material());
END $$;
REVOKE ALL ON FUNCTION public.reveal_system_credential(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reveal_system_credential(text) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.system_credentials_v WITH (security_invoker = true) AS
SELECT id, system_name, credential_key,
       public.reveal_system_credential(credential_value) AS credential_value,
       company_db, created_at, updated_at
FROM public.system_credentials;
REVOKE ALL ON public.system_credentials_v FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.system_credentials_v TO service_role;