#!/usr/bin/env bash
# Gera ANON_KEY e SERVICE_ROLE_KEY assinados com JWT_SECRET do docker/.env.
# Requisitos: python3 + PyJWT (pip install pyjwt).
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "$ROOT_DIR/docker/.env"

python3 - <<PY
import jwt, time, os
secret = "${JWT_SECRET}"
now = int(time.time())
exp = now + 60*60*24*365*10  # 10 anos
def mint(role):
    return jwt.encode({"role": role, "iss": "supabase", "iat": now, "exp": exp}, secret, algorithm="HS256")
print("ANON_KEY=" + mint("anon"))
print("SERVICE_ROLE_KEY=" + mint("service_role"))
PY
