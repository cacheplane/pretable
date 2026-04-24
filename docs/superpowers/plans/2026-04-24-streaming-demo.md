# Streaming Demo App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `apps/streaming-demo`, a standalone Vite + React app that replays a captured OpenAI Responses stream into a Pretable grid with a realtime pipeline inspector (stream events + parser AST) on the right, and a transport bar (play/pause/scrub/speed) on the bottom. Two replay phases: a ~30 s table-fill from a real OpenAI capture, then ~90 s of continuous price updates from a pre-computed random walk.

**Architecture:** Replay engine is a pure-TS module (virtual clock + dispatch cursors + scrub). React components subscribe to engine state and render the grid (using `@pretable/react`), the stream-events panel, the parser AST panel, and the transport bar. Recordings ship as JSONL files in `src/recordings/`. Two Node scripts handle recording creation: `capture-phase1.ts` (one-time, needs `OPENAI_API_KEY`) and `generate-phase2.ts` (deterministic, seeded PRNG).

**Tech Stack:** Vite 5+, React 19, TypeScript, vitest, `@cacheplane/json-stream`, `@pretable-internal/stream-adapter`, `@pretable/react`, `openai` (capture-script-only dep), Bloomberg-modern local CSS.

---

## File Structure

```
apps/streaming-demo/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── README.md
├── src/
│   ├── main.tsx                     # ReactDOM mount
│   ├── app.tsx                      # Top-level shell (layout D)
│   ├── types.ts                     # StockRow, Phase1Entry, Phase2Entry, EngineState
│   ├── replay-engine.ts             # Pure TS: clock, dispatch, scrub, play/pause
│   ├── recording-loader.ts          # Fetch + parse JSONL files
│   ├── use-engine.ts                # React hook that subscribes to replay-engine
│   ├── format.ts                    # Format helpers: volume (48.2M), change (+2.3%), time
│   ├── columns.ts                   # Pretable column defs for the stock table
│   ├── components/
│   │   ├── streaming-grid.tsx       # Pretable grid + batcher wiring
│   │   ├── stream-inspector.tsx     # Right-rail composer
│   │   ├── stream-events-panel.tsx  # Top half: recent chunks
│   │   ├── parser-ast-panel.tsx     # Bottom half: tree + mode
│   │   └── transport-bar.tsx        # Play / scrub / speed / time / phase
│   ├── theme/
│   │   └── bloomberg.css            # Theme tokens + data density
│   └── recordings/
│       ├── phase1.jsonl             # Real OpenAI capture (checked in)
│       └── phase2.jsonl             # Generated random walk (checked in)
└── scripts/
    ├── capture-phase1.ts            # Node: runs openai.responses.create()
    ├── generate-phase2.ts           # Node: seeded PRNG walk
    └── make-dev-fixture.ts          # Node: tiny synthetic phase1 fixture for early dev
```

**Responsibilities:**

- `replay-engine.ts` — Owns clock, cursors into recording arrays, RAF loop, scrub state. Pure TS, no DOM, no React. Emits state on change to subscribers.
- `use-engine.ts` — React adapter over the engine using `useSyncExternalStore`.
- `recording-loader.ts` — Single job: fetch JSONL, parse lines to typed arrays, error on malformed input.
- `columns.ts` — Column definitions + column-specific cell renderers (for colored change %, formatted volume, etc.).
- `streaming-grid.tsx` — Creates the grid via `@pretable/core`'s `createGrid`, exposes `applyTransaction`-compatible ref, renders through `@pretable/react`'s internal surface.
- Inspector panels — Presentational, read from `useEngine()`.
- `transport-bar.tsx` — The only surface that calls `play()`, `pause()`, `setSpeed()`, `seek()` on the engine.

---

### Task 1: App scaffolding

**Files:**

- Create: `apps/streaming-demo/package.json`
- Create: `apps/streaming-demo/tsconfig.json`
- Create: `apps/streaming-demo/vite.config.ts`
- Create: `apps/streaming-demo/index.html`
- Create: `apps/streaming-demo/src/main.tsx`
- Create: `apps/streaming-demo/src/app.tsx`
- Modify: `pnpm-workspace.yaml` (no-op — `apps/*` already matches)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@pretable/app-streaming-demo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "prepare:deps": "pnpm --filter @cacheplane/json-stream build && pnpm --filter @pretable-internal/stream-adapter build && pnpm --filter @pretable/react build",
    "predev": "pnpm run prepare:deps",
    "dev": "vite",
    "prebuild": "pnpm run prepare:deps",
    "build": "vite build",
    "lint": "eslint src scripts --ext .ts,.tsx",
    "pretest": "pnpm run prepare:deps",
    "test": "vitest run --environment jsdom --passWithNoTests",
    "pretypecheck": "pnpm run prepare:deps",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "capture": "tsx scripts/capture-phase1.ts",
    "generate-phase2": "tsx scripts/generate-phase2.ts",
    "make-dev-fixture": "tsx scripts/make-dev-fixture.ts"
  },
  "dependencies": {
    "@cacheplane/json-stream": "workspace:*",
    "@pretable-internal/stream-adapter": "workspace:*",
    "@pretable/react": "workspace:*",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "openai": "^4.60.0",
    "tsx": "^4.20.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.react.json",
  "compilerOptions": {
    "noEmit": true,
    "types": ["vite/client", "node"]
  },
  "include": ["src", "scripts", "vite.config.ts"]
}
```

- [ ] **Step 3: Create `vite.config.ts`**

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // JSONL recording files are loaded via fetch() from /src/recordings/
  // Vite serves src/ as-is in dev, and we'll rely on the public-asset path
  // in build via the copy plugin or a symlink (detailed in Task 3).
  assetsInclude: ["**/*.jsonl"],
});
```

- [ ] **Step 4: Create `index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pretable · Streaming Demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app";
import "./theme/bloomberg.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Create placeholder `src/app.tsx`**

```tsx
export function App() {
  return (
    <div className="app-shell">
      <div className="app-header">pretable · streaming demo</div>
      <div className="app-body">
        <div className="grid-slot">[grid]</div>
        <div className="inspector-slot">[inspector]</div>
      </div>
      <div className="transport-slot">[transport]</div>
    </div>
  );
}
```

- [ ] **Step 7: Create `src/theme/bloomberg.css` (initial tokens + layout)**

```css
:root {
  --bg: #0a0a0f;
  --panel: #14141b;
  --border: #27272a;
  --text: #fafafa;
  --muted: #a1a1aa;
  --dim: #52525b;
  --up: #4ade80;
  --down: #f87171;
  --accent: #4ade80;
  --mono: "SF Mono", Monaco, "Courier New", monospace;
  --sans:
    "Inter", -apple-system, system-ui, sans-serif;
}

* {
  box-sizing: border-box;
}
html,
body,
#root {
  height: 100%;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 13px;
}

