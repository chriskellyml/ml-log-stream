#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env.local ]]; then
  source .env.local
fi

ML_HOST="${ML_HOST:-localhost}"
ML_PORT="${ML_PORT:-8000}"
ML_PROTOCOL="${ML_PROTOCOL:-http}"

missing=()
[[ -z "${ML_USER:-}" ]] && missing+=("ML_USER")
[[ -z "${ML_PASS:-}" ]] && missing+=("ML_PASS")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Error: required variables are not set: ${missing[*]}" >&2
  echo "You can add them to .env.local, e.g.:" >&2
  echo "  ML_USER=admin" >&2
  echo "  ML_PASS=admin" >&2
  exit 1
fi

curl -sS --anyauth --user "${ML_USER}:${ML_PASS}" \
  -X POST \
  -H "Content-type: application/x-www-form-urlencoded" \
  -H "Accept: multipart/mixed" \
  --data-urlencode "xquery@qconsole/extract-logs.xqy" \
  "${ML_PROTOCOL}://${ML_HOST}:${ML_PORT}/v1/eval?database=Documents"
