#!/usr/bin/env node
// Analyze a CDP trace JSON: aggregate self-time per call-frame from
// ProfileChunk samples, resolving minified frames via source-maps when
// a .js.map is provided alongside the trace.
//
// Usage:
//   node scripts/analyze-cdp.mjs <trace.cdp.json> [path/to/index-*.js.map]
//
// Output: top-N (default 40) frames by self-time, with file:line attribution.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const tracePath = process.argv[2];
const mapPath = process.argv[3];
if (!tracePath) {
  console.error(
    "usage: node scripts/analyze-cdp.mjs <trace.cdp.json> [index.js.map]",
  );
  process.exit(1);
}

const trace = JSON.parse(readFileSync(tracePath, "utf8"));

// Lazy-load source-map (optional dep — only needed when map path provided).
let consumer = null;
if (mapPath) {
  const require = createRequire(import.meta.url);
  const { SourceMapConsumer } = require("source-map");
  const rawMap = JSON.parse(readFileSync(mapPath, "utf8"));
  consumer = await new SourceMapConsumer(rawMap);
}

const nodes = new Map();
const selfDeltaUs = new Map();
let totalDelta = 0;

for (const ev of trace.traceEvents) {
  if (ev.name !== "ProfileChunk") continue;
  const data = ev.args?.data;
  const cpu = data?.cpuProfile;
  if (!cpu) continue;
  for (const n of cpu.nodes ?? []) nodes.set(n.id, n);
  const samples = cpu.samples ?? [];
  const deltas = data.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const id = samples[i];
    const d = Math.max(0, deltas[i] ?? 0);
    selfDeltaUs.set(id, (selfDeltaUs.get(id) ?? 0) + d);
    totalDelta += d;
  }
}

function resolveFrame(cf) {
  const name = cf.functionName || "(anonymous)";
  if (!cf.url || cf.lineNumber == null) return `${name} (no-url)`;
  if (!consumer || !cf.url.includes("index-")) {
    return `${name}  ${cf.url}:${cf.lineNumber}`;
  }
  const pos = consumer.originalPositionFor({
    line: cf.lineNumber + 1,
    column: cf.columnNumber ?? 0,
  });
  if (!pos.source)
    return `${name} (unresolved ${cf.lineNumber}:${cf.columnNumber})`;
  const src = pos.source.replace(/^.*\/(packages|apps|node_modules)\//, "$1/");
  return `${pos.name || name}  ${src}:${pos.line}`;
}

const entries = [];
for (const [id, us] of selfDeltaUs.entries()) {
  const n = nodes.get(id);
  if (!n) continue;
  entries.push({ us, label: resolveFrame(n.callFrame) });
}
entries.sort((a, b) => b.us - a.us);

console.log(
  `Total sample time: ${(totalDelta / 1000).toFixed(2)} ms across ${selfDeltaUs.size} unique nodes`,
);
console.log(
  consumer
    ? "\nTop 40 by SELF time (sourcemap-resolved):"
    : "\nTop 40 by SELF time (minified — pass a .js.map for attribution):",
);
for (const e of entries.slice(0, 40)) {
  const pct = ((e.us / totalDelta) * 100).toFixed(1);
  console.log(`  ${e.us.toString().padStart(7)}μs  (${pct}%)  ${e.label}`);
}

if (consumer) consumer.destroy();