.app-shell {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
}
.app-header {
  border-bottom: 1px solid var(--border);
  padding: 8px 16px;
  font-size: 12px;
  color: var(--muted);
  background: var(--panel);
}
.app-body {
  display: grid;
  grid-template-columns: 1fr 320px;
  overflow: hidden;
}
.grid-slot {
  overflow: hidden;
  background: var(--bg);
}
.inspector-slot {
  border-left: 1px solid var(--border);
  background: var(--panel);
  display: grid;
  grid-template-rows: 1fr 1fr;
}
.transport-slot {
  border-top: 1px solid var(--border);
  padding: 10px 16px;
  background: var(--panel);
}
```

- [ ] **Step 8: Verify scaffold builds**

Run:

```bash
cd apps/streaming-demo && pnpm install && pnpm build
```

Expected: clean `vite build`, produces `dist/` with `index.html` and a JS bundle.

- [ ] **Step 9: Verify dev server starts**

Run `pnpm dev` from `apps/streaming-demo/`. Expected: Vite dev server prints a URL. Open in browser; should see "pretable · streaming demo" header and `[grid] [inspector] [transport]` placeholders in the Bloomberg-modern dark theme. Ctrl-C to stop.

- [ ] **Step 10: Commit**

```bash
git add apps/streaming-demo
git commit -m "feat(streaming-demo): scaffold Vite app with Bloomberg-modern theme"
```

---

### Task 2: Recording types

**Files:**

- Create: `apps/streaming-demo/src/types.ts`

- [ ] **Step 1: Create `src/types.ts`**

```ts
/**
 * Rows rendered in the grid. `id === symbol` is the row identifier.
 */
export interface StockRow {
  id: string;
  symbol: string;
  name: string;
  last: number;
  change_pct: number;
  volume: number;
  sector: string;
  last_update: string;
}

/**
 * One line of `recordings/phase1.jsonl`. Corresponds to a single SSE event
 * from the OpenAI Responses stream.
 */
export type Phase1Entry =
  | {
      t: number;
      type: "response.output_text.delta";
      delta: string;
    }
  | {
      t: number;
      type:
        | "response.created"
        | "response.output_text.done"
        | "response.completed";
    };

/**
 * One line of `recordings/phase2.jsonl`. A batch of update patches to
 * apply at virtual time `t`.
 */
export interface Phase2Entry {
  t: number;
  patches: Partial<StockRow>[];
}

export type PlaybackSpeed = 0.5 | 1 | 2 | 4;
export type ReplayPhase = "fill" | "live" | "done";

export interface EngineState {
  clock: number;
  speed: PlaybackSpeed;
  playing: boolean;
  phase: ReplayPhase;
  totalDuration: number;
  /** Recent phase-1 stream events, newest last. Capped at 8. */
  recentStreamEvents: Phase1Entry[];
  /** Most-recent phase-2 batch, if any. */
  lastPatchBatch: { size: number; sample: Partial<StockRow> } | null;
  /** Parser state snapshot for the AST panel. Null during phase 2. */
  parserSnapshot: ParserSnapshot | null;
  /** Cumulative stats. */
  stats: {
    rowsAdded: number;
    patchesApplied: number;
  };
}

export interface ParserSnapshot {
  mode: string;
  rootKind: "array" | "object" | "other" | "empty";
  topLevelCount: number;
  topLevelCompleted: number;
  /** Partial value of the currently-building child of the root array. */
  buildingRow: Partial<StockRow> | null;
}
```

- [ ] **Step 2: Verify typecheck**

Run `cd apps/streaming-demo && pnpm typecheck`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/streaming-demo/src/types.ts
git commit -m "feat(streaming-demo): add recording and engine types"
```

---

### Task 3: Recording loader

**Files:**

- Create: `apps/streaming-demo/src/recording-loader.ts`
- Create: `apps/streaming-demo/src/recording-loader.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/streaming-demo/src/recording-loader.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { parseJsonl } from "./recording-loader";
import type { Phase1Entry, Phase2Entry } from "./types";

describe("parseJsonl", () => {
  test("parses valid JSONL into an array", () => {
    const text =
      '{"t":0.042,"type":"response.output_text.delta","delta":"["}\n' +
      '{"t":0.061,"type":"response.output_text.done"}\n';

    const result = parseJsonl<Phase1Entry>(text);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      t: 0.042,
      type: "response.output_text.delta",
      delta: "[",
    });
    expect(result[1]).toEqual({
      t: 0.061,
      type: "response.output_text.done",
    });
  });

  test("ignores trailing blank lines", () => {
    const text = '{"t":0,"patches":[]}\n\n\n';
    const result = parseJsonl<Phase2Entry>(text);
    expect(result).toHaveLength(1);
  });

  test("throws with line number on malformed JSON", () => {
    const text = '{"t":0}\nnot json\n{"t":2}\n';
    expect(() => parseJsonl(text)).toThrow(/line 2/);
  });

  test("handles empty input", () => {
    expect(parseJsonl("")).toEqual([]);
    expect(parseJsonl("\n\n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/streaming-demo && pnpm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/recording-loader.ts`**

```ts
import type { Phase1Entry, Phase2Entry } from "./types";

export function parseJsonl<T>(text: string): T[] {
  const results: T[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    try {
      results.push(JSON.parse(line) as T);
    } catch (err) {
      throw new Error(
        `Failed to parse JSONL line ${i + 1}: ${(err as Error).message}`,
      );
    }
  }
  return results;
}

export async function loadPhase1(url: string): Promise<Phase1Entry[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return parseJsonl<Phase1Entry>(await res.text());
}

export async function loadPhase2(url: string): Promise<Phase2Entry[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return parseJsonl<Phase2Entry>(await res.text());
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd apps/streaming-demo && pnpm test
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/streaming-demo/src/recording-loader.ts apps/streaming-demo/src/recording-loader.test.ts
git commit -m "feat(streaming-demo): add JSONL recording loader"
```

---

### Task 4: Dev fixture generator

Generates a tiny `phase1.jsonl` + `phase2.jsonl` pair so the rest of the app can be built and tested end-to-end without needing an OpenAI API key. The real capture replaces phase1 at the end.

**Files:**

- Create: `apps/streaming-demo/scripts/make-dev-fixture.ts`

- [ ] **Step 1: Implement `scripts/make-dev-fixture.ts`**

```ts
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
```

- [ ] **Step 2: Run the fixture script**

```bash
cd apps/streaming-demo && pnpm make-dev-fixture
```

Expected: two files exist under `src/recordings/` with non-zero sizes. Peek at `phase1.jsonl` — first line should be `{"t":0,"type":"response.created"}`.

- [ ] **Step 3: Commit the script + fixtures**

```bash
git add apps/streaming-demo/scripts/make-dev-fixture.ts apps/streaming-demo/src/recordings/phase1.jsonl apps/streaming-demo/src/recordings/phase2.jsonl
git commit -m "feat(streaming-demo): add dev fixture generator and initial recordings"
```

---

### Task 5: Replay engine (pure TS)

**Files:**

