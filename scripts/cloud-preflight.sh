#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CLOUD_ENV_FILE:-$ROOT_DIR/docker/.env.cloud}"
BASE_COMPOSE="$ROOT_DIR/docker/docker-compose.yml"
CLOUD_COMPOSE="$ROOT_DIR/docker/docker-compose.cloud.yml"

failures=0

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  failures=$((failures + 1))
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

require_value() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" || "$value" == *change-me* || "$value" == *PLACEHOLDER* ]]; then
    fail "$name is missing or still contains a placeholder"
  fi
}

require_min_length() {
  local name="$1"
  local minimum="$2"
  local value="${!name:-}"
  if (( ${#value} < minimum )); then
    fail "$name must contain at least $minimum characters"
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  printf 'ERROR: %s not found. Copy docker/.env.cloud.example first.\n' "$ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

require_command docker
require_command python3
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"

for name in CLOUD_PROVIDER APP_DOMAIN APP_PUBLIC_URL SUPABASE_PUBLIC_URL TLS_EMAIL \
  POSTGRES_PASSWORD JWT_SECRET SECRET_KEY_BASE CREDENTIALS_ENCRYPTION_KEY ANON_KEY SERVICE_ROLE_KEY CRON_SECRET; do
  require_value "$name"
done

require_min_length POSTGRES_PASSWORD 24
require_min_length JWT_SECRET 32
require_min_length SECRET_KEY_BASE 64
require_min_length CREDENTIALS_ENCRYPTION_KEY 32
require_min_length CRON_SECRET 32

if [[ "${ANON_KEY:-}" != *.*.* ]]; then
  fail "ANON_KEY is not a JWT"
fi
if [[ "${SERVICE_ROLE_KEY:-}" != *.*.* ]]; then
  fail "SERVICE_ROLE_KEY is not a JWT"
fi

if ! python3 - "$JWT_SECRET" "$ANON_KEY" "$SERVICE_ROLE_KEY" <<'PY'
import base64
import binascii
import hashlib
import hmac
import json
import sys
import time

secret, anon_key, service_key = sys.argv[1:]

def decode(value):
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))

def valid(token, expected_role):
    try:
        header, payload, signature = token.split(".")
        message = f"{header}.{payload}".encode()
        expected = hmac.new(secret.encode(), message, hashlib.sha256).digest()
        claims = json.loads(decode(payload))
        return (
            hmac.compare_digest(expected, decode(signature))
            and claims.get("role") == expected_role
            and claims.get("iss") == "supabase"
            and claims.get("exp", 0) > time.time()
        )
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error):
        return False

if not valid(anon_key, "anon") or not valid(service_key, "service_role"):
    raise SystemExit(1)
PY
then
  fail "ANON_KEY or SERVICE_ROLE_KEY has an invalid signature, role or expiration"
fi

case "${CLOUD_PROVIDER:-}" in
  gcp|aws) ;;
  *) fail "CLOUD_PROVIDER must be gcp or aws" ;;
esac

if [[ "${APP_PUBLIC_URL:-}" != "https://${APP_DOMAIN:-}" ]]; then
  fail "APP_PUBLIC_URL must be exactly https://APP_DOMAIN"
fi

if [[ "${SUPABASE_PUBLIC_URL:-}" != "${APP_PUBLIC_URL:-}" ]]; then
  fail "SUPABASE_PUBLIC_URL and APP_PUBLIC_URL must use the same origin"
fi

if [[ "${VITE_ENABLE_FAKE_AUTH:-false}" != "false" ]]; then
  fail "VITE_ENABLE_FAKE_AUTH must be false in cloud deployments"
fi

if [[ "${VITE_SUPABASE_PROJECT_ID:-}" == "standalone-local" ]]; then
  fail "VITE_SUPABASE_PROJECT_ID cannot be standalone-local"
fi

if [[ "${GOOGLE_AUTH_ENABLED:-false}" == "true" ]]; then
  require_value GOOGLE_CLIENT_ID
  require_value GOOGLE_CLIENT_SECRET
fi

if [[ "${INTEGRATIONS_MODE:-disabled}" == "enabled" ]]; then
  require_value SAP_DEFAULT_BASE_URL
  require_value SAP_MIDDLEWARE_SECRET
  require_value SAP_CRED_ENC_KEY
  require_min_length SAP_MIDDLEWARE_SECRET 32
  require_min_length SAP_CRED_ENC_KEY 32
  if [[ "${SAP_CONNECTIVITY_MODE:-public}" != "public" ]]; then
    fail "SAP_CONNECTIVITY_MODE must be public while no private VPN is used"
  fi
  if [[ "${SAP_DEFAULT_BASE_URL:-}" != https://* ]]; then
    fail "SAP_DEFAULT_BASE_URL must use HTTPS"
  fi
fi

case "${BACKUP_TARGET:-local}" in
  local) ;;
  s3)
    [[ "${BACKUP_BUCKET_URI:-}" == s3://* ]] || fail "BACKUP_BUCKET_URI must start with s3://"
    ;;
  gcs)
    [[ "${BACKUP_BUCKET_URI:-}" == gs://* ]] || fail "BACKUP_BUCKET_URI must start with gs://"
    ;;
  *) fail "BACKUP_TARGET must be local, s3 or gcs" ;;
esac

if command -v stat >/dev/null 2>&1; then
  permissions="$(stat -f '%Lp' "$ENV_FILE" 2>/dev/null || stat -c '%a' "$ENV_FILE" 2>/dev/null || true)"
  if [[ -n "$permissions" && "$permissions" != "600" ]]; then
    printf 'WARN: %s permissions are %s; use chmod 600.\n' "$ENV_FILE" "$permissions" >&2
  fi
fi

if (( failures > 0 )); then
  printf 'Preflight failed with %d error(s).\n' "$failures" >&2
  exit 1
fi

docker compose \
  -f "$BASE_COMPOSE" \
  -f "$CLOUD_COMPOSE" \
  --env-file "$ENV_FILE" \
  config --quiet

printf 'Cloud preflight passed for %s (%s).\n' "$APP_DOMAIN" "$CLOUD_PROVIDER"
