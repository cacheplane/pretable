/**
 * Generates recordings/phase2.jsonl from the seed dataset captured in
 * recordings/phase1.jsonl. Uses a seeded PRNG (mulberry32) so re-runs are
 * byte-identical. Writes ~90s of update batches at ~500 patches/sec, grouped
 * into ~16ms buckets (so ~8 patches per batch).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { create, push, finish, resolve } from "@cacheplane/json-stream";

import { parseJsonl } from "../src/recording-loader";
import type { Phase1Entry, StockRow } from "../src/types";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const IN = join(ROOT, "src", "recordings", "phase1.jsonl");
const OUT = join(ROOT, "src", "recordings", "phase2.jsonl");
const SEED = 0xc0ffee;
const DURATION_S = 90;
const PATCHES_PER_SEC = 500;
const BATCH_INTERVAL_MS = 16;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1. Reconstruct the seed rows by concatenating phase1 deltas and parsing.
const phase1 = parseJsonl<Phase1Entry>(readFileSync(IN, "utf8"));
const fullText = phase1
  .filter((e) => e.type === "response.output_text.delta")
  .map((e) => (e as Extract<Phase1Entry, { delta: string }>).delta)
  .join("");

let state = create();
state = push(state, fullText);
state = finish(state);
if (state.error) {
  throw new Error(`phase1 parse failed: ${state.error.message}`);
}
const seedRows = resolve(state) as StockRow[] | undefined;
if (!seedRows || !Array.isArray(seedRows)) {
  throw new Error("phase1 did not resolve to an array of rows");
}

console.log(`[generate-phase2] seed: ${seedRows.length} rows`);

const phase1End = phase1[phase1.length - 1]?.t ?? 0;
const rng = mulberry32(SEED);
const startPrices = new Map(seedRows.map((r) => [r.id, r.last]));
const current = new Map(
  seedRows.map((r) => [
    r.id,
    {
      last: r.last,
      change_pct: r.change_pct,
      volume: r.volume,
    },
  ]),
);

const lines: string[] = [];
const totalBatches = Math.floor((DURATION_S * 1000) / BATCH_INTERVAL_MS);
const patchesPerBatch = Math.max(
  1,
  Math.round((PATCHES_PER_SEC * BATCH_INTERVAL_MS) / 1000),
);

for (let b = 0; b < totalBatches; b++) {
  const vt = phase1End + (b * BATCH_INTERVAL_MS) / 1000;
  const patches: Partial<StockRow>[] = [];
  for (let p = 0; p < patchesPerBatch; p++) {
    const seed = seedRows[Math.floor(rng() * seedRows.length)];
    const cur = current.get(seed.id)!;
    const startPrice = startPrices.get(seed.id)!;
    // Random walk bounded to ±5% of the start price.
    const step = (rng() - 0.5) * startPrice * 0.01;
    let next = cur.last + step;
    const low = startPrice * 0.95;
    const high = startPrice * 1.05;
    if (next < low) next = low;
    if (next > high) next = high;
    cur.last = Number(next.toFixed(2));
    cur.change_pct = Number(
      (((next - startPrice) / startPrice) * 100).toFixed(2),
    );
    cur.volume += Math.floor(rng() * 10000) + 1000;
    const totalSeconds = Math.floor(vt);
    const hh = 14 + Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = totalSeconds % 60;
    const last_update = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
    patches.push({
      id: seed.id,
      last: cur.last,
      change_pct: cur.change_pct,
      volume: cur.volume,
      last_update,
    });
  }
  lines.push(
    JSON.stringify({
      t: Number(vt.toFixed(3)),
      patches,
    }),
  );
}

writeFileSync(OUT, lines.join("\n") + "\n");

console.log(
  `[generate-phase2] wrote ${lines.length} batches, ${lines.length * patchesPerBatch} patches`,
);
