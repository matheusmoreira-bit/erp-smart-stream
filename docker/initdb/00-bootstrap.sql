-- ============================================================================
-- Bootstrap do Postgres local (executado uma única vez, no primeiro boot).
-- Cria roles esperadas pelo Supabase self-hosted, extensões e schemas.
-- Após isso, `make qa-migrate` aplica todas as migrations do repositório em
-- ordem, o que reproduz o schema real de produção.
-- ============================================================================

-- Roles obrigatórias do Supabase stack
DO $$
BEGIN
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

-- Schemas de sistema esperados por Auth/Storage/Realtime
CREATE SCHEMA IF NOT EXISTS auth        AUTHORIZATION supabase_auth_admin;
CREATE SCHEMA IF NOT EXISTS storage     AUTHORIZATION supabase_storage_admin;
CREATE SCHEMA IF NOT EXISTS realtime    AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS extensions  AUTHORIZATION supabase_admin;
CREATE SCHEMA IF NOT EXISTS graphql_public;
CREATE SCHEMA IF NOT EXISTS pgmq        AUTHORIZATION supabase_admin;

-- Extensões usadas pelo app
CREATE EXTENSION IF NOT EXISTS pgcrypto           SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm            SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_cron            SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA extensions;
-- pg_net e pgmq são opcionais em QA; cron jobs devem ser criados MASCARADOS
-- (endereços http localhost / desabilitados) via seed pós-restore.

-- app.settings.jwt_secret é lido por funções que checam JWT no banco
ALTER DATABASE postgres SET "app.settings.jwt_secret" TO 'super-long-jwt-secret-change-me-please-32chars-min';
