#!/usr/bin/env bash
set -Eeuo pipefail

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${JWT_SECRET:?JWT_SECRET is required}"
CREDENTIALS_ENCRYPTION_KEY="${CREDENTIALS_ENCRYPTION_KEY:-$JWT_SECRET}"

psql --username postgres --dbname postgres \
  --set=db_password="$POSTGRES_PASSWORD" \
  --set=jwt_secret="$JWT_SECRET" \
  --set=credentials_encryption_key="$CREDENTIALS_ENCRYPTION_KEY" <<'SQL'
SELECT format('ALTER ROLE %I PASSWORD %L', rolname, :'db_password')
FROM pg_roles
WHERE rolname IN (
  'authenticator',
  'supabase_admin',
  'supabase_auth_admin',
  'supabase_storage_admin'
) \gexec

SELECT format(
  'ALTER DATABASE postgres SET "app.settings.jwt_secret" TO %L',
  :'jwt_secret'
) \gexec

SELECT format(
  'ALTER DATABASE postgres SET "app.settings.credentials_encryption_key" TO %L',
  :'credentials_encryption_key'
) \gexec

GRANT CONNECT, CREATE, TEMPORARY ON DATABASE postgres
TO supabase_admin, supabase_auth_admin, supabase_storage_admin;
SQL
