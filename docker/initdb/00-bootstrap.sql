-- ============================================================================
-- Bootstrap do Postgres local (executado uma única vez, no primeiro boot).
-- Cria roles esperadas pelo Supabase self-hosted, extensões e schemas.
-- Após isso, `make qa-migrate` aplica todas as migrations do repositório em
-- ordem, o que reproduz o schema real de produção.
-- ============================================================================

-- Roles obrigatórias do Supabase stack
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres LOGIN SUPERUSER PASSWORD 'change-me-qa-local';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD 'change-me-qa-local';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin LOGIN SUPERUSER PASSWORD 'change-me-qa-local';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE ROLE supabase_auth_admin LOGIN CREATEROLE PASSWORD 'change-me-qa-local';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    CREATE ROLE supabase_storage_admin LOGIN CREATEROLE PASSWORD 'change-me-qa-local';
  END IF;
END $$;

GRANT anon, authenticated, service_role TO authenticator;
GRANT anon, authenticated, service_role TO postgres;

-- Schemas de sistema esperados por Auth/Storage/Realtime
CREATE SCHEMA IF NOT EXISTS auth        AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS storage     AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA IF NOT EXISTS realtime    AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS _realtime   AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS extensions  AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE SCHEMA IF NOT EXISTS pgmq        AUTHORIZATION supabase_admin;
GRANT USAGE, CREATE ON SCHEMA public TO supabase_auth_admin, supabase_admin, postgres;
ALTER ROLE supabase_auth_admin SET search_path = auth, public, extensions;

-- Extensões usadas pelo app
CREATE EXTENSION IF NOT EXISTS pgcrypto           SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm            SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_cron            SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgsodium;
-- pg_net e pgmq são opcionais em QA; cron jobs devem ser criados MASCARADOS
-- (endereços http localhost / desabilitados) via seed pós-restore.

-- A stack standalone não sobe o Storage API, mas várias migrations criam
-- buckets/policies e consultam metadados de storage.objects. Estas tabelas
-- mínimas mantêm o schema compatível sem expor um serviço de arquivos.
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  version text,
  path_tokens text[],
  metadata jsonb DEFAULT '{}'::jsonb,
  user_metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now()
);

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;
ALTER TABLE storage.objects OWNER TO supabase_storage_admin;
GRANT ALL ON storage.buckets, storage.objects TO supabase_storage_admin, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.buckets, storage.objects TO authenticated, anon;

CREATE PUBLICATION supabase_realtime;

-- app.settings.jwt_secret é lido por funções que checam JWT no banco
ALTER DATABASE postgres SET "app.settings.jwt_secret" TO 'super-long-jwt-secret-change-me-please-32chars-min';
