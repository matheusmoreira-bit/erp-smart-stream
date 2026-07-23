#!/usr/bin/env bash
# ============================================================================
# qa-seed.sh — Popular banco QA local a partir do dump S3 (db-backup-s3).
#
# Requisitos: awscli, gzip, psql (containerizado ou local).
# Uso:  scripts/qa-seed.sh              # usa SEED_S3_PREFIX do .env
#       scripts/qa-seed.sh 2026-07-22   # data específica
#
# AVISO: importa dados PRODUTIVOS SEM MASCARAMENTO. Mantenha local.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
source "$ROOT_DIR/docker/.env"

DATE_ARG="${1:-}"
PREFIX="${DATE_ARG:+daily/$DATE_ARG}"
PREFIX="${PREFIX:-$SEED_S3_PREFIX}"
BUCKET="${SEED_S3_BUCKET:?SEED_S3_BUCKET não definido em docker/.env}"

WORKDIR="$(mktemp -d -t erp-qa-seed-XXXXXX)"
trap 'rm -rf "$WORKDIR"' EXIT

echo ">> Baixando manifest de s3://$BUCKET/$PREFIX/"
aws s3 cp "s3://$BUCKET/$PREFIX/manifest.json" "$WORKDIR/manifest.json"

TABLES=$(jq -r '.tables[].name' "$WORKDIR/manifest.json")

echo ">> Aplicando migrations do repositório (schema real de prod)"
for f in "$ROOT_DIR"/supabase/migrations/*.sql; do
  [ -f "$f" ] || continue
  echo "   - $(basename "$f")"
  PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h 127.0.0.1 -p 54322 -U postgres -d postgres \
    -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
done

echo ">> Desabilitando triggers de audit_trail durante o seed"
PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
  -c "SELECT set_config('session_replication_role','replica', false);" >/dev/null

for table in $TABLES; do
  file="$table.jsonl.gz"
  echo ">> Restaurando $table"
  aws s3 cp "s3://$BUCKET/$PREFIX/$file" "$WORKDIR/$file" --quiet
  # Cada linha é um JSON — expande para colunas com jsonb_populate_record.
  gunzip -c "$WORKDIR/$file" | PGPASSWORD="$POSTGRES_PASSWORD" psql \
    -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
    -c "TRUNCATE public.$table CASCADE;" \
    -c "CREATE TEMP TABLE _raw (j jsonb);" \
    -c "COPY _raw FROM STDIN;" \
    -c "INSERT INTO public.$table SELECT (jsonb_populate_record(NULL::public.$table, j)).* FROM _raw;" \
    >/dev/null
done

echo ">> Reativando triggers e limpando cron jobs (evita rajada em localhost)"
PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 54322 -U postgres -d postgres <<'SQL'
SELECT set_config('session_replication_role','origin', false);
-- Cron jobs de prod chamam URLs supabase.co com secrets do vault que não
-- existem aqui — desligamos para evitar erros contínuos no log.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job;
  END IF;
END $$;
SQL

echo ">> Seed concluído. Studio: http://localhost:54323  |  API: http://localhost:8000"
