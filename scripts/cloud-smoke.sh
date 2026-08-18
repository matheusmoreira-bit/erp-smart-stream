#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CLOUD_ENV_FILE:-$ROOT_DIR/docker/.env.cloud}"

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'ERROR: cloud environment file not found: %s\n' "$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

base_url="${APP_PUBLIC_URL:?APP_PUBLIC_URL is required}"
curl_args=(--fail --silent --show-error --max-time 15)

if [[ "${CLOUD_SMOKE_INSECURE:-false}" == "true" ]]; then
  curl_args+=(--insecure)
fi

check() {
  local name="$1"
  local url="$2"
  printf 'Checking %-12s %s\n' "$name" "$url"
  curl "${curl_args[@]}" "$url" >/dev/null
}

check gateway "$base_url/healthz"
check frontend "$base_url/"
check auth "$base_url/auth/v1/health"

printf 'Cloud smoke test passed.\n'
