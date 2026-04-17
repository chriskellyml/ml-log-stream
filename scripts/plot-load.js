#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const inputFile = process.env.FILE || "";
const inputDir = process.env.DIR || "";
const topN = Number.parseInt(process.env.TOP || "8", 10);
const customTitle = process.env.TITLE || "";
let outputFile = process.env.OUTPUT || "";

if (!Number.isFinite(topN) || topN < 1) {
  console.error(`TOP must be a positive integer. Received: ${process.env.TOP}`);
  process.exit(1);
}

const target = resolveTarget(inputFile, inputDir);
const csvFiles = target.type === "file" ? [target.path] : findCsvFiles(target.path);

if (csvFiles.length === 0) {
  console.error(`No load CSV files found in ${target.path}`);
  process.exit(1);
}

const charts = csvFiles
  .map((file) => buildChartData(file, topN))
  .sort((a, b) => bucketRank(a.bucketSize) - bucketRank(b.bucketSize) || dimensionRank(a.dimension) - dimensionRank(b.dimension));
const pageTitle =
  customTitle ||
  (target.type === "dir"
    ? `Load Dashboard (${path.basename(target.path)})`
    : charts[0].title);

if (!outputFile) {
  outputFile =
    target.type === "dir"
      ? path.join(target.path, "dashboard.html")
      : path.join(path.dirname(target.path), `${path.parse(target.path).name}.html`);
}

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, renderHtml(pageTitle, charts, target), "utf8");

console.log(`Wrote dashboard to ${outputFile}`);

function resolveTarget(fileArg, dirArg) {
  if (fileArg) {
    if (!fs.existsSync(fileArg)) {
      console.error(`Input path not found: ${fileArg}`);
      process.exit(1);
    }

    const stat = fs.statSync(fileArg);
    return {
      type: stat.isDirectory() ? "dir" : "file",
      path: fileArg,
    };
  }

  if (dirArg) {
    if (!fs.existsSync(dirArg) || !fs.statSync(dirArg).isDirectory()) {
      console.error(`Directory not found: ${dirArg}`);
      process.exit(1);
    }

    return { type: "dir", path: dirArg };
  }

  const loadRoot = path.join(process.cwd(), "load");
  if (!fs.existsSync(loadRoot)) {
    console.error("No load directory found. Run 'make load' first or pass DIR=<load-dir>.");
    process.exit(1);
  }

  const latestDir = fs
    .readdirSync(loadRoot)
    .map((name) => path.join(loadRoot, name))
    .filter((fullPath) => fs.statSync(fullPath).isDirectory())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

  if (!latestDir) {
    console.error("No load output directories found. Run 'make load' first or pass DIR=<load-dir>.");
    process.exit(1);
  }

  return { type: "dir", path: latestDir };
}

function findCsvFiles(dirPath) {
  return fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith(".csv"))
    .map((name) => path.join(dirPath, name))
    .sort((a, b) => a.localeCompare(b));
}

function buildChartData(filePath, seriesLimit) {
  const csvText = fs.readFileSync(filePath, "utf8").trim();
  if (!csvText) {
    throw new Error(`Input file is empty: ${filePath}`);
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    throw new Error(`No data rows found in ${filePath}`);
  }

  const bucketOrder = [...new Set(rows.map((row) => row.bucket_start))].sort();
  const totalsBySeries = new Map();

  for (const row of rows) {
    totalsBySeries.set(
      row.dimension_value,
      (totalsBySeries.get(row.dimension_value) || 0) + row.request_count,
    );
  }

  const topSeries = [...totalsBySeries.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, seriesLimit)
    .map(([name]) => name);

  const topSeriesSet = new Set(topSeries);
  const collapsedName = "__other__";
  const seriesNames = [...topSeries];
  if (totalsBySeries.size > topSeries.length) {
    seriesNames.push(collapsedName);
  }

  const values = new Map(bucketOrder.map((bucket) => [bucket, new Map()]));
  for (const row of rows) {
    const seriesName = topSeriesSet.has(row.dimension_value) ? row.dimension_value : collapsedName;
    values.get(row.bucket_start).set(
      seriesName,
      (values.get(row.bucket_start).get(seriesName) || 0) + row.request_count,
    );
  }

  const series = seriesNames.map((name) => ({
    name,
    values: bucketOrder.map((bucket) => values.get(bucket).get(name) || 0),
    total: bucketOrder.reduce((sum, bucket) => sum + (values.get(bucket).get(name) || 0), 0),
  }));

  const totalRequests = rows.reduce((sum, row) => sum + row.request_count, 0);
  const bucketSize = rows[0].bucket_size;
  const dimension = rows[0].dimension;

  return {
    id: path.parse(filePath).name,
    filePath,
    fileName: path.basename(filePath),
    title: `Requests by ${dimension} (${bucketSize})`,
    bucketSize,
    bucketSizeMinutes: parseBucketSize(bucketSize),
    dimension,
    buckets: bucketOrder,
    axisLabels: computeAxisLabels(bucketOrder),
    series,
    totalRequests,
    maxValue: series.reduce((max, item) => item.values.reduce((m, v) => Math.max(m, v), max), 1),
  };
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = Object.fromEntries(header.map((key, index) => [key, cols[index] || ""]));
    return {
      bucket_start: row.bucket_start,
      bucket_size: row.bucket_size,
      dimension: row.dimension,
      dimension_value: row.dimension_value,
      request_count: Number.parseInt(row.request_count, 10) || 0,
    };
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current);
  return result;
}

