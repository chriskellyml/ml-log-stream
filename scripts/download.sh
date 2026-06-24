#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env.local ]]; then
  source .env.local
fi

ML_HOST="${ML_HOST:-localhost}"
ML_PORT="${ML_PORT:-8000}"
ML_PROTOCOL="${ML_PROTOCOL:-http}"
DOWNLOADS_DIR="${DOWNLOADS_DIR:-$HOME/Downloads}"

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

mkdir -p "$DOWNLOADS_DIR"

BASE_URL="${ML_PROTOCOL}://${ML_HOST}:${ML_PORT}"

echo "Requesting log export from ${BASE_URL}..."
RESPONSE=$(curl -sS --anyauth --user "${ML_USER}:${ML_PASS}" \
  -X POST \
  -H "Content-type: application/x-www-form-urlencoded" \
  -H "Accept: text/plain" \
  --data-urlencode "xquery@qconsole/extract-logs.xqy" \
  --data-urlencode "vars={\"DRY_RUN\":false}" \
  "${BASE_URL}/v1/eval?database=Documents")

URI=$(echo "$RESPONSE" | grep -oE '/export/[^ ]+\.zip' | head -n1 || true)

if [[ -z "$URI" ]]; then
  echo "Error: could not determine export URI. Server response:" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

FILENAME=$(basename "$URI")
OUTFILE="$DOWNLOADS_DIR/$FILENAME"

echo "Downloading ${URI}..."
curl -sS --anyauth --user "${ML_USER}:${ML_PASS}" \
  -G \
  --data-urlencode "uri=$URI" \
  -o "$OUTFILE" \
  "${BASE_URL}/v1/documents"

echo "Saved: $OUTFILE"
