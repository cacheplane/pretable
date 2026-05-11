#!/usr/bin/env node
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STATUS_DIR = "status";
const OUT_PATH =
  "status/milestones/2026-05-10-b2-sort-filter-summary.json";

const ADAPTERS = ["pretable", "ag-grid", "tanstack", "mui"];
const SCRIPTS = ["sort", "filter-metadata", "filter-text"];
const DATE_PREFIX = "2026-05-10";

function median(xs) {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  return n % 2
    ? sorted[(n - 1) / 2]
    : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

const files = await readdir(STATUS_DIR);

const adapters = [];
let latestRunsetId = "";

for (const adapterId of ADAPTERS) {
  const rows = [];
  for (const scriptName of SCRIPTS) {
    // Per-(adapter, script) the matrix runner emits one summary per repeat.
    // PR #131 ran n=3; if a directory contains files from multiple matrix
    // runs the older ones are filtered out by keeping the last 3 sorted
    // lexicographically (timestamps in filename order ≈ chronological).
    const matchingFiles = files
      .filter(
        (f) =>
          f.startsWith(
            `chromium-${adapterId}-default-s2-hypothesis-${scriptName}-${DATE_PREFIX}`,
          ) && f.endsWith(".summary.json"),
      )
      .sort()
      .slice(-3);
    const samples = [];
    for (const f of matchingFiles) {
      const data = JSON.parse(
        await readFile(join(STATUS_DIR, f), "utf8"),
      );
      const lat = data.metrics?.interaction_latency_ms;
      const settle = data.metrics?.settle_duration_ms;
      if (typeof lat === "number" && typeof settle === "number") {
        samples.push({ lat, settle });
      }
      // Capture the latest timestamp seen across all files for the
      // runsetId field; the matrix runner uses ISO-y timestamps in the
      // filename, so lexicographic max ≈ chronological max.
      const stem = f.replace(".summary.json", "");
      const timestamp = stem.split("-").slice(-1)[0]; // crude; OK for runsetId labeling
      if (timestamp > latestRunsetId) latestRunsetId = timestamp;
    }
    rows.push({
      scriptName,
      interactionLatencyMs: median(samples.map((s) => s.lat)),
      settleDurationMs: median(samples.map((s) => s.settle)),
      sampleCount: samples.length,
    });
  }
  adapters.push({ adapterId, rows });
}

const out = {
  runsetId: latestRunsetId || "unknown",
  generatedAt: new Date().toISOString(),
  scenarioId: "S2",
  scale: "hypothesis",
  browserName: "chromium",
  scripts: SCRIPTS,
  adapters,
};

await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${OUT_PATH}`);
console.log(JSON.stringify(out, null, 2));
