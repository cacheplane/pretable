#!/usr/bin/env node
// Analyze a CDP trace JSON: aggregate self-time per call-frame from
// ProfileChunk samples, resolving minified frames via source-maps when
// a .js.map is provided alongside the trace.
//
// Usage:
//   node scripts/analyze-cdp.mjs <trace.cdp.json> [path/to/index-*.js.map] [--window=<name>]
//
// --window options:
//   full          (default) Aggregate over the entire trace.
//   interaction   Slice to the trigger-to-first-frame window. Requires
//                 performance.mark("pretable.interaction.start" / ".firstFrame")
//                 events in the trace (the bench harness emits these
//                 automatically when PLAYWRIGHT_PERF_TRACE=1).
//   settle        Slice trigger-to-settled (first-frame plus follow-up frames).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const tracePath = args.find((a) => !a.startsWith("--") && a.endsWith(".json"));
const mapPath = args.find((a) => !a.startsWith("--") && a.endsWith(".map"));
const windowArg = args.find((a) => a.startsWith("--window="));
const windowMode = windowArg ? windowArg.split("=")[1] : "full";

if (!tracePath) {
  console.error(
    "usage: node scripts/analyze-cdp.mjs <trace.cdp.json> [index.js.map] [--window=full|interaction|settle]",
  );
  process.exit(1);
}

const trace = JSON.parse(readFileSync(tracePath, "utf8"));

let consumer = null;
if (mapPath) {
  const require = createRequire(import.meta.url);
  const { SourceMapConsumer } = require("source-map");
  const rawMap = JSON.parse(readFileSync(mapPath, "utf8"));
  consumer = await new SourceMapConsumer(rawMap);
}

// Find performance.mark timestamps for window slicing.
const marks = new Map();
for (const ev of trace.traceEvents) {
  if (ev.cat !== "blink.user_timing") continue;
  if (typeof ev.name !== "string") continue;
  if (!ev.name.startsWith("pretable.")) continue;
  if (typeof ev.ts !== "number") continue;
  if (!marks.has(ev.name)) marks.set(ev.name, ev.ts);
}

let windowStartTs = -Infinity;
let windowEndTs = Infinity;
let windowLabel = "full trace";
if (windowMode === "interaction") {
  const startTs = marks.get("pretable.interaction.start");
  const endTs = marks.get("pretable.interaction.firstFrame");
  if (startTs == null || endTs == null) {
    console.error(
      "[analyze-cdp] --window=interaction needs both pretable.interaction.start and .firstFrame marks; falling back to full",
    );
  } else {
    windowStartTs = startTs;
    windowEndTs = endTs;
    windowLabel = `interaction (${((endTs - startTs) / 1000).toFixed(2)} ms)`;
  }
} else if (windowMode === "settle") {
  const startTs = marks.get("pretable.interaction.start");
  const endTs = marks.get("pretable.interaction.settled");
  if (startTs == null || endTs == null) {
    console.error(
      "[analyze-cdp] --window=settle needs both pretable.interaction.start and .settled marks; falling back to full",
    );
  } else {
    windowStartTs = startTs;
    windowEndTs = endTs;
    windowLabel = `settle (${((endTs - startTs) / 1000).toFixed(2)} ms)`;
  }
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
  // ProfileChunk timestamps are walked sample-by-sample: sample i happens
  // at chunkStart + sum(deltas[0..=i]).
  let runningTs = ev.ts ?? 0;
  for (let i = 0; i < samples.length; i++) {
    runningTs += deltas[i] ?? 0;
    if (runningTs < windowStartTs || runningTs > windowEndTs) continue;
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
  `Window: ${windowLabel}\nTotal sample time in window: ${(totalDelta / 1000).toFixed(2)} ms across ${selfDeltaUs.size} unique nodes`,
);
console.log(
  consumer
    ? "\nTop 40 by SELF time (sourcemap-resolved):"
    : "\nTop 40 by SELF time (minified — pass a .js.map for attribution):",
);
for (const e of entries.slice(0, 40)) {
  const pct = totalDelta > 0 ? ((e.us / totalDelta) * 100).toFixed(1) : "  -";
  console.log(`  ${e.us.toString().padStart(7)}μs  (${pct}%)  ${e.label}`);
}

if (consumer) consumer.destroy();
