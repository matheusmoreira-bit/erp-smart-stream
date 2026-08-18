#!/usr/bin/env bash
# ============================================================================
# Seed standalone local: aplica migrations e injeta dados sintéticos.
# Nao baixa dump, nao usa S3 e nao toca na base de producao.
# ============================================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/docker/.env.standalone"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRO: $ENV_FILE nao encontrado" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

psql_local() {
  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" erp-standalone-db \
    psql -U postgres -d postgres \
    -v ON_ERROR_STOP=1 "$@"
}

psql_file() {
  psql_local -q < "$1"
}

migration_checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

record_migration() {
  psql_local -q -v migration_name="$1" -v migration_checksum="$2" -v migration_status="$3" <<'SQL'
INSERT INTO erp_deploy.standalone_migrations (name, checksum, status)
VALUES (:'migration_name', :'migration_checksum', :'migration_status')
ON CONFLICT (name) DO UPDATE
SET checksum = EXCLUDED.checksum,
    status = EXCLUDED.status,
    applied_at = now();
SQL
  MIGRATION_STATE="${MIGRATION_STATE:-}"$'\n'"$1|$2"
}

clear_local_cron_jobs() {
  psql_local -q >/dev/null <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
SQL
}

apply_standalone_migration() {
  local file="$1"
  local name checksum existing
  name="$(basename "$file")"
  checksum="$(migration_checksum "$file")"
  existing="$(printf '%s\n' "$MIGRATION_STATE" | awk -F'|' -v target="$name" '$1 == target { value = $2 } END { print value }')"

  if [[ -n "$existing" ]]; then
    if [[ "$existing" != "$checksum" ]]; then
      if [[ "$name" == "20260511202322_cd70f45c-dbb2-4116-9e68-ca3cc4a1a489.sql" ]]; then
        echo "   - $name (aceita sanitizacao de segredo)"
        record_migration "$name" "$checksum" applied
        return 0
      fi
      echo "ERRO: migration local aplicada foi alterada: $name" >&2
      return 1
    fi
    return 0
  fi

  case "$name" in
    # Migrations de reconciliacao manual de despesas reais. Em standalone,
    # esses UUIDs nao existem e tambem nao devem virar dados locais.
    20260623135036_e9a2662c-5a59-406f-a1ab-baec75414b59.sql|\
    20260706200412_08369139-24b2-4d23-aaef-9d251a34afa1.sql|\
    20260707180916_10026397-9ec7-4cd0-a3d9-01f681efbf56.sql|\
    20260707184710_b3eb2b74-c7cc-4649-a400-634bb2c6b04c.sql|\
    20260708134301_39f697ba-1fab-4595-8d1c-6e2a909c9ece.sql|\
    20260708135705_3e045c2a-1c33-4506-a17f-3a4b5eb97af0.sql|\
    20260714182342_6f473e5d-4c2e-4591-bb26-63ece9b14971.sql|\
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
      echo "   - $name (skip standalone: reconciliacao de dado produtivo)"
      record_migration "$name" "$checksum" skipped_data
      return 0
      ;;
    20260708142407_23ede603-e116-4bdd-8357-828cfe4118a6.sql)
      echo "   - $name (partial standalone: funcao sem reconciliacao produtiva)"
      sed -n '/CREATE OR REPLACE FUNCTION public.reassign_approval_rule_safe/,$p' "$file" | psql_local -q >/dev/null
      clear_local_cron_jobs
      record_migration "$name" "$checksum" applied
      return 0
      ;;
  esac

  echo "   - $name"
  psql_file "$file" >/dev/null
  clear_local_cron_jobs
  record_migration "$name" "$checksum" applied
}

echo ">> Aguardando Postgres local"
for _ in {1..60}; do
  if docker exec erp-standalone-db pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo ">> Aguardando Auth local criar schema"
for _ in {1..60}; do
  if [[ "$(psql_local -tAc "select to_regclass('auth.users') is not null")" == "t" ]]; then
    break
  fi
  sleep 1
done
if [[ "$(psql_local -tAc "select to_regclass('auth.users') is not null")" != "t" ]]; then
  echo "ERRO: Auth local nao criou auth.users a tempo" >&2
  exit 1
fi

psql_local -q <<'SQL'
CREATE SCHEMA IF NOT EXISTS erp_deploy;
CREATE TABLE IF NOT EXISTS erp_deploy.standalone_migrations (
  name text PRIMARY KEY,
  checksum text NOT NULL,
  status text NOT NULL CHECK (status IN ('applied', 'skipped_data')),
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON SCHEMA erp_deploy FROM PUBLIC, anon, authenticated;
SQL
MIGRATION_STATE="$(psql_local -qAt -F '|' -c 'SELECT name, checksum FROM erp_deploy.standalone_migrations')"

# Volumes criados antes do ledger já possuem todo o schema até 2026-08-14.
# A coluna abaixo é o marcador da última migration desse baseline.
if [[ "$(psql_local -tAc "select count(*) from erp_deploy.standalone_migrations")" == "0" ]] &&
   [[ "$(psql_local -tAc "select exists(select 1 from information_schema.columns where table_schema='public' and table_name='nf_entrada_imports' and column_name='sap_matched_po_doc_num')")" == "t" ]]; then
  echo ">> Registrando baseline do volume standalone existente"
  for f in "$ROOT_DIR"/supabase/migrations/*.sql; do
    name="$(basename "$f")"
    [[ "$name" < "20260818173000" ]] || continue
    record_migration "$name" "$(migration_checksum "$f")" applied
  done
fi

echo ">> Aplicando migrations locais"
for f in "$ROOT_DIR"/supabase/migrations/*.sql; do
  [[ -f "$f" ]] || continue
  apply_standalone_migration "$f"
done

echo ">> Desligando cron jobs locais"
psql_local -q <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
SQL

echo ">> Criando/atualizando usuario Auth local"
psql_local -q -v fake_email="$VITE_FAKE_AUTH_EMAIL" <<'SQL'
UPDATE auth.users
   SET aud = 'authenticated',
       role = 'authenticated',
       email_confirmed_at = COALESCE(email_confirmed_at, now()),
       updated_at = now()
 WHERE lower(email) = lower(:'fake_email')
   AND (COALESCE(aud, '') <> 'authenticated'
        OR COALESCE(role, '') <> 'authenticated'
        OR email_confirmed_at IS NULL);
SQL
node "$ROOT_DIR/scripts/standalone-upsert-user.mjs"

echo ">> Aplicando seed sintetico"
psql_file "$ROOT_DIR/supabase/seed/standalone.sql"

echo ">> Standalone pronto"
echo "   App:    http://127.0.0.1:8080"
echo "   API:    http://127.0.0.1:8000"
echo "   DB:     127.0.0.1:54322"
