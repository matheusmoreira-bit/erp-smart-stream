#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CLOUD_ENV_FILE:-$ROOT_DIR/docker/.env.cloud}"
BACKUP_ROOT="${CLOUD_BACKUP_DIR:-$ROOT_DIR/docker/backups}"
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
timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
work_dir="$(mktemp -d "$BACKUP_ROOT/.${timestamp}.XXXXXX")"
final_dir="$BACKUP_ROOT/$timestamp"

cleanup() {
  rm -rf "$work_dir"
}
trap cleanup EXIT

printf 'Creating PostgreSQL backup...\n'
"${compose[@]}" exec -T db \
  pg_dump -U postgres -d postgres --format=custom \
  --schema=public --schema=auth --schema=storage --schema=erp_deploy \
  > "$work_dir/postgres.dump"

"${compose[@]}" exec -T db \
  pg_dumpall -U postgres --globals-only --no-role-passwords \
  > "$work_dir/globals.sql"

if "${compose[@]}" exec -T storage sh -c 'command -v tar >/dev/null' >/dev/null 2>&1; then
  printf 'Creating Storage backup...\n'
  "${compose[@]}" exec -T storage tar -czf - -C /var/lib/storage . \
    > "$work_dir/storage.tar.gz"
else
  printf 'WARN: storage image has no tar; rely on disk snapshots for Storage files.\n' >&2
fi

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$work_dir" && sha256sum ./* > SHA256SUMS)
else
  (cd "$work_dir" && shasum -a 256 ./* > SHA256SUMS)
fi

mv "$work_dir" "$final_dir"
trap - EXIT

case "${BACKUP_TARGET:-local}" in
  local)
    printf 'Backup retained locally. Configure disk snapshots or an object target.\n'
    ;;
  s3)
    command -v aws >/dev/null 2>&1 || {
      printf 'ERROR: aws CLI is required for BACKUP_TARGET=s3\n' >&2
      exit 1
    }
    aws s3 cp "$final_dir" "${BACKUP_BUCKET_URI%/}/$timestamp/" --recursive
    ;;
  gcs)
    command -v gcloud >/dev/null 2>&1 || {
      printf 'ERROR: gcloud CLI is required for BACKUP_TARGET=gcs\n' >&2
      exit 1
    }
    gcloud storage cp --recursive "$final_dir" "${BACKUP_BUCKET_URI%/}/"
    ;;
  *)
    printf 'ERROR: unsupported BACKUP_TARGET: %s\n' "${BACKUP_TARGET:-}" >&2
    exit 1
    ;;
esac

find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d \
  -mtime "+${BACKUP_RETENTION_DAYS:-7}" -exec rm -rf {} +

printf 'Backup completed: %s\n' "$final_dir"