function computeAxisLabels(buckets) {
  const parsed = buckets
    .map((bucket, index) => {
      const parts = parseBucket(bucket);
      const date = parts ? parseBucketDate(bucket) : null;
      return { index, bucket, parts, date };
    })
    .filter((item) => item.parts && item.date);

  if (parsed.length === 0) {
    return [];
  }

  const intervalMinutes = chooseLabelIntervalMinutes(parsed);
  const isMultiDay = (parsed[parsed.length - 1].date - parsed[0].date) > 86400000;

  const labels = parsed
    .filter((item) => item.parts.second === 0)
    .filter((item) => ((item.parts.hour * 60 + item.parts.minute) % intervalMinutes) === 0)
    .map((item) => {
      const timeLabel = `${pad(item.parts.hour)}:${pad(item.parts.minute)}`;
      const label = isMultiDay
        ? `${item.date.getMonth() + 1}/${item.date.getDate()} ${timeLabel}`
        : timeLabel;
      return { index: item.index, label };
    });

  if (labels.length > 0) {
    return labels;
  }

  const first = parsed[0].parts;
  return [{
    index: parsed[0].index,
    label: `${pad(first.hour)}:${pad(first.minute - (first.minute % 5))}`,
  }];
}

function chooseLabelIntervalMinutes(parsedBuckets) {
  const allowed = [5, 10, 15, 20, 30, 60, 120, 180, 240, 360, 720, 1440];

  if (parsedBuckets.length < 2) {
    return 5;
  }

  const firstDate = parsedBuckets[0].date;
  const lastDate = parsedBuckets[parsedBuckets.length - 1].date;
  const spanMinutes = Math.max(5, (lastDate - firstDate) / 60000);

  for (const interval of allowed) {
    if (Math.floor(spanMinutes / interval) + 1 <= 20) {
      return interval;
    }
  }

  return 1440;
}

function parseBucket(bucket) {
  const match = String(bucket).match(/(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3]),
  };
}

function formatBucketTime(bucket) {
  const parts = parseBucket(bucket);
  if (!parts) {
    return bucket;
  }

  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function parseBucketSize(size) {
  const match = String(size).match(/^(\d+)([smh])$/);
  if (!match) {
    return 60;
  }
  const num = Number.parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "s") return num;
  if (unit === "m") return num;
  if (unit === "h") return num * 60;
  return num;
}

function parseBucketDate(bucket) {
  const d = new Date(bucket);
  if (!isNaN(d)) {
    return d;
  }
  const m = String(bucket).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) {
    return null;
  }
  const fixed = new Date(m[1], Number(m[2]) - 1, m[3], m[4], m[5], m[6]);
  return isNaN(fixed) ? null : fixed;
}

function bucketRank(bucketSize) {
  return {
    "1h": 0,
    "15m": 1,
    "5m": 2,
    "1m": 3,
    "15s": 4,
    "5s": 5,
  }[bucketSize] ?? 999;
}

function dimensionRank(dimension) {
  return {
    port: 0,
    endpoint: 1,
    user: 2,
    ip: 3,
  }[dimension] ?? 999;
}

