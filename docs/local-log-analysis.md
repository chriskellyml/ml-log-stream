# Local MarkLogic log analysis

This guide is for anyone who wants to point this tool at a MarkLogic environment, pull down the server logs, and explore them with SQLite on their own machine.

## What it does

1. Connects to a MarkLogic host over HTTP.
2. Runs an XQuery that packages the requested log files into a zip.
3. Downloads that zip to your local `~/Downloads` folder.
4. Unpacks, normalises, and loads the logs into a SQLite database (`marklogic_logs.db`).
5. Lets you query the logs with SQL, either directly or through the file watcher.

## Before you start

Copy the template and fill in your MarkLogic credentials:

```bash
cp .env.local.template .env.local
```

Edit `.env.local`:

```bash
ML_USER=admin
ML_PASS=admin
#ML_HOST=localhost
#ML_PROTOCOL=http
#ML_PORT=8000
```

Uncomment and adjust `ML_HOST`, `ML_PROTOCOL`, and `ML_PORT` if the target is not `http://localhost:8000`.

Check that your machine has everything needed:

```bash
make doctor
npm install
```

`make doctor` checks for `bash`, `node`, `sqlite3`, `unzip`, and the optional `fswatch` file watcher.

## Download logs from MarkLogic

Run:

```bash
make download
```

This will:

- Call MarkLogic’s `/v1/eval` endpoint with the query in `qconsole/extract-logs.xqy`.
- Create a zip document on the server.
- Download that zip to `~/Downloads/logs_YYYYMMDD_HHMMSS.zip`.

To save the zip somewhere else:

```bash
make download DOWNLOADS_DIR=/tmp
```

To change what gets exported (days back, log types, ports, hosts), pass `make download` options or edit the variables at the top of `qconsole/extract-logs.xqy`. See [Configuring the export](#configuring-the-export) below for details. The defaults export today's `ErrorLog` files from all hosts and ports.

### Manual alternative

If you cannot use `/v1/eval` from this machine, run the export directly in MarkLogic Query Console:

1. Open `qconsole/extract-logs.xqy` in Query Console (database: `Documents`).
2. Set `$DRY_RUN` to `false()`.
3. Run the query and download the resulting zip from the document URI it prints.
4. Move the zip to `~/Downloads`.

## Ingest the zip into SQLite

Once the zip is in `~/Downloads`:

```bash
make ingest
```

This shows an interactive menu of every `logs_*.zip` file in `~/Downloads`. Pick the one you just downloaded.

To skip the menu and ingest the newest zip:

```bash
make ingest-latest
```

After ingestion finishes you will have `marklogic_logs.db` in the project root.

## Query the database

The fastest way to iterate is the SQL watcher:

```bash
make watch-sql
```

Create `.sql` files in `./sql/` and save them. The watcher automatically runs the changed file against `marklogic_logs.db` and prints the results.

Example `sql/example.sql`:

```sql
SELECT timestamp, host, port, statusCode, url
FROM logs
WHERE type = 'AccessLog'
ORDER BY timestamp
LIMIT 20;
```

You can also query directly:

```bash
sqlite3 marklogic_logs.db "SELECT COUNT(*) FROM logs;"
```

## Tables and views

### `logs`

Parsed access, error, audit, and request log lines.

| Column | Meaning |
|--------|---------|
| `timestamp` | Log timestamp |
| `date` | Date part of the source file |
| `host` | MarkLogic host name |
| `port` | App-server port |
| `type` | Log type (`AccessLog`, `ErrorLog`, etc.) |
| `lineNr` | Line number in the original source file |
| `id` | Synthetic primary key |
| `source` | Original log line text |
| `user` | Authenticated user, when available |
| `method` | HTTP method |
| `url` | Request URL |
| `protocol` | HTTP version |
| `statusCode` | HTTP status code |
| `response` | Response size or time |
| `message` | Free-text message (error logs) |

### `requests`

Parsed MarkLogic request log entries with request metrics (cache hits, elapsed time, etc.).

### Useful views

- `v_logs` — same as `logs` with a generated `sed` command that points back to the original source line.
- `grouped_requests` — aggregates `requests` by `pathPart1/pathPart2` with average elapsed time.
- `v1_search_users` — aggregates `/v1/search` requests by user.

## Filtering noisy lines

If the logs contain a lot of routine noise (`Fine:`, `Debug:`, etc.), filter them during ingest:

```bash
make ingest-latest SKIP='Fine:,Debug:'
```

`SKIP` is a comma-separated list of substrings; any log line containing one of them is dropped before loading into SQLite.

## Tips

- Ingesting the same zip again is safe: the importer uses `source_zip` and `export_date` to avoid duplicates and replace older exports with newer ones.
- Keep your SQL queries in `./sql/` so they are easy to re-run and share.
- Use `make extract START=... END=...` to dump a time window from every timestamped table to NDJSON.
- Use `make load START=... END=...` followed by `make plot` to build an HTML dashboard of request volume.

## Configuring the export

The export is driven by the variables at the top of `qconsole/extract-logs.xqy`. You can either edit that file directly or pass values to `make download` as environment variables.

### `DAYS`

Controls which days to export.

| Value | Meaning |
|-------|---------|
| `0` | Today |
| `1` | Yesterday |
| `10` | Ten days ago |
| `2024-08-21` | A specific date |
| `0,1,2` | Today plus the previous two days |

Examples:

```bash
# Just today (default)
make download

# Yesterday only
make download DAYS=1

# The last 10 days
make download DAYS=0,1,2,3,4,5,6,7,8,9

# A specific date
make download DAYS=2024-08-21
```

When logs are very large — for example if the server is logging at `Debug` level — it can be safer to download one day at a time rather than asking for a large range in a single export.

### `TYPES`

Controls which log files to include.

| Value | File pattern |
|-------|--------------|
| `ErrorLog` | `*_ErrorLog.txt` |
| `AccessLog` | `*_AccessLog.txt` |
| `RequestLog` | `*_RequestLog.txt` |
| `AuditLog` | `*_AuditLog.txt` |

Examples:

```bash
# Error logs only (default)
make download

# Error and access logs
make download TYPES='ErrorLog,AccessLog'

# All log types
make download TYPES='ErrorLog,AccessLog,RequestLog,AuditLog'
```

### `PORTS`

Limit the export to specific app-server ports.

```bash
make download PORTS='8000,8010'
```

### `HOSTS` and `HOSTS_EXCLUDE`

Limit the export to specific hosts, or exclude specific hosts.

```bash
make download HOSTS='host1,host2'
make download HOSTS_EXCLUDE='host-with-too-many-logs'
```

If both are provided, the include list is applied first and then the exclude list is applied.

### Combining options

```bash
make download DAYS=10 TYPES='ErrorLog,AccessLog' PORTS='8000,8010'
```

### Editing `extract-logs.xqy` directly

If you prefer, open `qconsole/extract-logs.xqy` and change the variable declarations directly:

```xquery
declare variable $DAYS external := (0, 1, 2);
declare variable $TYPES external := ('ErrorLog', 'AccessLog');
declare variable $PORT_LIST external := ('8000', '8010');
```

The `make download` environment variables override these defaults when they are provided.

