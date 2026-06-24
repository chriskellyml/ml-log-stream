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

# Build a JSON array string from comma-separated values.
json_array() {
  local items="$1"
  local json="["
  local first=true
  local item
  IFS=',' read -ra parts <<<"$items"
  for item in "${parts[@]}"; do
    item="$(echo "$item" | xargs)"
    [[ -z "$item" ]] && continue
    if [[ "$first" == "true" ]]; then
      first=false
    else
      json+=","
    fi
    json+="\"${item//\"/\\\"}\""
  done
  json+="]"
  echo "$json"
}

# Build a JSON array for DAYS, treating bare integers as numbers and everything else as strings.
json_days() {
  local items="$1"
  local json="["
  local first=true
  local item
  IFS=',' read -ra parts <<<"$items"
  for item in "${parts[@]}"; do
    item="$(echo "$item" | xargs)"
    [[ -z "$item" ]] && continue
    if [[ "$first" == "true" ]]; then
      first=false
    else
      json+=","
    fi
    if [[ "$item" =~ ^[0-9]+$ ]]; then
      json+="$item"
    else
      json+="\"${item//\"/\\\"}\""
    fi
  done
  json+="]"
  echo "$json"
}

# Build the vars payload for /v1/eval.
VARS='{"DRY_RUN":false'
[[ -n "${DAYS:-}" ]] && VARS+=',"DAYS":'$(json_days "$DAYS")
[[ -n "${TYPES:-}" ]] && VARS+=',"TYPES":'$(json_array "$TYPES")
[[ -n "${PORTS:-}" ]] && VARS+=',"PORT_LIST":'$(json_array "$PORTS")
[[ -n "${HOSTS:-}" ]] && VARS+=',"HOST_LIST":'$(json_array "$HOSTS")
[[ -n "${HOSTS_EXCLUDE:-}" ]] && VARS+=',"HOST_EXCLUDE_LIST":'$(json_array "$HOSTS_EXCLUDE")
VARS+='}'

mkdir -p "$DOWNLOADS_DIR"

BASE_URL="${ML_PROTOCOL}://${ML_HOST}:${ML_PORT}"

echo "Requesting log export from ${BASE_URL}..."
echo "  vars: $VARS"
RESPONSE=$(curl -sS --anyauth --user "${ML_USER}:${ML_PASS}" \
  -X POST \
  -H "Content-type: application/x-www-form-urlencoded" \
  -H "Accept: text/plain" \
  --data-urlencode "xquery@qconsole/extract-logs.xqy" \
  --data-urlencode "vars=$VARS" \
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
