#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CLOUD_ENV_FILE:-$ROOT_DIR/docker/.env.cloud}"
BASE_COMPOSE="$ROOT_DIR/docker/docker-compose.yml"
CLOUD_COMPOSE="$ROOT_DIR/docker/docker-compose.cloud.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'ERROR: cloud environment file not found: %s\n' "$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

compose=(docker compose -f "$BASE_COMPOSE" -f "$CLOUD_COMPOSE" --env-file "$ENV_FILE")

psql_cloud() {
  "${compose[@]}" exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

record_migration() {
  local name="$1"
  local checksum="$2"
  local status="$3"
  psql_cloud -q \
    -v migration_name="$name" \
    -v migration_checksum="$checksum" \
    -v migration_status="$status" <<'SQL'
INSERT INTO erp_deploy.schema_migrations (name, checksum, status)
VALUES (:'migration_name', :'migration_checksum', :'migration_status')
ON CONFLICT (name) DO UPDATE
SET checksum = EXCLUDED.checksum,
    status = EXCLUDED.status,
    applied_at = now();
SQL
}

should_skip_data_migration() {
  case "$1" in
    20260623135036_e9a2662c-5a59-406f-a1ab-baec75414b59.sql|\
    20260706200412_08369139-24b2-4d23-aaef-9d251a34afa1.sql|\
    20260707180916_10026397-9ec7-4cd0-a3d9-01f681efbf56.sql|\
    20260707184710_b3eb2b74-c7cc-4649-a400-634bb2c6b04c.sql|\
    20260708021248_9df6d6d2-8dad-4d88-ab69-122681999421.sql|\
    20260708134301_39f697ba-1fab-4595-8d1c-6e2a909c9ece.sql|\
    20260708135705_3e045c2a-1c33-4506-a17f-3a4b5eb97af0.sql|\
    20260714182342_6f473e5d-4c2e-4591-bb26-63ece9b14971.sql|\
    20260716142159_1da85f58-cbc6-4530-b236-5e18d6d68a03.sql|\
    20260716142244_90e277b6-4923-4960-884f-0998a06b7e25.sql|\
    20260716142520_c8234f28-d1d6-487c-9222-70007e5d6d6d.sql|\
    20260716142603_7693f9e8-c419-4d9a-8da4-6d131a30cb57.sql|\
    20260716143759_4487a343-7bee-437c-b220-67022ab930c1.sql|\
    20260723140628_804fe8da-a7fc-4e13-9667-d26d26f54d02.sql|\
    20260723140717_63e9746f-7283-4cda-a9fe-3d68cd03a7b6.sql|\
    20260723140820_b40fe996-408a-4587-b0f9-2a48bbe7c9dd.sql|\
    20260723141317_794b3996-eb9d-47d9-80e5-9bce10948a1f.sql|\
    20260731121601_cf25206d-3d61-404e-af30-102781ad37f5.sql|\
    20260803205206_8440f913-8423-4434-a73e-5831eb452928.sql|\
    20260805161529_d33b9da9-b578-472a-a400-16941ff1f97e.sql|\
    20260806125105_c6f994ac-6230-4399-93a0-f2fe9dabd075.sql|\
    20260806135638_cc2f3edc-ffa6-4d24-9e95-9fb1f438225f.sql|\
    20260806190403_f264b6d5-a7c3-4a08-b2fe-baa26d51b470.sql)
      return 0
      ;;
  esac
  return 1
}

is_sanitized_secret_migration() {
  [[ "$1" == "20260511202322_cd70f45c-dbb2-4116-9e68-ca3cc4a1a489.sql" ]]
}

printf 'Waiting for PostgreSQL and Auth...\n'
for _ in {1..90}; do
  if psql_cloud -tAc "select to_regclass('auth.users') is not null" 2>/dev/null | grep -q t; then
    break
  fi
  sleep 2
done

if ! psql_cloud -tAc "select to_regclass('auth.users') is not null" | grep -q t; then
  printf 'ERROR: auth.users was not created in time.\n' >&2
  exit 1
fi

psql_cloud -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS erp_deploy;
CREATE TABLE IF NOT EXISTS erp_deploy.schema_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied', 'skipped_data')),
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON SCHEMA erp_deploy FROM PUBLIC, anon, authenticated;
SQL

printf 'Applying cloud schema migrations...\n'
for file in "$ROOT_DIR"/supabase/migrations/*.sql; do
  [[ -f "$file" ]] || continue
  name="$(basename "$file")"
  if command -v sha256sum >/dev/null 2>&1; then
    checksum="$(sha256sum "$file" | awk '{print $1}')"
  else
    checksum="$(shasum -a 256 "$file" | awk '{print $1}')"
  fi
  existing="$(psql_cloud -qAt -v migration_name="$name" <<'SQL'
SELECT checksum
FROM erp_deploy.schema_migrations
WHERE name = :'migration_name';
SQL
)"

  if [[ -n "$existing" ]]; then
    if [[ "$existing" != "$checksum" ]]; then
      if is_sanitized_secret_migration "$name"; then
        printf '  accept sanitized credential migration: %s\n' "$name"
        record_migration "$name" "$checksum" applied
        continue
      fi
      printf 'ERROR: applied migration changed: %s\n' "$name" >&2
      exit 1
    fi
    continue
  fi

  if should_skip_data_migration "$name"; then
    printf '  skip data-only: %s\n' "$name"
    record_migration "$name" "$checksum" skipped_data
    continue
  fi

  printf '  apply: %s\n' "$name"
  if [[ "$name" == "20260708142407_23ede603-e116-4bdd-8357-828cfe4118a6.sql" ]]; then
    sed -n '/CREATE OR REPLACE FUNCTION public.reassign_approval_rule_safe/,$p' "$file" \
      | psql_cloud --single-transaction -q
  else
    psql_cloud --single-transaction -q < "$file"
  fi
  record_migration "$name" "$checksum" applied
done

psql_cloud -q <<'SQL'
DO $$
DECLARE
  job record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR job IN
      SELECT jobid
      FROM cron.job
      WHERE command ILIKE '%supabase.co%'
         OR command ILIKE '%_run_pagcorp_attachment_backfill%'
    LOOP
      PERFORM cron.unschedule(job.jobid);
    END LOOP;
  END IF;
END $$;
SQL

printf 'Cloud migrations completed. External cron jobs remain disabled.\n'
