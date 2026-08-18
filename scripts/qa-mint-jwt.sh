#!/usr/bin/env bash
# Gera ANON_KEY e SERVICE_ROLE_KEY assinados com JWT_SECRET.
# Use JWT_ENV_FILE=docker/.env.cloud para o perfil cloud.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${JWT_ENV_FILE:-$ROOT_DIR/docker/.env}"
# shellcheck disable=SC1091
source "$ENV_FILE"

python3 - "$JWT_SECRET" <<'PY'
import base64
import hashlib
import hmac
import json
import sys
import time

secret = sys.argv[1].encode()
now = int(time.time())
exp = now + 60*60*24*365*10  # 10 anos

def encode(value):
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

def mint(role):
    header = encode({"alg": "HS256", "typ": "JWT"})
    payload = encode({"role": role, "iss": "supabase", "iat": now, "exp": exp})
    message = f"{header}.{payload}".encode()
    signature = base64.urlsafe_b64encode(
        hmac.new(secret, message, hashlib.sha256).digest()
    ).rstrip(b"=").decode()
    return f"{header}.{payload}.{signature}"

print("ANON_KEY=" + mint("anon"))
print("SERVICE_ROLE_KEY=" + mint("service_role"))
PY