- Create: `apps/streaming-demo/src/replay-engine.ts`
- Create: `apps/streaming-demo/src/replay-engine.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/streaming-demo/src/replay-engine.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createEngine } from "./replay-engine";
import type { Phase1Entry, Phase2Entry, StockRow } from "./types";

function fakePhase1(): Phase1Entry[] {
  const full = JSON.stringify([
    { id: "AAPL", symbol: "AAPL", name: "Apple", last: 100, change_pct: 1.0, volume: 1000, sector: "Tech", last_update: "14:00:00" },
    { id: "GOOGL", symbol: "GOOGL", name: "Alphabet", last: 140, change_pct: -0.5, volume: 2000, sector: "Tech", last_update: "14:00:00" },
  ]);
  return [
    { t: 0, type: "response.created" },
    { t: 0.1, type: "response.output_text.delta", delta: full },
    { t: 0.2, type: "response.output_text.done" },
  ];
}

function fakePhase2(): Phase2Entry[] {
  return [
    { t: 1.0, patches: [{ id: "AAPL", last: 101 }] },
    { t: 2.0, patches: [{ id: "GOOGL", last: 141 }] },
  ];
}

function collectGridOps(): {
  txs: Array<{
    add?: StockRow[];
    update?: Partial<StockRow>[];
    remove?: string[];
  }>;
  grid: {
    applyTransaction: (tx: {
      add?: StockRow[];
      update?: Partial<StockRow>[];
      remove?: string[];
    }) => void;
  };
} {
  const txs: Array<{
    add?: StockRow[];
    update?: Partial<StockRow>[];
    remove?: string[];
  }> = [];
  return {
    txs,
    grid: {
      applyTransaction(tx) {
        txs.push(tx);
      },
    },
  };
}

describe("replay engine", () => {
  test("advanceTo dispatches phase-1 chunks up to target time", () => {
    const { grid, txs } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    engine.advanceTo(0.3);
    engine.flush();

    // One transaction should have run with the two parsed rows.
    const allAdds = txs.flatMap((t) => t.add ?? []);
    expect(allAdds).toHaveLength(2);
    expect(allAdds[0].symbol).toBe("AAPL");
    expect(allAdds[1].symbol).toBe("GOOGL");
  });

  test("advanceTo dispatches phase-2 batches once the clock reaches t", () => {
    const { grid, txs } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    engine.advanceTo(1.5);
    engine.flush();

    const allUpdates = txs.flatMap((t) => t.update ?? []);
    expect(allUpdates).toEqual([{ id: "AAPL", last: 101 }]);
  });

  test("advanceTo to end dispatches every phase-1 and phase-2 entry", () => {
    const { grid, txs } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    engine.advanceTo(3.0);
    engine.flush();

    const allAdds = txs.flatMap((t) => t.add ?? []);
    const allUpdates = txs.flatMap((t) => t.update ?? []);
    expect(allAdds).toHaveLength(2);
    expect(allUpdates).toHaveLength(2);
  });

  test("seek rewinds and re-replays deterministically", () => {
    const first = collectGridOps();
    const a = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid: first.grid,
    });
    a.advanceTo(3.0);
    a.flush();
    const addsA = first.txs.flatMap((t) => t.add ?? []);
    const updsA = first.txs.flatMap((t) => t.update ?? []);

    const second = collectGridOps();
    const b = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid: second.grid,
    });
    b.advanceTo(0.5);
    b.seek(3.0);
    b.flush();
    const addsB = second.txs.flatMap((t) => t.add ?? []);
    const updsB = second.txs.flatMap((t) => t.update ?? []);

    expect(addsB).toEqual(addsA);
    expect(updsB).toEqual(updsA);
  });

  test("state reflects phase transitions", () => {
    const { grid } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    engine.advanceTo(0.05);
    expect(engine.getState().phase).toBe("fill");

    engine.advanceTo(1.5);
    expect(engine.getState().phase).toBe("live");

    engine.advanceTo(99);
    expect(engine.getState().phase).toBe("done");
  });

  test("subscribe fires when state changes", () => {
    const { grid } = collectGridOps();
    const engine = createEngine({
      phase1: fakePhase1(),
      phase2: fakePhase2(),
      grid,
    });

    let ticks = 0;
    const unsub = engine.subscribe(() => {
      ticks++;
    });

    engine.advanceTo(0.5);
    expect(ticks).toBeGreaterThan(0);

    unsub();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/streaming-demo && pnpm test
```

Expected: FAIL — `replay-engine` module missing.

- [ ] **Step 3: Implement `src/replay-engine.ts`**

