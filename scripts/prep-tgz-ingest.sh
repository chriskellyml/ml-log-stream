#!/bin/bash
#
# Prepare and ingest MarkLogic access log tgz exports into a named SQLite database.
#
# Usage:
#   bash scripts/prep-tgz-ingest.sh <data-dir> <db-name>
#
# Example:
#   bash scripts/prep-tgz-ingest.sh data/prod-2026-04-14 prod-2026-04-14.db
#
# The script:
#   1. Extracts each <hostname>_access_log.tgz from <data-dir>
#   2. Reorganises flat numbered log files into logdir/HOST/DATE/ structure
#   3. Runs jsonify-logs.sh + monster-log.sh to produce monster-log.csv
#   4. Imports into <db-name> via import-csv-to-sqlite.sh

set -euo pipefail

II() { echo "$(date +%Y-%m-%dT%H:%M:%S%z): <prep-ingest> $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

DATA_DIR="${1:-}"
DB_FILE="${2:-marklogic_logs.db}"

if [ -z "$DATA_DIR" ]; then
  echo "Usage: bash scripts/prep-tgz-ingest.sh <data-dir> [db-name]"
  exit 1
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "Error: data directory not found: $DATA_DIR"
  exit 1
fi

# Derive the reference date from the directory name (prod-YYYY-MM-DD)
DIRNAME="$(basename "$DATA_DIR")"
if [[ "$DIRNAME" =~ ([0-9]{4}-[0-9]{2}-[0-9]{2})$ ]]; then
  REF_DATE="${BASH_REMATCH[1]}"
else
  REF_DATE="$(date +%Y-%m-%d)"
  II "Warning: could not parse date from directory name, using today ($REF_DATE)"
fi
II "Reference date: $REF_DATE"

# Clean up from any previous run
II "Cleaning up previous logdir and CSV files..."
rm -rf logdir
rm -f monster-log.csv requests-log.csv

# Step 1: Extract and reorganise each tgz
for tgz in "$DATA_DIR"/*.tgz; do
  BASENAME="$(basename "$tgz")"
  # Extract hostname: nl-zwemarkplv702_access_log.tgz -> nl-zwemarkplv702
  HOST="${BASENAME%%_access_log.tgz}"
  if [ -z "$HOST" ] || [ "$HOST" = "$BASENAME" ]; then
    II "Warning: could not determine hostname from $BASENAME, skipping"
    continue
  fi

  II "Extracting $BASENAME (host=$HOST)..."
  TMPDIR="$(mktemp -d)"
  tar -xzf "$tgz" -C "$TMPDIR"

  # Reorganise: PORT_AccessLog_N.txt -> logdir/HOST/DATE/PORT_AccessLog.txt
  # _N suffix means N days before REF_DATE; no suffix = REF_DATE itself
  find "$TMPDIR" -type f -name '*AccessLog*.txt' | while IFS= read -r f; do
    FNAME="$(basename "$f")"
    # Match PORT_AccessLog_N.txt or PORT_AccessLog.txt
    if [[ "$FNAME" =~ ^([0-9]+)_AccessLog_([0-9]+)\.txt$ ]]; then
      PORT="${BASH_REMATCH[1]}"
      DAYS_AGO="${BASH_REMATCH[2]}"
    elif [[ "$FNAME" =~ ^([0-9]+)_AccessLog\.txt$ ]]; then
      PORT="${BASH_REMATCH[1]}"
      DAYS_AGO=0
    else
      II "  Skipping unrecognised filename: $FNAME"
      continue
    fi

    # Calculate the target date
    FILE_DATE="$(date -v -${DAYS_AGO}d -j -f "%Y-%m-%d" "$REF_DATE" +"%Y-%m-%d" 2>/dev/null \
      || date -d "${REF_DATE} -${DAYS_AGO} days" +"%Y-%m-%d")"

    TARGET_DIR="logdir/${HOST}/${FILE_DATE}"
    mkdir -p "$TARGET_DIR"
    cp "$f" "${TARGET_DIR}/${PORT}_AccessLog.txt"
    II "  -> ${TARGET_DIR}/${PORT}_AccessLog.txt"
  done

  rm -rf "$TMPDIR"
done

FILE_COUNT="$(find logdir -type f -name '*AccessLog*.txt' | wc -l | tr -d ' ')"
II "Reorganised $FILE_COUNT access log files into logdir/"

# Step 2: Convert to JSON
II "Converting logs to JSON..."
export LIB_DIR="$PROJECT_DIR"
bash "$SCRIPT_DIR/jsonify-logs.sh" logdir

# Step 3: Combine into CSV
II "Building monster-log.csv..."
export SOURCE_ZIP="$DIRNAME" EXPORT_DATE="$REF_DATE"
bash "$SCRIPT_DIR/monster-log.sh" logdir

# Step 4: Import into SQLite
II "Importing into $DB_FILE..."
DB_NAME="$DB_FILE" bash "$SCRIPT_DIR/import-csv-to-sqlite.sh"

II "Done! Database: $DB_FILE"
echo ""
II "Next steps:"
II "  make load DB=$DB_FILE START=... END=..."
II "  make plot DIR=load/..."
