import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { COMMENTARY } from "../commentary";
import { ROSTER } from "../roster";
import type { PositionRow } from "../types";

/** Deterministic seeded PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0xc0ffee;
const DURATION_S = 24;        // virtual seconds of market activity per loop
const TICK_HZ = 8;            // price updates per second across the book

interface Phase1Event { type: "response.created" | "response.output_text.delta" | "response.completed"; t: number; delta?: string }
interface Phase2Event { t: number; type: "tick" | "commentary" | "flag"; patches: Array<Partial<PositionRow> & { id: string }> }

function startingRows(): PositionRow[] {
  // Compute weights from market value so the default weight-desc sort is correct.
  const base = ROSTER.map((e) => ({ ...e, mkt: e.qty * e.price }));
  const nav = base.reduce((s, e) => s + e.mkt, 0);
  return base.map((e) => ({
    id: e.symbol,
    symbol: e.symbol,
    name: e.name,
    sector: e.sector,
    qty: e.qty,
    last: e.price,
    mktValue: e.mkt,
    dayPnl: 0,
    dayPnlPct: 0,
    weight: Number(((e.mkt / nav) * 100).toFixed(1)),
    analyst: "",
    flag: "hold",
  }));
}

export function generatePortfolioRecording(): string {
  const rand = mulberry32(SEED);
  const lines: string[] = [];

  // ---- Phase 1: stream the roster as chunked JSON deltas ----
  const rows = startingRows();
  const json = JSON.stringify(rows);
  let t = 0;
  lines.push(JSON.stringify({ type: "response.created", t } satisfies Phase1Event));
  let cursor = 0;
  while (cursor < json.length) {
    const size = 8 + Math.floor(rand() * 23);
    const delta = json.slice(cursor, cursor + size);
    cursor += size;
    t += 8 + Math.floor(rand() * 16);
    lines.push(JSON.stringify({ type: "response.output_text.delta", t, delta } satisfies Phase1Event));
  }
  t += 8 + Math.floor(rand() * 16);
  lines.push(JSON.stringify({ type: "response.completed", t } satisfies Phase1Event));

  // ---- Phase 2: market ticks + analyst commentary (time in seconds) ----
  const events: Phase2Event[] = [];
  const open = rows.map((r) => r.last);   // opening prices for day-P&L math
  const price = rows.map((r) => r.last);

  // Ticks: every 1/TICK_HZ seconds, jiggle one or two names via a small random walk.
  const dt = 1 / TICK_HZ;
  for (let s = dt; s <= DURATION_S; s += dt) {
    const picks = 1 + Math.floor(rand() * 2);
    const patches: Phase2Event["patches"] = [];
    for (let p = 0; p < picks; p++) {
      const i = Math.floor(rand() * rows.length);
      const vol = ROSTER[i].vol;
      const drift = (rand() - 0.5) * 0.004 * vol;          // ±0.2% * vol per tick
      price[i] = Math.max(0.5, price[i] * (1 + drift));
      const last = Number(price[i].toFixed(2));
      const mktValue = Math.round(last * rows[i].qty);
      const dayPnl = Math.round((last - open[i]) * rows[i].qty);
      const dayPnlPct = Number((((last - open[i]) / open[i]) * 100).toFixed(2));
      patches.push({ id: rows[i].id, last, mktValue, dayPnl, dayPnlPct });
    }
    events.push({ t: Number(s.toFixed(3)), type: "tick", patches });
  }

  // Commentary: stagger each scripted holding; stream its chunks ~1.2s apart.
  COMMENTARY.forEach((script, idx) => {
    const start = 2 + idx * 1.5;           // staggered entrance
    let acc = "";
    script.chunks.forEach((chunk, ci) => {
      acc += chunk;
      events.push({
        t: Number((start + ci * 1.2).toFixed(3)),
        type: "commentary",
        patches: [{ id: script.symbol, analyst: acc }],
      });
    });
    // Flag resolves once the note is complete.
    events.push({
      t: Number((start + script.chunks.length * 1.2).toFixed(3)),
      type: "flag",
      patches: [{ id: script.symbol, flag: script.flag }],
    });
  });

  events.sort((a, b) => a.t - b.t);
  for (const ev of events) lines.push(JSON.stringify(ev));
  return lines.join("\n") + "\n";
}

// CLI entrypoint — writes portfolio.jsonl + portfolio.ts
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("generate-portfolio.ts")) {
  const here = dirname(fileURLToPath(import.meta.url));
  const text = generatePortfolioRecording();
  const out = join(here, "..", "recordings", "portfolio.jsonl");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, text);
  const tsOut = join(here, "..", "recordings", "portfolio.ts");
  const tsBody =
    "// Auto-generated from portfolio.jsonl. Do not edit by hand.\n" +
    "// Regenerate by running scripts/generate-portfolio.ts.\n\n" +
    `export const PORTFOLIO_RECORDING = ${JSON.stringify(text)};\n`;
  writeFileSync(tsOut, tsBody);
  console.log(`wrote ${out} — ${text.length} bytes, ${text.split("\n").length - 1} lines`);
}