```ts
import {
  create,
  push,
  isArrayNode,
  isObjectNode,
  isComplete,
} from "@cacheplane/json-stream";
import type { StreamState } from "@cacheplane/json-stream";
import { createBatcher } from "@pretable-internal/stream-adapter";
import type { TransactionBatcher } from "@pretable-internal/stream-adapter";

import type {
  EngineState,
  ParserSnapshot,
  Phase1Entry,
  Phase2Entry,
  PlaybackSpeed,
  ReplayPhase,
  StockRow,
} from "./types";

const RECENT_EVENT_CAP = 8;

interface EngineOptions {
  phase1: Phase1Entry[];
  phase2: Phase2Entry[];
  grid: {
    applyTransaction(tx: {
      add?: StockRow[];
      update?: Partial<StockRow>[];
      remove?: string[];
    }): void;
  };
  /** For tests — allows synchronous `advanceTo` + `flush` without rAF. */
  disableRaf?: boolean;
}

export interface ReplayEngine {
  getState(): EngineState;
  subscribe(listener: () => void): () => void;
  play(): void;
  pause(): void;
  setSpeed(speed: PlaybackSpeed): void;
  seek(t: number): void;
  /** Test-only: advance clock synchronously and dispatch up to target time. */
  advanceTo(t: number): void;
  /** Test-only: flush pending batcher ops. */
  flush(): void;
  dispose(): void;
}

export function createEngine(options: EngineOptions): ReplayEngine {
  const { phase1, phase2, grid } = options;

  const phase1End = phase1.length > 0 ? phase1[phase1.length - 1].t : 0;
  const phase2End = phase2.length > 0 ? phase2[phase2.length - 1].t : phase1End;
  const totalDuration = Math.max(phase1End, phase2End);

  let parser: StreamState = create();
  let batcher: TransactionBatcher<StockRow> = createBatcher(grid);
  let phase1Index = 0;
  let phase2Index = 0;
  let yieldedChildCount = 0;
  let rowsAdded = 0;
  let patchesApplied = 0;
  let lastPatchBatch: EngineState["lastPatchBatch"] = null;
  const recent: Phase1Entry[] = [];

  let clock = 0;
  let speed: PlaybackSpeed = 1;
  let playing = false;
  let rafId: number | null = null;
  let lastRafTs: number | null = null;

  const listeners = new Set<() => void>();

  function currentPhase(): ReplayPhase {
    if (clock >= totalDuration) return "done";
    if (clock < phase1End) return "fill";
    return "live";
  }

  function computeParserSnapshot(): ParserSnapshot | null {
    if (currentPhase() !== "fill") return null;
    if (parser.rootId === null) {
      return {
        mode: "Value",
        rootKind: "empty",
        topLevelCount: 0,
        topLevelCompleted: 0,
        buildingRow: null,
      };
    }
    const root = parser.nodes[parser.rootId];
    if (!isArrayNode(root)) {
      return {
        mode: "Value",
        rootKind: "other",
        topLevelCount: 0,
        topLevelCompleted: 0,
        buildingRow: null,
      };
    }
    let completed = 0;
    let building: Partial<StockRow> | null = null;
    for (const childId of root.children) {
      const child = parser.nodes[childId];
      if (isComplete(child)) {
        completed++;
      } else if (isObjectNode(child) && child.value) {
        building = child.value as Partial<StockRow>;
      }
    }
    return {
      mode: "StringValue",
      rootKind: "array",
      topLevelCount: root.children.length,
      topLevelCompleted: completed,
      buildingRow: building,
    };
  }

  let cachedState: EngineState | null = null;
  function getState(): EngineState {
    if (cachedState) return cachedState;
    cachedState = {
      clock,
      speed,
      playing,
      phase: currentPhase(),
      totalDuration,
      recentStreamEvents: recent.slice(),
      lastPatchBatch,
      parserSnapshot: computeParserSnapshot(),
      stats: { rowsAdded, patchesApplied },
    };
    return cachedState;
  }

  function notify(): void {
    cachedState = null;
    for (const l of listeners) l();
  }

  function dispatchPhase1Up(toT: number): void {
    while (phase1Index < phase1.length && phase1[phase1Index].t <= toT) {
      const entry = phase1[phase1Index++];
      recent.push(entry);
      if (recent.length > RECENT_EVENT_CAP) recent.shift();

      if (entry.type === "response.output_text.delta") {
        parser = push(parser, entry.delta);
        yieldNewlyCompleteRows();
      }
    }
  }

  function yieldNewlyCompleteRows(): void {
    if (parser.rootId === null) return;
    const root = parser.nodes[parser.rootId];
    if (!isArrayNode(root)) return;
    while (yieldedChildCount < root.children.length) {
      const child = parser.nodes[root.children[yieldedChildCount]];
      if (!isComplete(child)) break;
      if (child.value !== undefined) {
        const row = child.value as Partial<StockRow> & { symbol: string };
        const full: StockRow = {
          id: row.symbol,
          symbol: row.symbol,
          name: row.name ?? "",
          last: row.last ?? 0,
          change_pct: row.change_pct ?? 0,
          volume: row.volume ?? 0,
          sector: row.sector ?? "",
          last_update: row.last_update ?? "",
        };
        batcher.add([full]);
        rowsAdded++;
      }
      yieldedChildCount++;
    }
  }

  function dispatchPhase2Up(toT: number): void {
    while (phase2Index < phase2.length && phase2[phase2Index].t <= toT) {
      const entry = phase2[phase2Index++];
      batcher.update(entry.patches);
      patchesApplied += entry.patches.length;
      lastPatchBatch = {
        size: entry.patches.length,
        sample: entry.patches[0] ?? {},
      };
    }
  }

  function reset(): void {
    batcher.dispose();
    batcher = createBatcher(grid);
    parser = create();
    phase1Index = 0;
    phase2Index = 0;
    yieldedChildCount = 0;
    rowsAdded = 0;
    patchesApplied = 0;
    lastPatchBatch = null;
    recent.length = 0;
  }

  function advanceTo(targetT: number): void {
    if (targetT < clock) {
      reset();
      clock = 0;
    }
    dispatchPhase1Up(targetT);
    dispatchPhase2Up(targetT);
    clock = targetT;
    notify();
  }

  function seek(t: number): void {
    reset();
    clock = 0;
    advanceTo(t);
  }

  function flush(): void {
    batcher.flush();
  }

  function raf(ts: number): void {
    if (lastRafTs === null) {
      lastRafTs = ts;
      rafId = requestAnimationFrame(raf);
      return;
    }
    const dt = ((ts - lastRafTs) / 1000) * speed;
    lastRafTs = ts;
    let next = clock + dt;
    if (next >= totalDuration) {
      next = totalDuration;
      advanceTo(next);
      // Brief visual pause then loop.
      playing = false;
      setTimeout(() => {
        seek(0);
        play();
      }, 1000);
      return;
    }
    advanceTo(next);
    if (playing) rafId = requestAnimationFrame(raf);
  }

  function play(): void {
    if (playing) return;
    playing = true;
    lastRafTs = null;
    if (!options.disableRaf) {
      rafId = requestAnimationFrame(raf);
    }
    notify();
  }

  function pause(): void {
    if (!playing) return;
    playing = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    notify();
  }

  function setSpeed(s: PlaybackSpeed): void {
    speed = s;
    notify();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function dispose(): void {
    pause();
    batcher.dispose();
    listeners.clear();
  }

  return {
    getState,
    subscribe,
    play,
    pause,
    setSpeed,
    seek,
    advanceTo,
    flush,
    dispose,
  };
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd apps/streaming-demo && pnpm test
```

Expected: all 6 replay-engine tests PASS plus the 4 recording-loader tests = 10 total.

- [ ] **Step 5: Commit**

```bash
git add apps/streaming-demo/src/replay-engine.ts apps/streaming-demo/src/replay-engine.test.ts
git commit -m "feat(streaming-demo): implement replay engine with scrub"
```

---

### Task 6: React engine hook

**Files:**

- Create: `apps/streaming-demo/src/use-engine.ts`

- [ ] **Step 1: Implement `src/use-engine.ts`**

```ts
import { useSyncExternalStore } from "react";

import type { ReplayEngine } from "./replay-engine";
import type { EngineState } from "./types";

export function useEngineState(engine: ReplayEngine): EngineState {
  return useSyncExternalStore(
    (cb) => engine.subscribe(cb),
    () => engine.getState(),
    () => engine.getState(),
  );
}
```

- [ ] **Step 2: Verify typecheck**

```bash
cd apps/streaming-demo && pnpm typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/streaming-demo/src/use-engine.ts
git commit -m "feat(streaming-demo): add React hook for engine state"
```

---

### Task 7: Format helpers

**Files:**

- Create: `apps/streaming-demo/src/format.ts`
- Create: `apps/streaming-demo/src/format.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from "vitest";

import { formatChange, formatTime, formatVolume } from "./format";

describe("formatVolume", () => {
  test("B suffix", () => {
    expect(formatVolume(2_500_000_000)).toBe("2.5B");
  });
  test("M suffix", () => {
    expect(formatVolume(48_200_000)).toBe("48.2M");
  });
  test("K suffix", () => {
    expect(formatVolume(12_345)).toBe("12.3K");
  });
  test("bare number", () => {
    expect(formatVolume(500)).toBe("500");
  });
});

describe("formatChange", () => {
  test("positive with plus sign", () => {
    expect(formatChange(2.345)).toBe("+2.35%");
  });
  test("negative with minus", () => {
    expect(formatChange(-0.1)).toBe("-0.10%");
  });
  test("zero", () => {
    expect(formatChange(0)).toBe("+0.00%");
  });
});

describe("formatTime", () => {
  test("pads seconds", () => {
    expect(formatTime(65)).toBe("1:05");
  });
  test("zero", () => {
    expect(formatTime(0)).toBe("0:00");
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd apps/streaming-demo && pnpm test
```

- [ ] **Step 3: Implement `src/format.ts`**

```ts
export function formatVolume(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatChange(pct: number): string {
  const sign = pct >= 0 ? "+" : "-";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Verify tests pass**

```bash
cd apps/streaming-demo && pnpm test
```

Expected: all format tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/streaming-demo/src/format.ts apps/streaming-demo/src/format.test.ts
git commit -m "feat(streaming-demo): add format helpers"
```

---

### Task 8: Grid column definitions

**Files:**

