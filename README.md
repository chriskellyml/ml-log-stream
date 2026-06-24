# ml-log-stream

Stream logs from MarkLogic.

For a step-by-step guide to downloading logs from a MarkLogic environment and analyzing them locally with SQLite, see [docs/local-log-analysis.md](docs/local-log-analysis.md).

## Usage

The repo now uses `make` directly. No `direnv`, activation script, or shell PATH setup is required.

Run `make` to see the available commands:

```bash
make
```

Typical commands:

```bash
make doctor
make download
make ingest
make ingest-latest
make extract START=2026-01-01T12:02:02 END=2026-01-01T12:06:08
make load START=2026-01-01T12:00:00 END=2026-01-01T13:00:00
make plot
```

## Commands

- `make doctor` checks required and optional dependencies plus local workspace state.
- `make ingest` lets you pick a `logs_*.zip` file from `~/Downloads`, imports it into SQLite, and starts the SQL watcher.
- `make ingest-latest` skips the interactive picker and ingests the newest matching zip file.
- `make extract START=... END=...` exports all rows from every table with a `timestamp` column into timestamp-ordered NDJSON.
- `make load START=... END=...` exports access-log request counts as CSVs across multiple time buckets and grouping dimensions.
- `make plot` renders a load dashboard HTML page using Node.js.
- `make sql` creates the local `sql/` directory.
- `make clean` removes generated ingestion artifacts.

## Workflow

1. Run `make doctor`.
2. Run `make download` (or export logs manually) to get a zip into `~/Downloads`.
3. Run `make ingest` or `make ingest-latest`.
4. Create `.sql` files in `./sql/`.
5. Save SQL files to auto-execute them against `marklogic_logs.db`.
6. Press `Ctrl+C` to stop the watcher.

## Dependencies

Required:

- `bash`
- `node`
- `sqlite3`
- `unzip`

Optional:

- `fswatch` for SQL file watching
- `tree` for directory display helpers

## Export Logs From MarkLogic

```bash
make download
```

This creates the export on the MarkLogic server and saves the zip to `~/Downloads`. See [docs/local-log-analysis.md](docs/local-log-analysis.md) for configuration, ingest, and query instructions.

If you prefer to run the export manually from Query Console, see the comment block at the top of [`qconsole/extract-logs.xqy`](qconsole/extract-logs.xqy).

## Query Data

After ingestion, the SQLite database is written to `marklogic_logs.db`.

Create `.sql` files in `./sql/` to run queries. The watcher re-runs the changed file whenever it is saved.

To extract a time window across all timestamped tables:

```bash
make extract START=2026-01-01T12:02:02 END=2026-01-01T12:06:08
```

By default this writes a JSON-lines file under `./extracts/`. You can override that with `OUTPUT=...`, for example:

```bash
make extract START=2026-01-01T12:02:02 END=2026-01-01T12:06:08 OUTPUT=tmp/window.jsonl
```

## Load Analysis

To export request-volume CSVs for charting:

```bash
make load START=2026-01-01T12:00:00 END=2026-01-01T13:00:00
```

This reads access-log rows from the `logs` table and writes CSVs under `./load/` by default. It creates one file for each time bucket and grouping dimension:

- Bucket sizes: `1h`, `15m`, `5m`, `1m`, `15s`, `5s`
- Groupings: `port`, `endpoint`, `user`, `ip`

Example output files:

- `load_1h_by_port.csv`
- `load_5m_by_endpoint.csv`
- `load_1m_by_user.csv`
- `load_15s_by_ip.csv`

The CSV schema is:

```csv
bucket_start,bucket_size,dimension,dimension_value,request_count
2026-01-01 12:00:00,5m,port,8000,123
```

Notes:

- `endpoint` is normalized to the first two path segments, for example `/v1/search`.
- Empty `user`, `ip`, or `port` values are exported as `__empty__`.
- Override the output directory with `OUTDIR=...`.

## Plotting

To render a dashboard from the most recent load export:

```bash
make plot
```

This uses Node.js only and does not require Python or extra charting packages. It creates one HTML page containing:

- a mini chart for every generated load CSV
- a larger focus chart at the top
- click-to-zoom behavior so selecting a mini chart updates the main panel

By default `make plot` finds the newest `load/load_*` directory and writes `dashboard.html` into that directory.

You can also point it at a specific load directory:

```bash
make plot DIR=load/load_2026-01-01T12-00-00_to_2026-01-01T13-00-00 TOP=8
```

Options:

- `TOP=8` keeps the busiest 8 series by total request count in each chart.
- Remaining series are collapsed into `__other__`.
- Override the output path with `OUTPUT=...`.
- Override the page title with `TITLE=...`.
- `FILE=...` still works if you want a single-chart page from one CSV.