function renderHtml(title, charts, target) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #f3ede2;
      --panel: rgba(255, 252, 246, 0.88);
      --panel-strong: rgba(255, 252, 246, 0.97);
      --ink: #17212b;
      --muted: #667085;
      --grid: rgba(116, 93, 65, 0.18);
      --border: rgba(23, 33, 43, 0.08);
      --shadow: 0 20px 60px rgba(23, 33, 43, 0.1);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Iowan Old Style", "Palatino Linotype", serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(14, 116, 144, 0.12), transparent 28%),
        radial-gradient(circle at top right, rgba(154, 52, 18, 0.14), transparent 24%),
        linear-gradient(180deg, #f7f2e7 0%, #ede4d5 100%);
    }
    main {
      max-width: 1500px;
      margin: 0 auto;
      padding: 28px 22px 40px;
    }
    h1 {
      margin: 0;
      font-size: clamp(2.2rem, 5vw, 4rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }
    .lede {
      margin: 10px 0 24px;
      color: var(--muted);
      font-size: 1rem;
    }
    .time-key {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 0.86rem;
    }
    .time-key-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .time-chip {
      width: 14px;
      height: 10px;
      border-radius: 3px;
      border: 1px solid rgba(23, 33, 43, 0.16);
    }
    .focus {
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 22px;
      box-shadow: var(--shadow);
      margin-bottom: 22px;
    }
    .focus-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
      margin: 8px 0 14px;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .focus svg {
      width: 100%;
      height: auto;
      display: block;
    }
    .legend {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px 18px;
      margin-top: 18px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      font-size: 0.95rem;
    }
    .swatch {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      flex: 0 0 auto;
    }
    .legend-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rows {
      display: grid;
      gap: 18px;
    }
    .row {
      background: rgba(255, 252, 246, 0.55);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 14px;
      box-shadow: 0 12px 28px rgba(23, 33, 43, 0.05);
    }
    .row-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .row-title {
      margin: 0;
      font-size: 1.05rem;
      letter-spacing: 0.01em;
    }
    .row-meta {
      color: var(--muted);
      font-size: 0.88rem;
    }
    .row-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 14px;
      box-shadow: 0 14px 30px rgba(23, 33, 43, 0.06);
      cursor: pointer;
      transition: transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease;
    }
    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 18px 38px rgba(23, 33, 43, 0.09);
    }
    .card.active {
      border-color: rgba(14, 116, 144, 0.45);
      box-shadow: 0 20px 40px rgba(14, 116, 144, 0.14);
    }
    .card h2 {
      margin: 0 0 4px;
      font-size: 1.05rem;
      line-height: 1.05;
    }
    .card-meta {
      color: var(--muted);
      font-size: 0.86rem;
      margin-bottom: 8px;
    }
    .mini {
      width: 100%;
      height: auto;
      display: block;
    }
    .tooltip {
      position: fixed;
      pointer-events: none;
      background: rgba(23, 33, 43, 0.95);
      color: #fff;
      padding: 8px 10px;
      border-radius: 10px;
      font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
      opacity: 0;
      transform: translate(-50%, -110%);
      transition: opacity 120ms ease;
      z-index: 10;
      white-space: nowrap;
    }
    .hint {
      margin-top: 16px;
      color: var(--muted);
      font-size: 0.9rem;
    }
    .focus-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 8px 0 14px;
      flex-wrap: wrap;
    }
    .nav-btn {
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 14px;
      font-family: inherit;
      font-size: 0.95rem;
      cursor: pointer;
      color: var(--ink);
    }
    .nav-btn:hover:not(:disabled) {
      border-color: rgba(14, 116, 144, 0.45);
    }
    .nav-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    select {
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 12px;
      font-family: inherit;
      font-size: 0.95rem;
      color: var(--ink);
    }
    #window-info {
      color: var(--muted);
      font-size: 0.9rem;
      margin-left: auto;
    }
    .toggle-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.95rem;
      cursor: pointer;
      user-select: none;
    }
    .toggle-label input {
      cursor: pointer;
    }
    .y-axis-input {
      width: 100px;
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 10px;
      font-family: inherit;
      font-size: 0.95rem;
      color: var(--ink);
    }
    .y-axis-input:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .selectors {
      display: flex;
      gap: 18px;
      flex-wrap: wrap;
      margin-top: 18px;
    }
    .selector-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 140px;
    }
    .selector-group label {
      font-size: 0.9rem;
      color: var(--muted);
    }
    .selector-group select {
      background: var(--panel-strong);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 12px;
      font-family: inherit;
      font-size: 0.95rem;
      color: var(--ink);
    }
    @media (max-width: 700px) {
      main { padding: 18px 14px 28px; }
      .focus { padding: 16px; }
      .row-grid { grid-template-columns: 1fr; }
      #window-info { width: 100%; margin-left: 0; margin-top: 4px; }
      .selectors { gap: 12px; }
    }
    @media (min-width: 701px) and (max-width: 1100px) {
      .row-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <main>
    <div class="lede">Source: ${escapeHtml(target.path)}.</div>
    <div class="time-key" id="time-key" hidden>
      <span class="time-key-item"><span class="time-chip" style="background:rgba(14, 116, 144, 0.28)"></span>night</span>
      <span class="time-key-item"><span class="time-chip" style="background:rgba(77, 124, 15, 0.2)"></span>workday</span>
      <span class="time-key-item"><span class="time-chip" style="background:rgba(180, 83, 9, 0.28)"></span>evening</span>
    </div>
    <section class="focus">
      <h2 id="focus-title"></h2>
      <div class="focus-meta" id="focus-meta"></div>
      <div class="focus-controls">
        <button id="prev-window" class="nav-btn" disabled>← Previous</button>
        <select id="window-size">
          <option value="all">All data</option>
          <option value="24">1 day</option>
          <option value="8">8 hours</option>
        </select>
        <button id="next-window" class="nav-btn" disabled>Next →</button>
        <label class="toggle-label">
          <input type="checkbox" id="show-dots" checked>
          <span>Show dots</span>
        </label>
        <label class="toggle-label">
          <input type="checkbox" id="fixed-y-axis" checked>
          <span>Fixed Y-axis</span>
        </label>
        <input type="number" id="y-axis-max" class="y-axis-input" value="0" min="0">
        <span id="window-info"></span>
      </div>
      <svg id="focus-chart" viewBox="0 0 1200 620" role="img"></svg>
      <div class="legend" id="legend"></div>
      <div class="hint">Top series by total request count are shown. Remaining series are collapsed into <code>__other__</code>.</div>
    </section>
    <section class="selectors" id="selectors">
      <div class="selector-group">
        <label for="dimension-select">Dimension</label>
        <select id="dimension-select"></select>
      </div>
      <div class="selector-group">
        <label for="resolution-select">Resolution</label>
        <select id="resolution-select"></select>
      </div>
    </section>
  </main>
  <div class="tooltip" id="tooltip"></div>
  <script>
    const charts = ${JSON.stringify(charts)};
    const tooltip = document.getElementById("tooltip");
    const focusTitle = document.getElementById("focus-title");
    const focusMeta = document.getElementById("focus-meta");
    const focusChart = document.getElementById("focus-chart");
    const legend = document.getElementById("legend");
    const timeKey = document.getElementById("time-key");
    const dimensionSelect = document.getElementById("dimension-select");
    const resolutionSelect = document.getElementById("resolution-select");
    const colors = ["#9a3412", "#0f766e", "#1d4ed8", "#b45309", "#be185d", "#4338ca", "#4d7c0f", "#7c2d12", "#047857"];

    let focusWindowSize = "all";
    let focusWindowStart = 0;

    const dimensionOrder = ["port", "endpoint", "user", "ip"];
    const bucketSizeOrder = ["1h", "15m", "5m", "1m", "15s", "5s"];

    const chartMap = new Map();
    const dims = new Set();
    const buckets = new Set();
    charts.forEach((chart) => {
      chartMap.set(chart.dimension + "|" + chart.bucketSize, chart);
      dims.add(chart.dimension);
      buckets.add(chart.bucketSize);
    });

    const sortedDimensions = [...dims].sort((a, b) => dimensionOrder.indexOf(a) - dimensionOrder.indexOf(b));
    const sortedBucketSizes = [...buckets].sort((a, b) => bucketSizeOrder.indexOf(a) - bucketSizeOrder.indexOf(b));

    let activeDimension = sortedDimensions[0] || "";
    let activeBucketSize = sortedBucketSizes[0] || "";

    function populateDimensionSelect() {
      dimensionSelect.innerHTML = "";
      sortedDimensions.forEach((dim) => {
        const opt = document.createElement("option");
        opt.value = dim;
        opt.textContent = dim;
        dimensionSelect.appendChild(opt);
      });
      dimensionSelect.value = activeDimension;
    }

    function populateResolutionSelect() {
      resolutionSelect.innerHTML = "";
      sortedBucketSizes.forEach((size) => {
        if (chartMap.has(activeDimension + "|" + size)) {
          const opt = document.createElement("option");
          opt.value = size;
          opt.textContent = size;
          resolutionSelect.appendChild(opt);
        }
      });
      if (chartMap.has(activeDimension + "|" + activeBucketSize)) {
        resolutionSelect.value = activeBucketSize;
      } else if (resolutionSelect.options.length > 0) {
        activeBucketSize = resolutionSelect.options[0].value;
      }
    }

    function currentChart() {
      return chartMap.get(activeDimension + "|" + activeBucketSize);
    }

    function renderCurrent() {
      const chart = currentChart();
      if (!chart) return;
      renderFocus(chart);
    }

    populateDimensionSelect();
    populateResolutionSelect();

    dimensionSelect.addEventListener("change", (e) => {
      activeDimension = e.target.value;
      focusWindowStart = 0;
      populateResolutionSelect();
      renderCurrent();
    });

    resolutionSelect.addEventListener("change", (e) => {
      activeBucketSize = e.target.value;
      focusWindowStart = 0;
      renderCurrent();
    });

    document.getElementById("window-size").addEventListener("change", (e) => {
      focusWindowSize = e.target.value;
      focusWindowStart = 0;
      renderCurrent();
    });

    document.getElementById("prev-window").addEventListener("click", () => {
      const chart = currentChart();
      if (!chart) return;
      const bucketMinutes = chart.bucketSizeMinutes || parseBucketSize(chart.bucketSize);
      const sizeHours = parseInt(focusWindowSize, 10);
      const bucketsPerWindow = Math.max(1, Math.floor((sizeHours * 60) / bucketMinutes));
      focusWindowStart = Math.max(0, focusWindowStart - bucketsPerWindow);
      renderFocus(chart);
    });

    document.getElementById("next-window").addEventListener("click", () => {
      const chart = currentChart();
      if (!chart) return;
      const bucketMinutes = chart.bucketSizeMinutes || parseBucketSize(chart.bucketSize);
      const sizeHours = parseInt(focusWindowSize, 10);
      const bucketsPerWindow = Math.max(1, Math.floor((sizeHours * 60) / bucketMinutes));
      const maxStart = Math.max(0, chart.buckets.length - bucketsPerWindow);
      focusWindowStart = Math.min(maxStart, focusWindowStart + bucketsPerWindow);
      renderFocus(chart);
    });

    document.getElementById("show-dots").addEventListener("change", (e) => {
      renderCurrent();
    });

    const fixedYAxisCheck = document.getElementById("fixed-y-axis");
    const yAxisMaxInput = document.getElementById("y-axis-max");

    fixedYAxisCheck.addEventListener("change", (e) => {
      yAxisMaxInput.disabled = !e.target.checked;
      renderCurrent();
    });

    yAxisMaxInput.addEventListener("input", () => {
      renderCurrent();
    });

    renderCurrent();

    function renderFocus(chart) {
      focusTitle.textContent = chart.title;

      const windowed = getWindowedChart(chart);
      const windowedTotals = windowed.series.map((s) => s.values.reduce((sum, v) => sum + v, 0));
      const windowedTotalRequests = windowedTotals.reduce((sum, v) => sum + v, 0);

      focusMeta.innerHTML = [
        "file: " + escapeHtml(chart.fileName),
        "bucket size: " + escapeHtml(chart.bucketSize),
        "dimension: " + escapeHtml(chart.dimension),
        "buckets: " + windowed.buckets.length,
        "total requests: " + windowedTotalRequests
      ].map((item) => "<span>" + item + "</span>").join("");

      if (document.activeElement !== yAxisMaxInput) {
        yAxisMaxInput.value = chart.maxValue || 0;
      }

      renderChart(focusChart, windowed, true);
      updateWindowInfo(windowed, chart);
      legend.innerHTML = "";

      chart.series.forEach((series, index) => {
        const color = colors[index % colors.length];
        const item = document.createElement("div");
        item.className = "legend-item";
        const total = windowedTotals[index] ?? series.total;
        item.innerHTML = '<span class="swatch" style="background:' + color + '"></span><span class="legend-label">' + escapeHtml(series.name) + ' (' + total + ')</span>';
        legend.appendChild(item);
      });

      timeKey.hidden = document.getElementById("window-size").value !== "8";
    }

    function updateWindowInfo(windowedChart, fullChart) {
      const info = document.getElementById("window-info");
      const prevBtn = document.getElementById("prev-window");
      const nextBtn = document.getElementById("next-window");
      if (focusWindowSize === "all") {
        info.textContent = "";
        prevBtn.disabled = true;
        nextBtn.disabled = true;
        return;
      }
      const startText = formatBucketTimeFull(windowedChart.buckets[0]);
      const endText = formatBucketTimeFull(windowedChart.buckets[windowedChart.buckets.length - 1]);
      info.textContent = startText + " \u2013 " + endText;
      const bucketMinutes = fullChart.bucketSizeMinutes || parseBucketSize(fullChart.bucketSize);
      const sizeHours = parseInt(focusWindowSize, 10);
      const bucketsPerWindow = Math.max(1, Math.floor((sizeHours * 60) / bucketMinutes));
      prevBtn.disabled = focusWindowStart <= 0;
      nextBtn.disabled = focusWindowStart + bucketsPerWindow >= fullChart.buckets.length;
    }

    function getWindowedChart(chart) {
      if (focusWindowSize === "all") {
        return chart;
      }
      const sizeHours = parseInt(focusWindowSize, 10);
      const bucketMinutes = chart.bucketSizeMinutes || parseBucketSize(chart.bucketSize);
      const bucketsPerWindow = Math.max(1, Math.floor((sizeHours * 60) / bucketMinutes));
      const maxStart = Math.max(0, chart.buckets.length - bucketsPerWindow);
      focusWindowStart = Math.min(focusWindowStart, maxStart);
      const end = Math.min(chart.buckets.length, focusWindowStart + bucketsPerWindow);
      return {
        ...chart,
        buckets: chart.buckets.slice(focusWindowStart, end),
        series: chart.series.map((s) => ({
          ...s,
          values: s.values.slice(focusWindowStart, end)
        }))
      };
    }

    function renderChart(svg, chart, interactive) {
      const width = interactive ? 1200 : 320;
      const height = interactive ? 620 : 150;
      const margin = interactive
        ? { top: 24, right: 22, bottom: 88, left: 72 }
        : { top: 12, right: 10, bottom: 18, left: 12 };
      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;
      const dynamicMaxY = Math.max(1, chart.series.reduce((max, series) => series.values.reduce((m, v) => Math.max(m, v), max), 0));
      const fixedMaxY = interactive && document.getElementById("fixed-y-axis").checked
        ? Math.max(1, Number(document.getElementById("y-axis-max").value) || chart.maxValue || 0)
        : dynamicMaxY;
      const maxY = interactive ? fixedMaxY : dynamicMaxY;

      svg.innerHTML = "";
      svg.setAttribute("viewBox", "0 0 " + width + " " + height);

      const axisColor = interactive ? "#17212b" : "rgba(23, 33, 43, 0.35)";
      const gridColor = interactive ? "rgba(116, 93, 65, 0.18)" : "rgba(116, 93, 65, 0.14)";
      const axisLabels = interactive ? computeAxisLabelsClient(chart.buckets) : [];

      const xFor = (index) => {
        if (chart.buckets.length === 1) {
          return margin.left + innerWidth / 2;
        }
        return margin.left + (index / (chart.buckets.length - 1)) * innerWidth;
      };

      const yFor = (value) => margin.top + innerHeight - (value / maxY) * innerHeight;

      const addSvg = (tag, attrs) => {
        const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
        Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
        svg.appendChild(node);
        return node;
      };

      if (interactive) {
        const isEightHourView = document.getElementById("window-size").value === "8";

        if (isEightHourView) {
          const timeColors = {
            night: "rgba(14, 116, 144, 0.28)",
            workday: "rgba(77, 124, 15, 0.2)",
            evening: "rgba(180, 83, 9, 0.28)",
          };

          const periodAt = (bucket) => {
            const d = parseDateSafe(bucket);
            return periodForHour(d ? d.getHours() : 0);
          };

          if (chart.buckets.length > 0) {
            let runStart = 0;
            let runPeriod = periodAt(chart.buckets[0]);

            for (let i = 1; i <= chart.buckets.length; i += 1) {
              const nextPeriod = i < chart.buckets.length ? periodAt(chart.buckets[i]) : null;
              if (nextPeriod === runPeriod) {
                continue;
              }

              const runEnd = i - 1;
              const x1 = runStart === 0
                ? margin.left
                : (xFor(runStart - 1) + xFor(runStart)) / 2;
              const x2 = runEnd === chart.buckets.length - 1
                ? width - margin.right
                : (xFor(runEnd) + xFor(runEnd + 1)) / 2;

              addSvg("rect", {
                x: x1,
                y: margin.top,
                width: Math.max(0, x2 - x1),
                height: innerHeight,
                fill: timeColors[runPeriod],
                "stroke-width": "0"
              });

              runStart = i;
              runPeriod = nextPeriod;
            }
          }
        } else {
          const dayBands = [];
          let currentDayStart = 0;
          let currentDay = parseDateSafe(chart.buckets[0]);
          for (let i = 1; i < chart.buckets.length; i += 1) {
            const d = parseDateSafe(chart.buckets[i]);
            if (d && currentDay && d.getDate() !== currentDay.getDate()) {
              dayBands.push({ start: currentDayStart, end: i - 1 });
              currentDayStart = i;
              currentDay = d;
            }
          }
          dayBands.push({ start: currentDayStart, end: chart.buckets.length - 1 });

          dayBands.forEach((band, bandIndex) => {
            const x1 = xFor(band.start);
            const x2 = xFor(band.end);
            const fill = bandIndex % 2 === 0 ? "rgba(255, 252, 246, 0.45)" : "rgba(240, 235, 225, 0.55)";
            addSvg("rect", {
              x: x1,
              y: margin.top,
              width: Math.max(0, x2 - x1),
              height: innerHeight,
              fill,
              "stroke-width": "0"
            });
          });
        }

        for (let i = 0; i <= 5; i += 1) {
          const value = (maxY / 5) * i;
          const y = yFor(value);
          addSvg("line", { x1: margin.left, y1: y, x2: width - margin.right, y2: y, stroke: gridColor, "stroke-width": "1" });
          const label = addSvg("text", { x: margin.left - 12, y: y + 4, "text-anchor": "end", fill: "#667085", "font-size": "12" });
          label.textContent = Math.round(value);
        }

        addSvg("line", { x1: margin.left, y1: margin.top, x2: margin.left, y2: height - margin.bottom, stroke: axisColor, "stroke-width": "1.2" });
        addSvg("line", { x1: margin.left, y1: height - margin.bottom, x2: width - margin.right, y2: height - margin.bottom, stroke: axisColor, "stroke-width": "1.2" });

        for (let i = 1; i < chart.buckets.length; i += 1) {
          const prev = parseDateSafe(chart.buckets[i - 1]);
          const curr = parseDateSafe(chart.buckets[i]);
          if (prev && curr && prev.getDate() !== curr.getDate()) {
            const x = xFor(i);
            addSvg("line", {
              x1: x, y1: margin.top,
              x2: x, y2: height - margin.bottom,
              stroke: "rgba(23, 33, 43, 0.35)",
              "stroke-width": "2",
              "stroke-dasharray": "5 5"
            });
          }
        }

        axisLabels.forEach(({ index, label }) => {
          const x = xFor(index);
          if (index < chart.buckets.length - 1) {
            addSvg("line", { x1: x, y1: margin.top, x2: x, y2: height - margin.bottom, stroke: "rgba(116, 93, 65, 0.12)", "stroke-width": "1" });
          }
          const textNode = addSvg("text", { x, y: height - margin.bottom + 24, "text-anchor": "end", transform: "rotate(-35 " + x + " " + (height - margin.bottom + 24) + ")", fill: "#667085", "font-size": "12" });
          textNode.textContent = label;
        });
      }

      chart.series.forEach((series, seriesIndex) => {
        const color = colors[seriesIndex % colors.length];
        const d = series.values.map((value, index) => (index === 0 ? "M" : "L") + " " + xFor(index).toFixed(2) + " " + yFor(value).toFixed(2)).join(" ");
        addSvg("path", {
          d,
          fill: "none",
          stroke: color,
          "stroke-width": interactive ? "3" : "2",
          "stroke-linejoin": "round",
          "stroke-linecap": "round",
          opacity: interactive ? "1" : "0.92"
        });

        if (!interactive) {
          return;
        }

        const showDots = document.getElementById("show-dots").checked;
        if (!showDots) {
          return;
        }

        series.values.forEach((value, index) => {
          const point = addSvg("circle", {
            cx: xFor(index),
            cy: yFor(value),
            r: 4,
            fill: color,
            stroke: "#fffdf8",
            "stroke-width": "2",
            "data-bucket": chart.buckets[index],
            "data-series": series.name,
            "data-value": value
          });
          point.addEventListener("mouseenter", onEnter);
          point.addEventListener("mouseleave", onLeave);
        });
      });
    }

    function computeAxisLabelsClient(buckets) {
      const parsed = buckets.map((b, i) => {
        const d = parseDateSafe(b);
        return { index: i, date: d };
      }).filter((x) => x.date);
      if (parsed.length === 0) return [];

      const spanMs = parsed[parsed.length - 1].date - parsed[0].date;
      const spanHours = spanMs / 3600000;
      const targetCount = 8;
      const intervals = [1, 2, 3, 4, 6, 8, 12, 24];
      let intervalHours = 1;
      for (const h of intervals) {
        if (spanHours / h <= targetCount) {
          intervalHours = h;
          break;
        }
      }

      const isMultiDay = spanMs > 86400000;
      const labels = [];
      let lastDayLabel = null;

      for (const p of parsed) {
        const h = p.date.getHours();
        const m = p.date.getMinutes();
        const totalHours = h + m / 60;
        const mod = totalHours % intervalHours;
        if (mod < 0.01 || mod > intervalHours - 0.01 || (intervalHours === 24 && h === 0)) {
          const timeLabel = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
          const dayLabel = String(p.date.getMonth() + 1) + "/" + String(p.date.getDate());
          let label = timeLabel;
          if (isMultiDay && dayLabel !== lastDayLabel) {
            label = dayLabel + " " + timeLabel;
            lastDayLabel = dayLabel;
          }
          labels.push({ index: p.index, label });
        }
      }
      return labels;
    }

    function onEnter(event) {
      tooltip.innerHTML = escapeHtml(event.target.dataset.series) + "<br>" + escapeHtml(formatBucketTime(event.target.dataset.bucket)) + "<br>requests: " + escapeHtml(event.target.dataset.value);
      tooltip.style.opacity = "1";
      tooltip.style.left = event.clientX + "px";
      tooltip.style.top = event.clientY + "px";
    }

    function onLeave() {
      tooltip.style.opacity = "0";
    }

    function parseBucketSize(size) {
      const match = String(size).match(/^(\d+)([smh])$/);
      if (!match) return 60;
      const num = parseInt(match[1], 10);
      const unit = match[2];
      if (unit === "s") return num;
      if (unit === "m") return num;
      if (unit === "h") return num * 60;
      return num;
    }

    function parseBucket(bucket) {
      const match = String(bucket).match(/(\\d{2}):(\\d{2}):(\\d{2})$/);
      if (!match) {
        return null;
      }
      return {
        hour: Number(match[1]),
        minute: Number(match[2]),
      };
    }

    function formatBucketTime(bucket) {
      const parts = parseBucket(bucket);
      if (!parts) {
        return bucket;
      }
      return String(parts.hour).padStart(2, "0") + ":" + String(parts.minute).padStart(2, "0");
    }

    function parseDateSafe(str) {
      const d = new Date(str);
      if (!isNaN(d)) return d;
      const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})$/);
      if (!m) return null;
      const fixed = new Date(m[1], Number(m[2]) - 1, m[3], m[4], m[5], m[6]);
      return isNaN(fixed) ? null : fixed;
    }

    function periodForHour(hour) {
      if (hour < 8) return "night";
      if (hour < 16) return "workday";
      return "evening";
    }

    function formatBucketTimeFull(bucket) {
      const d = parseDateSafe(bucket);
      if (!d) return bucket;
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      return days[d.getDay()] + " " + String(d.getMonth() + 1) + "/" + String(d.getDate()) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