- Create: `apps/streaming-demo/src/columns.ts`

- [ ] **Step 1: Implement `src/columns.ts`**

```ts
import type { PretableColumn } from "@pretable/react";

import { formatChange, formatVolume } from "./format";
import type { StockRow } from "./types";

export const streamingColumns: PretableColumn<StockRow>[] = [
  {
    id: "symbol",
    header: "Symbol",
    width: 80,
    renderCell: (row) => row.symbol,
  },
  {
    id: "name",
    header: "Name",
    width: 200,
    renderCell: (row) => row.name,
  },
  {
    id: "last",
    header: "Last",
    width: 100,
    align: "right",
    renderCell: (row) => row.last.toFixed(2),
  },
  {
    id: "change_pct",
    header: "Change",
    width: 90,
    align: "right",
    renderCell: (row) => ({
      className: row.change_pct >= 0 ? "cell-up" : "cell-down",
      text: formatChange(row.change_pct),
    }),
  },
  {
    id: "volume",
    header: "Volume",
    width: 100,
    align: "right",
    renderCell: (row) => formatVolume(row.volume),
  },
  {
    id: "sector",
    header: "Sector",
    width: 130,
    renderCell: (row) => row.sector,
  },
  {
    id: "last_update",
    header: "Time",
    width: 90,
    align: "right",
    renderCell: (row) => row.last_update,
  },
];
```

**Note:** If `@pretable/react`'s `PretableColumn` doesn't support `align` or the `renderCell` object shape shown above, adapt to the actual exported type. Before moving on, check `packages/react/src/use-pretable.ts` (re-exports `PretableColumn` from `@pretable/core`) and `packages/core/src/types.ts` (`PretableColumn` definition) and align the code to the real shape. A simple text return value is always safe; cell classNames for coloring can be applied via a wrapping `<span>` in the renderer or via CSS selectors on the cell element.

- [ ] **Step 2: Verify typecheck**

```bash
cd apps/streaming-demo && pnpm typecheck
```

If typecheck fails, read the actual `PretableColumn` definition and adapt. Do not commit until typecheck is clean.

- [ ] **Step 3: Commit**

```bash
git add apps/streaming-demo/src/columns.ts
git commit -m "feat(streaming-demo): add stock column definitions"
```

---

### Task 9: Streaming grid component

**Files:**

- Create: `apps/streaming-demo/src/components/streaming-grid.tsx`

- [ ] **Step 1: Implement `src/components/streaming-grid.tsx`**

This component is the bridge between the replay engine (which calls `grid.applyTransaction`) and the Pretable React surface. Key design: the grid is created via `@pretable/core`'s `createGrid` directly (not via `usePretable`, which recreates on row changes), so the engine can hold a stable reference.

```tsx
import { useEffect, useMemo, useRef } from "react";
import { createGrid } from "@pretable/core";
import type { PretableGrid } from "@pretable/core";

import { streamingColumns } from "../columns";
import type { StockRow } from "../types";

interface StreamingGridProps {
  onGridReady: (grid: PretableGrid<StockRow>) => void;
}

export function StreamingGrid({ onGridReady }: StreamingGridProps) {
  const gridRef = useRef<PretableGrid<StockRow> | null>(null);

  const grid = useMemo(
    () =>
      createGrid<StockRow>({
        columns: streamingColumns,
        rows: [],
        getRowId: (row) => row.id,
      }),
    [],
  );

  useEffect(() => {
    gridRef.current = grid;
    onGridReady(grid);
  }, [grid, onGridReady]);

  // TODO(wiring): wire Pretable's React surface here. The exact API depends on
  // what @pretable/react exports publicly. Options:
  //   1. Use <Pretable rows={...} columns={...} /> (re-creates grid; not usable)
  //   2. Use <InspectionGrid grid={grid} /> from @pretable/react/internal
  //   3. Write a thin surface that calls createDomRenderSnapshot directly
  //
  // Before implementing: read packages/react/src/internal.ts and find the
  // surface that accepts an externally-owned grid. If none exists, the correct
  // path is a small local component that uses useSyncExternalStore on
  // grid.subscribe and renders via createDomRenderSnapshot.

  return (
    <div className="streaming-grid-host" data-testid="streaming-grid">
      <div className="stub-grid-notice">
        grid wiring pending — see TODO in streaming-grid.tsx
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Resolve the grid wiring**

Read `packages/react/src/internal.ts` and related files to find the surface component that accepts an externally-owned `grid` instance. Update `streaming-grid.tsx` to render through it.

If no such surface exists publicly, implement a local surface that:

1. Uses `useSyncExternalStore` over `grid.subscribe` / `grid.getSnapshot`
2. Calls `createDomRenderSnapshot` from `@pretable-internal/renderer-dom` to compute the visible rows
3. Renders them with absolute positioning (follow the pattern in `packages/react/src/internal/pretable-surface.tsx`)

Commit only once the grid is actually rendering rows.

- [ ] **Step 3: Verify dev server renders**

```bash
cd apps/streaming-demo && pnpm dev
```

Open in browser. The grid component should mount. At this stage the grid is empty (no engine wired yet) but the surface should render headers and an empty body.

- [ ] **Step 4: Commit**

```bash
git add apps/streaming-demo/src/components/streaming-grid.tsx
git commit -m "feat(streaming-demo): add streaming grid component"
```

---

### Task 10: Transport bar

**Files:**

- Create: `apps/streaming-demo/src/components/transport-bar.tsx`

- [ ] **Step 1: Implement `src/components/transport-bar.tsx`**

```tsx
import { useCallback } from "react";

import type { ReplayEngine } from "../replay-engine";
import { useEngineState } from "../use-engine";
import { formatTime } from "../format";
import type { PlaybackSpeed } from "../types";

interface TransportBarProps {
  engine: ReplayEngine;
}

const SPEED_OPTIONS: PlaybackSpeed[] = [0.5, 1, 2, 4];

