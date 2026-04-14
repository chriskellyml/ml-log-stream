#!/bin/bash

# Define variables
DB_NAME="${DB_NAME:-marklogic_logs.db}"
TABLE_NAME_1="logs"
TABLE_NAME_2="requests"
CSV_FILE_1="monster-log.csv"
CSV_FILE_2="requests-log.csv"

# Check if CSV file exists
if [ ! -f "$CSV_FILE_1" ]; then
  echo "CSV file not found at $CSV_FILE_1"
  exit 1
fi

# Create SQLite database and tables if they don't exist
sqlite3 "$DB_NAME" <<EOF
CREATE TABLE IF NOT EXISTS $TABLE_NAME_1 (
  timestamp TEXT,
  date TEXT,
  host TEXT,
  port INTEGER,
  type TEXT,
  lineNr INTEGER,
  id TEXT PRIMARY KEY,
  source TEXT,
  user TEXT,
  method TEXT,
  url TEXT,
  protocol TEXT,
  statusCode INTEGER,
  response TEXT,
  message TEXT,
  source_zip TEXT,
  export_date TEXT
);

CREATE VIEW IF NOT EXISTS v_logs AS
SELECT *, 
       'sed -n ' || lineNr || 'p logdir/' || host || '/' || date || '/' || port || '_' || 
       UPPER(SUBSTR(type, 1, 1)) || LOWER(SUBSTR(type, 2)) || 'Log.txt' AS find 
FROM $TABLE_NAME_1;
EOF

# Import CSV data using DELETE + INSERT approach
sqlite3 "$DB_NAME" <<EOF
.mode csv
.separator "|"
CREATE TEMP TABLE temp_logs AS SELECT * FROM $TABLE_NAME_1 WHERE 1=0;
.import $CSV_FILE_1 temp_logs

-- Delete existing records that have older export_date
DELETE FROM $TABLE_NAME_1 WHERE id IN (
  SELECT t.id FROM $TABLE_NAME_1 l
  JOIN temp_logs t ON l.id = t.id
  WHERE t.export_date > l.export_date
   OR (t.export_date = l.export_date AND t.source_zip > l.source_zip)
);

-- Insert all records (new ones insert, existing ones were deleted above if newer)
INSERT OR IGNORE INTO $TABLE_NAME_1 SELECT * FROM temp_logs;

DROP TABLE temp_logs;
EOF

echo "Data imported successfully from $CSV_FILE_1 into $DB_NAME ($TABLE_NAME_1)."

# Create requests table if it doesn't exist
sqlite3 "$DB_NAME" <<EOF
CREATE TABLE IF NOT EXISTS $TABLE_NAME_2 (
  timestamp TEXT,
  url TEXT,
  pathPart1 TEXT,
  pathPart2 TEXT,
  user TEXT,
  elapsedTime REAL,
  runTime REAL,
  compileTime REAL,
  ingestTime REAL,
  requests INTEGER,
  inMemoryListHits INTEGER,
  compressedTreeSize INTEGER,
  compressedTreeCacheHits INTEGER,
  compressedTreeCacheMisses INTEGER,
  dbLibraryModuleCacheHits INTEGER,
  dbLibraryModuleCacheMisses INTEGER,
  dbMainModuleSequenceCacheHits INTEGER,
  dbMainModuleSequenceCacheMisses INTEGER,
  dbProgramCacheHits INTEGER,
  dbProgramCacheMisses INTEGER,
  envProgramCacheHits INTEGER,
  envProgramCacheMisses INTEGER,
  filterHits INTEGER,
  filterMisses INTEGER,
  fsProgramCacheHits INTEGER,
  fsProgramCacheMisses INTEGER,
  inMemoryCompressedTreeHits INTEGER,
  inMemoryCompressedTreeMisses INTEGER,
  listSize INTEGER,
  listCacheHits INTEGER,
  listCacheMisses INTEGER,
  writeLocks INTEGER,
  expandedTreeCacheHits INTEGER,
  expandedTreeCacheMisses INTEGER,
  valueCacheHits INTEGER,
  valueCacheMisses INTEGER,
  regexpCacheHits INTEGER,
  regexpCacheMisses INTEGER,
  source_zip TEXT,
  export_date TEXT,
  PRIMARY KEY(timestamp, url, user, elapsedTime)
);

CREATE VIEW IF NOT EXISTS grouped_requests AS
SELECT 
    pathPart1,
    pathPart2,
    COUNT(*) AS query_count,
    AVG(elapsedTime) AS avg_elapsed_time,
    COUNT(*) * AVG(elapsedTime) as cost
FROM $TABLE_NAME_2
GROUP BY pathPart1, pathPart2;

CREATE VIEW IF NOT EXISTS v1_search_users AS
SELECT 
    user,
    COUNT(*) AS search_count,
    AVG(elapsedTime) AS avg_elapsed_time
FROM $TABLE_NAME_2
WHERE pathPart1 = 'v1' AND pathPart2 = 'search'
GROUP BY user;
EOF

# Import requests CSV data using DELETE + INSERT approach
sqlite3 "$DB_NAME" <<EOF
.mode csv
.separator "|"
CREATE TEMP TABLE temp_requests AS SELECT * FROM $TABLE_NAME_2 WHERE 1=0;
.import $CSV_FILE_2 temp_requests

-- Delete existing records that have older export_date
DELETE FROM $TABLE_NAME_2 WHERE (timestamp, url, user, elapsedTime) IN (
  SELECT t.timestamp, t.url, t.user, t.elapsedTime 
  FROM $TABLE_NAME_2 l
  JOIN temp_requests t ON l.timestamp = t.timestamp AND l.url = t.url AND l.user = t.user AND l.elapsedTime = t.elapsedTime
  WHERE t.export_date > l.export_date
   OR (t.export_date = l.export_date AND t.source_zip > l.source_zip)
);

-- Insert all records (new ones insert, existing ones were deleted above if newer)
INSERT OR IGNORE INTO $TABLE_NAME_2 SELECT * FROM temp_requests;

DROP TABLE temp_requests;
EOF

echo "Data imported successfully from $CSV_FILE_2 into $DB_NAME ($TABLE_NAME_2)."
