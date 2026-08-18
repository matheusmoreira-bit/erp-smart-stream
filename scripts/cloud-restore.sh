#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CLOUD_ENV_FILE:-$ROOT_DIR/docker/.env.cloud}"
SNAPSHOT="${CLOUD_RESTORE_FROM:-${1:-}}"
BASE_COMPOSE="$ROOT_DIR/docker/docker-compose.yml"
CLOUD_COMPOSE="$ROOT_DIR/docker/docker-compose.cloud.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'ERROR: cloud environment file not found: %s\n' "$ENV_FILE" >&2
  exit 1
fi

if [[ -z "$SNAPSHOT" || ! -d "$SNAPSHOT" ]]; then
  printf 'ERROR: set CLOUD_RESTORE_FROM to a backup timestamp directory.\n' >&2
  exit 1
fi

if [[ "${CLOUD_RESTORE_CONFIRM:-}" != "restore-erp-flow" ]]; then
  printf 'ERROR: restore replaces the current database and Storage files.\n' >&2
  printf 'Set CLOUD_RESTORE_CONFIRM=restore-erp-flow to continue.\n' >&2
  exit 1
fi

for file in postgres.dump storage.tar.gz SHA256SUMS; do
  if [[ ! -f "$SNAPSHOT/$file" ]]; then
    printf 'ERROR: backup artifact not found: %s\n' "$SNAPSHOT/$file" >&2
    exit 1
  fi
done

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$SNAPSHOT" && sha256sum --check SHA256SUMS)
else
  (cd "$SNAPSHOT" && shasum -a 256 --check SHA256SUMS)
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

compose=(docker compose -f "$BASE_COMPOSE" -f "$CLOUD_COMPOSE" --env-file "$ENV_FILE")
app_services=(gateway web kong functions realtime storage auth rest)
restore_id="erp-flow-restore-$$"
list_file="$(mktemp)"
container_dump="/tmp/$restore_id.dump"
container_list="/tmp/$restore_id.list"

cleanup() {
  rm -f "$list_file"
  "${compose[@]}" exec -T db rm -f "$container_dump" "$container_list" >/dev/null 2>&1 || true
}
trap cleanup EXIT

printf 'Stopping application services...\n'
"${compose[@]}" stop "${app_services[@]}"

required_roles="$("${compose[@]}" exec -T db psql -U postgres -d postgres -qAt <<'SQL'
SELECT count(*)
FROM pg_roles
WHERE rolname IN (
  'anon', 'authenticated', 'service_role', 'authenticator',
  'supabase_auth_admin', 'supabase_storage_admin'
);
SQL
)"
if [[ "$required_roles" != "6" ]]; then
  printf 'ERROR: target database is not bootstrapped with the required Supabase roles.\n' >&2
  exit 1
fi

if ! "${compose[@]}" exec -T db psql -U postgres -d postgres -qAt <<'SQL' | grep -qx '2'; then
SELECT count(*) FROM pg_extension WHERE extname IN ('pgcrypto', 'pg_trgm');
SQL
  printf 'ERROR: target database is missing pgcrypto or pg_trgm.\n' >&2
  exit 1
fi

"${compose[@]}" exec -T db pg_restore --list < "$SNAPSHOT/postgres.dump" \
  | sed -E '/SCHEMA - public|COMMENT - SCHEMA public/s/^/;/' > "$list_file"
"${compose[@]}" cp "$SNAPSHOT/postgres.dump" "db:$container_dump"
"${compose[@]}" cp "$list_file" "db:$container_list"

printf 'Restoring PostgreSQL schemas and data...\n'
"${compose[@]}" exec -T db pg_restore \
  -U postgres -d postgres \
  --clean --if-exists --exit-on-error \
  --use-list="$container_list" "$container_dump"

printf 'Restoring Storage files...\n'
"${compose[@]}" start storage
"${compose[@]}" exec -T storage sh -c \
  'find /var/lib/storage -mindepth 1 -depth -delete && tar -xzf - -C /var/lib/storage' \
  < "$SNAPSHOT/storage.tar.gz"
"${compose[@]}" stop storage

printf 'Starting restored stack...\n'
"${compose[@]}" up -d --remove-orphans
"${compose[@]}" ps
printf 'Restore completed. Run make cloud-smoke after services become healthy.\n'