export function TransportBar({ engine }: TransportBarProps) {
  const state = useEngineState(engine);

  const onPlayPause = useCallback(() => {
    if (state.playing) engine.pause();
    else engine.play();
  }, [engine, state.playing]);

  const onSeek = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const pct = Number(event.currentTarget.value) / 1000;
      engine.seek(pct * state.totalDuration);
    },
    [engine, state.totalDuration],
  );

  const onSpeed = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      engine.setSpeed(Number(event.currentTarget.value) as PlaybackSpeed);
    },
    [engine],
  );

  const scrubValue =
    state.totalDuration > 0
      ? Math.min(1000, Math.round((state.clock / state.totalDuration) * 1000))
      : 0;

  return (
    <div className="transport-bar">
      <button
        className="transport-play"
        aria-label={state.playing ? "Pause" : "Play"}
        onClick={onPlayPause}
      >
        {state.playing ? "⏸" : "▶"}
      </button>
      <span className="transport-time">
        {formatTime(state.clock)} / {formatTime(state.totalDuration)}
      </span>
      <input
        className="transport-scrub"
        type="range"
        min={0}
        max={1000}
        value={scrubValue}
        onChange={onSeek}
        aria-label="Scrub timeline"
      />
      <span className="transport-phase" data-phase={state.phase}>
        {state.phase}
      </span>
      <select
        className="transport-speed"
        value={state.speed}
        onChange={onSpeed}
        aria-label="Playback speed"
      >
        {SPEED_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 2: Add transport CSS to `theme/bloomberg.css`**

Append to `src/theme/bloomberg.css`:

```css
.transport-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--mono);
  font-size: 12px;
}
.transport-play {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 13px;
}
.transport-play:hover {
  background: var(--border);
}
.transport-time {
  color: var(--muted);
  min-width: 80px;
}
.transport-scrub {
  flex: 1;
  accent-color: var(--accent);
}
.transport-phase {
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  background: var(--border);
  color: var(--muted);
}
.transport-phase[data-phase="fill"] {
  background: rgba(74, 222, 128, 0.15);
  color: var(--up);
}
.transport-phase[data-phase="live"] {
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
}
.transport-speed {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 6px;
  font-family: var(--mono);
  font-size: 11px;
  cursor: pointer;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/streaming-demo/src/components/transport-bar.tsx apps/streaming-demo/src/theme/bloomberg.css
git commit -m "feat(streaming-demo): add transport bar"
```

---

### Task 11: Stream events panel

**Files:**

- Create: `apps/streaming-demo/src/components/stream-events-panel.tsx`

- [ ] **Step 1: Implement `src/components/stream-events-panel.tsx`**

```tsx
import type { ReplayEngine } from "../replay-engine";
import { useEngineState } from "../use-engine";

interface StreamEventsPanelProps {
  engine: ReplayEngine;
}

export function StreamEventsPanel({ engine }: StreamEventsPanelProps) {
  const state = useEngineState(engine);

  if (state.phase === "live" || state.phase === "done") {
    return (
      <div className="inspector-panel">
        <div className="inspector-panel-header">
          Stream events ({state.stats.patchesApplied} patches)
        </div>
        <div className="inspector-panel-body inspector-phase2">
          {state.lastPatchBatch ? (
            <>
              <div className="phase2-badge">
                .patches ({state.lastPatchBatch.size} rows)
              </div>
              <pre className="phase2-sample">
                {JSON.stringify(state.lastPatchBatch.sample, null, 2)}
              </pre>
            </>
          ) : (
            <span className="inspector-dim">awaiting first batch…</span>
          )}
        </div>
      </div>
    );
  }

  const events = state.recentStreamEvents;
  const newest = events.length - 1;

  return (
    <div className="inspector-panel">
      <div className="inspector-panel-header">
        Stream events ({events.length} recent)
      </div>
      <div className="inspector-panel-body">
        {events.map((e, i) => {
          if (e.type === "response.output_text.delta") {
            return (
              <div
                key={i}
                className={`stream-event ${i === newest ? "stream-event-newest" : ""}`}
              >
                <span className="stream-event-type">.delta</span>
                <span className="stream-event-delta">
                  "{escapeForDisplay(e.delta)}"
                </span>
              </div>
            );
          }
          return (
            <div
              key={i}
              className={`stream-event ${i === newest ? "stream-event-newest" : ""}`}
            >
              <span className="stream-event-type stream-event-meta">
                [{e.type.replace("response.", "")}]
              </span>
            </div>
          );
        })}
        {events.length === 0 && (
          <span className="inspector-dim">waiting for first chunk…</span>
        )}
      </div>
    </div>
  );
}

function escapeForDisplay(s: string): string {
  return s.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
```

- [ ] **Step 2: Add panel CSS**

Append to `src/theme/bloomberg.css`:

```css
.inspector-panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
}
.inspector-panel:last-child {
  border-bottom: 0;
}
.inspector-panel-header {
  padding: 6px 12px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  font-weight: 600;
}
.inspector-panel-body {
  padding: 6px 12px;
  font-family: var(--mono);
  font-size: 10px;
  line-height: 1.6;
  overflow: auto;
  flex: 1;
}
.inspector-dim {
  color: var(--dim);
  font-style: italic;
}
.stream-event {
  padding: 1px 3px;
  border-radius: 2px;
  margin-bottom: 1px;
}
.stream-event-newest {
  background: rgba(74, 222, 128, 0.1);
}
.stream-event-type {
  color: var(--muted);
  margin-right: 6px;
}
.stream-event-meta {
  color: var(--accent);
}
.stream-event-delta {
  color: var(--text);
}
.phase2-badge {
  display: inline-block;
  padding: 2px 8px;
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
  border-radius: 10px;
  margin-bottom: 6px;
}
.phase2-sample {
  font-size: 9px;
  color: var(--muted);
  background: var(--bg);
  padding: 6px;
  border-radius: 3px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-all;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/streaming-demo/src/components/stream-events-panel.tsx apps/streaming-demo/src/theme/bloomberg.css
git commit -m "feat(streaming-demo): add stream events panel"
```

---

### Task 12: Parser AST panel

**Files:**

- Create: `apps/streaming-demo/src/components/parser-ast-panel.tsx`

- [ ] **Step 1: Implement `src/components/parser-ast-panel.tsx`**

```tsx
import type { ReplayEngine } from "../replay-engine";
import { useEngineState } from "../use-engine";

interface ParserAstPanelProps {
  engine: ReplayEngine;
}

export function ParserAstPanel({ engine }: ParserAstPanelProps) {
  const state = useEngineState(engine);

  if (state.phase === "live" || state.phase === "done") {
    return (
      <div className="inspector-panel">
        <div className="inspector-panel-header">Parser AST</div>
        <div className="inspector-panel-body">
          <div className="ast-phase2-badge">
            [phase 2 — parser idle, direct updates]
          </div>
          <div className="ast-stats">
            rows added: <strong>{state.stats.rowsAdded}</strong>
          </div>
          <div className="ast-stats">
            patches applied: <strong>{state.stats.patchesApplied}</strong>
          </div>
        </div>
      </div>
    );
  }

  const snap = state.parserSnapshot;

  return (
    <div className="inspector-panel">
      <div className="inspector-panel-header">
        Parser AST
        {snap && <span className="ast-mode-badge">{snap.mode}</span>}
      </div>
      <div className="inspector-panel-body">
        {!snap || snap.rootKind === "empty" ? (
          <span className="inspector-dim">parser idle…</span>
        ) : snap.rootKind === "array" ? (
          <>
            <div>
              array{" "}
              <span className="inspector-dim">
                ({snap.topLevelCompleted} / {snap.topLevelCount} items,
                {snap.topLevelCompleted === snap.topLevelCount
                  ? " complete"
                  : " incomplete"}
                )
              </span>
            </div>
            {snap.buildingRow && (
              <div className="ast-building">
                <div>
                  [{snap.topLevelCompleted}] object{" "}
                  <span className="inspector-dim">(building)</span>
                </div>
                {Object.entries(snap.buildingRow).map(([key, value]) => (
                  <div key={key} className="ast-field">
                    <span className="ast-key">"{key}":</span>{" "}
                    <span className="ast-value">{JSON.stringify(value)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <span className="inspector-dim">
            unexpected root kind: {snap.rootKind}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add AST panel CSS**

Append to `src/theme/bloomberg.css`:

```css
.ast-mode-badge {
  margin-left: 8px;
  padding: 1px 6px;
  background: var(--accent);
  color: #0a0a0f;
  border-radius: 8px;
  font-size: 9px;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
}
.ast-building {
  padding-left: 12px;
  background: rgba(74, 222, 128, 0.05);
  border-left: 2px solid var(--accent);
  margin-top: 4px;
  padding-top: 2px;
  padding-bottom: 2px;
}
.ast-field {
  padding-left: 12px;
}
.ast-key {
  color: var(--muted);
}
.ast-value {
  color: var(--text);
}
.ast-phase2-badge {
  color: #fbbf24;
  margin-bottom: 8px;
}
.ast-stats {
  color: var(--muted);
}
.ast-stats strong {
  color: var(--text);
  font-weight: 600;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/streaming-demo/src/components/parser-ast-panel.tsx apps/streaming-demo/src/theme/bloomberg.css
git commit -m "feat(streaming-demo): add parser AST panel"
```

---

### Task 13: Stream inspector composer

**Files:**

- Create: `apps/streaming-demo/src/components/stream-inspector.tsx`

- [ ] **Step 1: Implement `src/components/stream-inspector.tsx`**

```tsx
import { ParserAstPanel } from "./parser-ast-panel";
import { StreamEventsPanel } from "./stream-events-panel";
import type { ReplayEngine } from "../replay-engine";

interface StreamInspectorProps {
  engine: ReplayEngine;
}

export function StreamInspector({ engine }: StreamInspectorProps) {
  return (
    <>
      <StreamEventsPanel engine={engine} />
      <ParserAstPanel engine={engine} />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/streaming-demo/src/components/stream-inspector.tsx
git commit -m "feat(streaming-demo): add stream inspector composer"
```

---

### Task 14: Wire everything together in `app.tsx`

**Files:**

- Modify: `apps/streaming-demo/src/app.tsx`

- [ ] **Step 1: Replace placeholder with full wiring**

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import type { PretableGrid } from "@pretable/core";

import { StreamingGrid } from "./components/streaming-grid";
import { StreamInspector } from "./components/stream-inspector";
import { TransportBar } from "./components/transport-bar";
import { createEngine, type ReplayEngine } from "./replay-engine";
import { loadPhase1, loadPhase2 } from "./recording-loader";
import type { StockRow } from "./types";

const PHASE1_URL = "/src/recordings/phase1.jsonl";
const PHASE2_URL = "/src/recordings/phase2.jsonl";

export function App() {
  const [loadError, setLoadError] = useState<string | null>(null);
  const [engine, setEngine] = useState<ReplayEngine | null>(null);
  const [grid, setGrid] = useState<PretableGrid<StockRow> | null>(null);
  const [phase1, setPhase1] = useState<Awaited<
    ReturnType<typeof loadPhase1>
  > | null>(null);
  const [phase2, setPhase2] = useState<Awaited<
    ReturnType<typeof loadPhase2>
  > | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [p1, p2] = await Promise.all([
          loadPhase1(PHASE1_URL),
          loadPhase2(PHASE2_URL),
        ]);
        if (cancelled) return;
        setPhase1(p1);
        setPhase2(p2);
      } catch (err) {
        if (!cancelled) {
          setLoadError((err as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onGridReady = useCallback((g: PretableGrid<StockRow>) => {
    setGrid(g);
  }, []);

  useEffect(() => {
    if (!phase1 || !phase2 || !grid) return;
    const e = createEngine({ phase1, phase2, grid });
    setEngine(e);
    e.play();
    return () => {
      e.dispose();
      setEngine(null);
    };
  }, [phase1, phase2, grid]);

  return (
    <div className="app-shell">
      <div className="app-header">
        <span className="app-title">pretable · streaming demo</span>
        <span className="app-meta">
          openai responses · stock ticker replay · prices fictional
        </span>
      </div>
      <div className="app-body">
        <div className="grid-slot">
          <StreamingGrid onGridReady={onGridReady} />
        </div>
        <div className="inspector-slot">
          {engine ? (
            <StreamInspector engine={engine} />
          ) : (
            <div className="inspector-loading">
              {loadError ? `error: ${loadError}` : "loading recordings…"}
            </div>
          )}
        </div>
      </div>
      <div className="transport-slot">
        {engine ? (
          <TransportBar engine={engine} />
        ) : (
          <div className="transport-loading">—</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Append header CSS to `theme/bloomberg.css`**

```css
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.app-title {
  font-weight: 600;
  color: var(--text);
}
.app-meta {
  font-size: 11px;
  color: var(--muted);
}
.inspector-loading,
.transport-loading {
  padding: 12px;
  color: var(--muted);
  font-size: 11px;
  font-style: italic;
}
```

- [ ] **Step 3: Verify dev server runs end-to-end**

```bash
cd apps/streaming-demo && pnpm dev
```

Open in browser. Expected:
- Header visible
- Grid slot renders (empty initially)
- Inspector slot shows "loading recordings…" briefly, then populates
- Transport bar appears with play button highlighted (autoplay on)
- Within ~1 second of load, grid starts filling with rows from the dev fixture
- Scrub bar moves left to right
- After ~1 second (end of dev fixture phase 1), phase indicator flips to "live" and price cells start updating
- Pressing pause halts everything; pressing play resumes
- Dragging scrub backward resets the grid and replays to the new position

- [ ] **Step 4: Commit**

```bash
git add apps/streaming-demo/src/app.tsx apps/streaming-demo/src/theme/bloomberg.css
git commit -m "feat(streaming-demo): wire engine, grid, inspector, transport"
```

---

### Task 15: Phase 2 generator script

**Files:**

- Create: `apps/streaming-demo/scripts/generate-phase2.ts`

- [ ] **Step 1: Implement `scripts/generate-phase2.ts`**

```ts
/**
 * Generates recordings/phase2.jsonl from the seed dataset captured in
 * recordings/phase1.jsonl. Uses a seeded PRNG (mulberry32) so re-runs are
 * byte-identical. Writes ~90s of update batches at ~500 patches/sec, grouped
 * into ~16ms buckets (so ~8 patches per batch).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  create,
  push,
  finish,
  resolve,
} from "@cacheplane/json-stream";

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
```

- [ ] **Step 2: Run the generator**

```bash
cd apps/streaming-demo && pnpm generate-phase2
```

Expected: overwrites `src/recordings/phase2.jsonl` with ~5600 batches.

- [ ] **Step 3: Verify dev server still works after new phase2**

Run `pnpm dev` and confirm the browser demo plays — transitions to phase 2 and shows continuous updates for the full ~90s.

- [ ] **Step 4: Commit**

```bash
git add apps/streaming-demo/scripts/generate-phase2.ts apps/streaming-demo/src/recordings/phase2.jsonl
git commit -m "feat(streaming-demo): add phase 2 generator and regenerate recording"
```

---

### Task 16: Phase 1 capture script

**Files:**

- Create: `apps/streaming-demo/scripts/capture-phase1.ts`

- [ ] **Step 1: Implement `scripts/capture-phase1.ts`**

```ts
/**
 * One-time capture script: calls openai.responses.create() with streaming
 * enabled, records every SSE event with a relative timestamp, writes to
 * recordings/phase1.jsonl. Requires OPENAI_API_KEY env var.
 *
 * Run: pnpm --filter @pretable/app-streaming-demo capture
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import OpenAI from "openai";

const ROOT = join(import.meta.dirname ?? __dirname, "..");
const OUT = join(ROOT, "src", "recordings", "phase1.jsonl");
const MODEL = process.env.OPENAI_MODEL ?? "gpt-5";

if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is required");
  process.exit(1);
}

const PROMPT = `Generate exactly 2500 fictional stock tickers as a single JSON array of objects, output on a single line with no surrounding prose. Fields per object:
- symbol: 4-5 uppercase letters
- name: a realistic company name
- last: number between 1 and 5000, two decimals
- change_pct: number between -10 and 10, two decimals
- volume: integer between 100000 and 100000000
- sector: one of Technology, Healthcare, Financials, Consumer, Energy, Industrials, Materials, Utilities, RealEstate, Communication
- last_update: string HH:MM:SS representing a plausible US market hours time

Output the JSON array only, no prose, no backticks.`;

const openai = new OpenAI();

async function main() {
  console.log(`[capture-phase1] model=${MODEL}`);
  const start = performance.now();
  const lines: string[] = [];

  const stream = await openai.responses.create({
    model: MODEL,
    input: PROMPT,
    stream: true,
  });

  for await (const event of stream) {
    const t = Number(((performance.now() - start) / 1000).toFixed(3));
    if (event.type === "response.output_text.delta") {
      lines.push(
        JSON.stringify({
          t,
          type: "response.output_text.delta",
          delta: event.delta,
        }),
      );
    } else if (
      event.type === "response.created" ||
      event.type === "response.output_text.done" ||
      event.type === "response.completed"
    ) {
      lines.push(JSON.stringify({ t, type: event.type }));
    }
  }

  writeFileSync(OUT, lines.join("\n") + "\n");

  const duration = (performance.now() - start) / 1000;
  const deltas = lines.filter((l) => l.includes("output_text.delta")).length;
  console.log(
    `[capture-phase1] captured ${lines.length} events (${deltas} deltas) in ${duration.toFixed(1)}s`,
  );
}

main().catch((err) => {
  console.error("[capture-phase1] failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Note — do NOT run the capture yet**

This script needs a real OpenAI API key. Capture is the second-to-last task. Commit the script first.

- [ ] **Step 3: Commit**

```bash
git add apps/streaming-demo/scripts/capture-phase1.ts
git commit -m "feat(streaming-demo): add phase 1 OpenAI capture script"
```

---

### Task 17: Run the real capture + regenerate phase 2

This is the only task that requires an `OPENAI_API_KEY`. Skip this task if the key isn't available — the dev fixture is fine for CI and code review. Mark the task as deferred and note it in the PR description.

- [ ] **Step 1: Set env var, run capture**

```bash
export OPENAI_API_KEY=sk-...
cd apps/streaming-demo && pnpm capture
```

Expected output: `[capture-phase1] captured N events (M deltas) in T.Ts`. `src/recordings/phase1.jsonl` is overwritten.

- [ ] **Step 2: Sanity-check the captured file parses**

```bash
node -e '
  const { readFileSync } = require("fs");
  const { create, push, finish, resolve } = await import("@cacheplane/json-stream");
  const lines = readFileSync("src/recordings/phase1.jsonl", "utf8").trim().split("\n").map(JSON.parse);
  const text = lines.filter(l => l.type === "response.output_text.delta").map(l => l.delta).join("");
  let state = create();
  state = push(state, text);
  state = finish(state);
  if (state.error) { console.error("parse error:", state.error); process.exit(1); }
  const rows = resolve(state);
  console.log("rows:", rows.length);
'
```

Expected: `rows: 2500` (or close). If parse error, re-run the capture.

- [ ] **Step 3: Regenerate phase 2 from the real capture**

```bash
cd apps/streaming-demo && pnpm generate-phase2
```

- [ ] **Step 4: Visual QA**

Run `pnpm dev`. Verify:
- Grid fills with 2,500 rows over ~30 s
- Rows look like real ticker data
- Phase transition feels natural
- Phase 2 updates flicker visibly for another ~90 s
- Loop restart is clean
- Scrub forward / back works through both phases

- [ ] **Step 5: Commit**

```bash
git add apps/streaming-demo/src/recordings/phase1.jsonl apps/streaming-demo/src/recordings/phase2.jsonl
git commit -m "chore(streaming-demo): capture real OpenAI phase1 and regenerate phase2"
```

---

### Task 18: README

**Files:**

- Create: `apps/streaming-demo/README.md`

- [ ] **Step 1: Write `apps/streaming-demo/README.md`**

```markdown
# @pretable/app-streaming-demo

Replay-style demo app showing the Pretable streaming adapter feeding a captured OpenAI Responses stream into a grid with a realtime pipeline inspector. Plays a ~30 s LLM table fill followed by ~90 s of continuous price updates, with play / pause / scrub controls.

## Development

\`\`\`
pnpm dev     # Vite dev server
pnpm build   # production build
pnpm test    # unit tests
\`\`\`

The app ships with checked-in recordings at \`src/recordings/phase1.jsonl\` (real OpenAI capture) and \`src/recordings/phase2.jsonl\` (seeded random walk). The app is fully self-contained at runtime — no network calls.

## Regenerating recordings

### Phase 2 (deterministic, no network)

\`\`\`
pnpm generate-phase2
\`\`\`

Reads \`phase1.jsonl\`, seeds a PRNG with \`0xC0FFEE\`, writes 90 s of update batches to \`phase2.jsonl\`. Byte-identical across runs.

### Phase 1 (one-time, needs OpenAI API key)

\`\`\`
export OPENAI_API_KEY=sk-...
pnpm capture
pnpm generate-phase2   # re-derive phase 2 from the new phase 1
\`\`\`

Use \`OPENAI_MODEL=...\` to override the default model (\`gpt-5\`). The script writes every SSE event to \`phase1.jsonl\` with relative timestamps. Capture is non-deterministic — don't re-run unless you're intentionally refreshing the demo content.

### Dev fixture (tiny synthetic data, no network)

\`\`\`
pnpm make-dev-fixture
\`\`\`

Overwrites both recordings with a small synthetic dataset. Useful when resetting to a minimal known-good state during development.
```

- [ ] **Step 2: Commit**

```bash
git add apps/streaming-demo/README.md
git commit -m "docs(streaming-demo): add README"
```

---

### Task 19: Final verification

- [ ] **Step 1: Full workspace tests**

```bash
cd /Users/blove/repos/pretable/.worktrees/streaming-demo && pnpm test
```

Expected: all packages pass, including `@pretable/app-streaming-demo`'s unit tests.

- [ ] **Step 2: Full workspace typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 3: Full workspace lint**

```bash
pnpm lint
```

- [ ] **Step 4: Full workspace format**

```bash
pnpm exec prettier --check .
```

If any file fails, run `pnpm exec prettier --write .` and re-commit.

- [ ] **Step 5: Full workspace build**

```bash
pnpm build
```

Expected: `apps/streaming-demo/dist/` contains production assets.

- [ ] **Step 6: Final smoke test**

\`pnpm --filter @pretable/app-streaming-demo dev\`. Exercise the UI for a full loop. Note any visual polish issues as follow-ups — do not block the PR.
