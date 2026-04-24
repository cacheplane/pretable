/**
 * Generates tiny dev fixtures for phase1 + phase2 so the app can be built
 * and run before the real OpenAI capture exists. Overwritten by the real
 * capture scripts at the end of the build.
 *
 * Produces:
 *   src/recordings/phase1.jsonl  — 10 fake stock rows, SSE-format
 *   src/recordings/phase2.jsonl  — 100 update batches over ~10s
 */
import { randomInt, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const OUT_DIR = join(ROOT, "src", "recordings");
mkdirSync(OUT_DIR, { recursive: true });

const tickers = [
  ["AAPL", "Apple Inc", "Technology"],
  ["MSFT", "Microsoft", "Technology"],
  ["GOOGL", "Alphabet", "Technology"],
  ["AMZN", "Amazon", "Consumer"],
  ["NVDA", "NVIDIA", "Technology"],
  ["META", "Meta Platforms", "Technology"],
  ["TSLA", "Tesla", "Consumer"],
  ["JPM", "JPMorgan Chase", "Financials"],
  ["V", "Visa", "Financials"],
  ["UNH", "UnitedHealth", "Healthcare"],
];

// ---------- phase1 ----------
const rows = tickers.map(([symbol, name, sector]) => ({
  symbol,
  name,
  last: Number((100 + Math.random() * 400).toFixed(2)),
  change_pct: Number((Math.random() * 10 - 5).toFixed(2)),
  volume: randomInt(1_000_000, 100_000_000),
  sector,
  last_update: "14:23:45",
}));

const jsonText = JSON.stringify(rows, null, 2);

// Chunk into realistic delta sizes (5–15 chars) at ~40ms spacing.
const phase1Lines: string[] = [];
let t = 0;
phase1Lines.push(JSON.stringify({ t, type: "response.created" }));
let i = 0;
while (i < jsonText.length) {
  const size = randomInt(5, 16);
  const delta = jsonText.slice(i, i + size);
  t += 0.02 + Math.random() * 0.03;
  phase1Lines.push(
    JSON.stringify({
      t: Number(t.toFixed(3)),
      type: "response.output_text.delta",
      delta,
    }),
  );
  i += size;
}
t += 0.05;
phase1Lines.push(
  JSON.stringify({ t: Number(t.toFixed(3)), type: "response.output_text.done" }),
);
t += 0.01;
phase1Lines.push(
  JSON.stringify({ t: Number(t.toFixed(3)), type: "response.completed" }),
);

writeFileSync(join(OUT_DIR, "phase1.jsonl"), phase1Lines.join("\n") + "\n");

// ---------- phase2 ----------
const phase2Lines: string[] = [];
const PHASE1_END = t;
for (let step = 0; step < 100; step++) {
  const vt = PHASE1_END + step * 0.1;
  const row = rows[step % rows.length];
  const delta = (Math.random() - 0.5) * 2;
  row.last = Number(Math.max(0.01, row.last + delta).toFixed(2));
  row.change_pct = Number((row.change_pct + delta / 10).toFixed(2));
  row.volume = row.volume + randomInt(1_000, 100_000);
  const minutes = Math.floor(vt / 60);
  const seconds = Math.floor(vt % 60);
  row.last_update = `14:${String(23 + minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  phase2Lines.push(
    JSON.stringify({
      t: Number(vt.toFixed(3)),
      patches: [
        {
          id: row.symbol,
          last: row.last,
          change_pct: row.change_pct,
          volume: row.volume,
          last_update: row.last_update,
        },
      ],
    }),
  );
}

writeFileSync(join(OUT_DIR, "phase2.jsonl"), phase2Lines.join("\n") + "\n");

// Silence unused-import warning without a console side effect in production.
void randomBytes;

console.log(
  `[make-dev-fixture] wrote ${phase1Lines.length} phase1 lines and ${phase2Lines.length} phase2 lines`,
);
