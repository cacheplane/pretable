# Website Bucket E — Canonical Ski-Racing Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the synthetic event-log hero with a ski-racing live-timing demo (Mt. Bachelor giant slalom). Use `parseElementStream` from `@pretable/stream-adapter` for phase-1 fill; demo four update shapes (split fill, status flip, leaderboard re-rank, commentary tokens). Inside-bezel right sidebar with course-visualization SVG. Three-tier rate envelope (10 / 60 / 250 ev/s). Delete `apps/streaming-demo/` entirely. Sweep all references.

**Spec:** `docs/superpowers/specs/2026-05-04-website-bucket-e-canonical-ski-demo-design.md`
**Branch:** `feat/bucket-e-canonical-ski-demo` (created; spec committed)

**Tech stack:** Next.js 15 + React 19 + Tailwind v4. `@pretable/react`, `@pretable/stream-adapter`. Vanilla CSS modules for new bezel split. Vitest + jsdom. SVG (no SVG libraries; hand-rolled).

---

## Phase 1 — Data scaffolding

### Task 1: `types.ts` — RaceRow interface

**Files:**

- Create: `apps/website/app/components/heroGrid/types.ts`

- [ ] **Step 1: Write the file.**

```ts
export interface RaceRow extends Record<string, unknown> {
  /** Stable row id; matches `bib` for race rows, `tel-{n}` for telemetry rows at HEAVY tier. */
  id: string;
  /** Bib number — 1..30 for race rows, "—" for telemetry rows. */
  bib: number | "—";
  /** Racer display: "Marco Odermatt 🇨🇭" — flag is a Unicode emoji. */
  racer: string;
  /** Intermediate split times in mm:ss.cc format. Empty until racer crosses the gate. */
  gate1: string;
  gate2: string;
  gate3: string;
  /** Final run time. Empty until racer finishes. */
  finish: string;
  /** Signed delta to current leader: "+0.32" / "-0.04" / "LEADER". Empty until racer finishes. */
  delta: string;
  /** Lifecycle: "dns" → "running" → "finished" / "DNF" / "DSQ". */
  status: "dns" | "running" | "finished" | "DNF" | "DSQ";
  /** Race commentary; multiline; streams in token-by-token at PROD+ tiers. */
  notes: string;
}
```

- [ ] **Step 2: Commit.**

```bash
git add apps/website/app/components/heroGrid/types.ts
git commit -m "feat(website): RaceRow type for ski-racing hero demo"
```

### Task 2: `raceColumns.ts` — column definitions + test

**Files:**

- Create: `apps/website/app/components/heroGrid/raceColumns.ts`
- Create: `apps/website/app/components/heroGrid/__tests__/raceColumns.test.ts`

- [ ] **Step 1: Write the test.**

```ts
import { describe, expect, it } from "vitest";

import { raceColumns } from "../raceColumns";

describe("raceColumns", () => {
  it("declares 9 columns", () => {
    expect(raceColumns).toHaveLength(9);
  });

  it("pins bib left", () => {
    const bib = raceColumns.find((c) => c.id === "bib");
    expect(bib?.pinned).toBe("left");
  });

  it("wraps notes column", () => {
    const notes = raceColumns.find((c) => c.id === "notes");
    expect(notes?.wrap).toBe(true);
  });

  it("declares total width of 1000px", () => {
    const total = raceColumns.reduce((sum, c) => sum + (c.widthPx ?? 0), 0);
    expect(total).toBe(1000);
  });
});
```

- [ ] **Step 2: Implement.**

```ts
import type { PretableColumn } from "@pretable/react";
import type { RaceRow } from "./types";

export const raceColumns: PretableColumn<RaceRow>[] = [
  { id: "bib", header: "Bib", widthPx: 50, pinned: "left" },
  { id: "racer", header: "Racer", widthPx: 180 },
  { id: "gate1", header: "G1", widthPx: 70 },
  { id: "gate2", header: "G2", widthPx: 70 },
  { id: "gate3", header: "G3", widthPx: 70 },
  { id: "finish", header: "Finish", widthPx: 90 },
  { id: "delta", header: "Δ", widthPx: 90 },
  { id: "status", header: "Status", widthPx: 100 },
  { id: "notes", header: "Notes", widthPx: 280, wrap: true },
];
```

- [ ] **Step 3: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- raceColumns
```

Expected: 4/4 PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/heroGrid/raceColumns.ts \
        apps/website/app/components/heroGrid/__tests__/raceColumns.test.ts
git commit -m "feat(website): raceColumns — 9-column race grid"
```

### Task 3: Recording generator + checked-in `race.jsonl`

**Files:**

- Create: `apps/website/app/components/heroGrid/scripts/generate-race.ts`
- Create: `apps/website/app/components/heroGrid/scripts/__tests__/generate-race.test.ts`
- Create: `apps/website/app/components/heroGrid/recordings/race.jsonl` (output)

- [ ] **Step 1: Write the determinism test.**

`apps/website/app/components/heroGrid/scripts/__tests__/generate-race.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { generateRaceRecording } from "../generate-race";

describe("generateRaceRecording", () => {
  it("is deterministic — two runs produce byte-identical output", () => {
    const a = generateRaceRecording();
    const b = generateRaceRecording();
    expect(a).toEqual(b);
  });

  it("starts with a phase-1 response.created event", () => {
    const out = generateRaceRecording();
    const firstLine = out.split("\n")[0];
    expect(firstLine).toBeDefined();
    const parsed = JSON.parse(firstLine!);
    expect(parsed.type).toBe("response.created");
  });

  it("contains 30 racers in phase-1 output", () => {
    const out = generateRaceRecording();
    // Reassemble the JSON streamed via response.output_text.delta events
    const lines = out.trim().split("\n").map((l) => JSON.parse(l));
    const phase1Deltas = lines
      .filter((l: { type: string }) => l.type === "response.output_text.delta")
      .map((l: { delta: string }) => l.delta)
      .join("");
    const racers = JSON.parse(phase1Deltas);
    expect(racers).toHaveLength(30);
  });
});
```

- [ ] **Step 2: Implement the generator.**

`apps/website/app/components/heroGrid/scripts/generate-race.ts`:

The script is deterministic (seeded mulberry32 with `0xC0FFEE`). It produces JSONL output with two phases:

- **Phase 1** — emit `response.created`, then ~150–200 `response.output_text.delta` events containing chunks of the JSON-serialized `[ ...30 racers ]`. Chunks are 8–30 chars. Virtual time `t` advances by ~16ms per chunk. End with `response.completed`.
- **Phase 2** — emit transaction-batch entries (`{t, type: "update"|"add"|"commentary", ...}`) describing the race narrative: staggered starts, splits, finishes, leaderboard re-ranks, commentary streams, ~5% DNF, ~1% DSQ.

Public surface:

```ts
/** Deterministic seeded PRNG. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns the full recording text — caller writes it to disk. */
export function generateRaceRecording(): string;

/** When run as a script, write to recordings/race.jsonl. */
if (require.main === module) {
  const text = generateRaceRecording();
  // Write to file using node fs
}
```

The implementation is involved — see §4 of the spec for the recording shape. Implementer is free to keep the code in one file. Bracket the deliverable: byte-identical determinism (test 1) is the success criterion; the narrative density (5% DNF, leaderboard re-ranks at right moments, etc.) is *aspirational* and can be approximated.

The implementer should derive a 30-name racer list (real GS skiers like Marco Odermatt 🇨🇭, Henrik Kristoffersen 🇳🇴, etc., or synthesized — either is fine; deterministic is the only hard constraint). Country flag emojis bake into the racer string.

Targets: phase 1 ~30KB, phase 2 ~150KB. Total raw recording ~180KB; gzip drops to ~25KB. If the implementation overshoots, that's OK — we cap at ~300KB raw.

- [ ] **Step 3: Run tests + generate the recording.**

```bash
pnpm --filter @pretable/app-website test -- generate-race
# Then run the generator to emit the file:
pnpm --filter @pretable/app-website exec tsx app/components/heroGrid/scripts/generate-race.ts
# Verify the file exists and is reasonable size:
wc -l apps/website/app/components/heroGrid/recordings/race.jsonl
ls -la apps/website/app/components/heroGrid/recordings/race.jsonl
```

Expected: 3/3 tests PASS. Recording file ~100–300KB, ~3000+ lines.

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/heroGrid/scripts/ \
        apps/website/app/components/heroGrid/recordings/race.jsonl
git commit -m "feat(website): deterministic race recording + generator"
```

---

## Phase 2 — Replay engine

### Task 4: `replay-engine.ts` + tests

**Files:**

- Create: `apps/website/app/components/heroGrid/replay-engine.ts`
- Create: `apps/website/app/components/heroGrid/__tests__/replay-engine.test.ts`

- [ ] **Step 1: Write the test (focused on parsing + dispatch + rate scaling).**

```ts
import { describe, expect, it, vi } from "vitest";

import { createRaceReplay } from "../replay-engine";
import type { RaceRow } from "../types";

const TINY_RECORDING = [
  '{"t":0,"type":"response.created"}',
  '{"t":0.1,"type":"response.output_text.delta","delta":"[{\\"id\\":\\"r-001\\",\\"bib\\":1,\\"racer\\":\\"A\\",\\"status\\":\\"dns\\",\\"gate1\\":\\"\\",\\"gate2\\":\\"\\",\\"gate3\\":\\"\\",\\"finish\\":\\"\\",\\"delta\\":\\"\\",\\"notes\\":\\"\\"}]"}',
  '{"t":0.2,"type":"response.completed"}',
  '{"t":1.0,"type":"update","patches":[{"id":"r-001","status":"running"}]}',
  '{"t":2.0,"type":"update","patches":[{"id":"r-001","gate1":"14.32"}]}',
].join("\n");

describe("createRaceReplay", () => {
  it("parses phase-1 SSE deltas via parseElementStream and dispatches add() for each row", async () => {
    const onTransaction = vi.fn();
    const replay = createRaceReplay({
      recording: TINY_RECORDING,
      ratePerSec: 60,
      isPlaying: true,
      onTransaction,
    });
    // Allow microtasks to flush phase-1 parsing
    await new Promise((r) => setTimeout(r, 50));
    expect(onTransaction).toHaveBeenCalled();
    const adds = onTransaction.mock.calls
      .map((c) => c[0])
      .filter((tx: { add?: RaceRow[] }) => tx.add);
    expect(adds.length).toBeGreaterThanOrEqual(1);
    replay.dispose();
  });

  it("setRate() scales virtual-time playback", () => {
    const onTransaction = vi.fn();
    const replay = createRaceReplay({
      recording: TINY_RECORDING,
      ratePerSec: 60,
      isPlaying: true,
      onTransaction,
    });
    // Should not throw and updates the internal rate
    replay.setRate(250);
    replay.setRate(10);
    replay.dispose();
  });

  it("setPlaying(false) pauses dispatch", () => {
    const onTransaction = vi.fn();
    const replay = createRaceReplay({
      recording: TINY_RECORDING,
      ratePerSec: 60,
      isPlaying: true,
      onTransaction,
    });
    replay.setPlaying(false);
    onTransaction.mockClear();
    // Wait — should not dispatch while paused
    return new Promise((r) => setTimeout(r, 100)).then(() => {
      expect(onTransaction).not.toHaveBeenCalled();
      replay.dispose();
    });
  });
});
```

- [ ] **Step 2: Implement.**

The engine has two modes:

**Phase 1**: parse SSE-shaped JSON-text-delta events out of the recording prefix until `response.completed`. Pipe the assembled text through `parseElementStream` from `@pretable/stream-adapter`. For each row that materializes, dispatch `onTransaction({ add: [row] })`.

**Phase 2**: parse remaining lines as transaction batches. Schedule them on virtual time (t-seconds since start of phase 2). The schedule is rate-scaled: at PROD (60 ev/s) virtual time = wall time. At LIGHT (10 ev/s) virtual time advances 6× slower (more dramatic). At HEAVY (250 ev/s) virtual time advances ~4× faster (more intense). Implementer chooses the exact scaling.

Use `requestAnimationFrame` for tick scheduling. Dispatch all events whose virtual time ≤ current virtual time per tick. When the recording finishes, loop: rewind to start, regenerate row IDs (`r-001`-2 → `r-001-3` etc., or just reuse — old rows scroll out of the buffer first).

**Telemetry synthesis (HEAVY tier only):** When rate is 250, additionally emit synthesized telemetry rows from a seeded PRNG every 1000/250 = 4ms. Row shape: `{id: "tel-{seq}", bib: "—", racer: "Sensor: gate N <metric>", status: "running", gate1/2/3/finish/delta: "", notes: "<reading>"}`. Telemetry rows are one-shot adds (`onTransaction({ add: [row] })`) — never updated. They scroll past quickly.

Public API per the spec §4:

```ts
import { parseElementStream } from "@pretable/stream-adapter";
import type { RaceRow } from "./types";

export type RaceRate = 10 | 60 | 250;

export interface RaceReplayOptions {
  recording: string;
  ratePerSec: RaceRate;
  isPlaying: boolean;
  onTransaction: (tx: {
    add?: RaceRow[];
    update?: Partial<RaceRow>[];
  }) => void;
}

export interface RaceReplay {
  setRate(rate: RaceRate): void;
  setPlaying(playing: boolean): void;
  dispose(): void;
}

export function createRaceReplay(options: RaceReplayOptions): RaceReplay {
  // Parse phase-1 SSE deltas via parseElementStream → dispatch adds
  // Parse phase-2 lines into a scheduled queue
  // rAF loop: dispatch events whose virtual time ≤ current virtual time
  // Telemetry synthesis when ratePerSec === 250
  // ...
}
```

The implementer needs to read `parseElementStream`'s docs at `apps/website/app/docs/streaming/parsers/page.mdx` and the source at `packages/stream-adapter/src/parse-element-stream.ts` to use it correctly.

- [ ] **Step 3: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- replay-engine
```

Expected: 3/3 PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/heroGrid/replay-engine.ts \
        apps/website/app/components/heroGrid/__tests__/replay-engine.test.ts
git commit -m "feat(website): race replay engine with parseElementStream phase-1"
```

---

## Phase 3 — Course visualization

### Task 5: `<CourseVisualization>` component + tests

**Files:**

- Create: `apps/website/app/components/heroGrid/CourseVisualization.tsx`
- Create: `apps/website/__tests__/components/heroGrid/CourseVisualization.test.tsx`

- [ ] **Step 1: Write the test.**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CourseVisualization } from "../../../app/components/heroGrid/CourseVisualization";
import type { RaceRow } from "../../../app/components/heroGrid/types";

const baseRow: RaceRow = {
  id: "r-001",
  bib: 1,
  racer: "Test Racer",
  gate1: "",
  gate2: "",
  gate3: "",
  finish: "",
  delta: "",
  status: "dns",
  notes: "",
};

describe("CourseVisualization", () => {
  it("renders an SVG root with data-testid", () => {
    render(<CourseVisualization rows={[]} />);
    expect(screen.getByTestId("course-viz")).toBeInTheDocument();
  });

  it("renders 5 gate-tick labels", () => {
    render(<CourseVisualization rows={[]} />);
    for (const label of ["G1", "G2", "G3", "G4", "FIN"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders one dot per running racer", () => {
    const rows: RaceRow[] = [
      { ...baseRow, id: "r-001", status: "running", gate1: "14.32" },
      { ...baseRow, id: "r-002", status: "running" },
    ];
    const { container } = render(<CourseVisualization rows={rows} />);
    const dots = container.querySelectorAll("[data-testid='racer-dot']");
    expect(dots.length).toBe(2);
  });

  it("marks the leader's dot with an accent ring", () => {
    const rows: RaceRow[] = [
      { ...baseRow, id: "r-001", status: "running", delta: "LEADER" },
    ];
    const { container } = render(<CourseVisualization rows={rows} />);
    const leaderDot = container.querySelector("[data-leader='true']");
    expect(leaderDot).not.toBeNull();
  });
});
```

- [ ] **Step 2: Implement.**

```tsx
import type { RaceRow } from "./types";

interface CourseVisualizationProps {
  rows: RaceRow[];
}

const VIEWBOX_W = 100;
const VIEWBOX_H = 600;

const GATES = [
  { id: "G1", y: 120 },
  { id: "G2", y: 240 },
  { id: "G3", y: 360 },
  { id: "G4", y: 460 },
  { id: "FIN", y: 560 },
] as const;

function computeRacerY(row: RaceRow): number {
  if (row.gate3) return interpolate(GATES[2].y, GATES[4].y);
  if (row.gate2) return interpolate(GATES[1].y, GATES[2].y);
  if (row.gate1) return interpolate(GATES[0].y, GATES[1].y);
  return interpolate(40, GATES[0].y);
}

function interpolate(top: number, bottom: number): number {
  // Place the dot in the middle of the bracket; could be enhanced with
  // gateCrossedAt timestamps for smoother animation.
  return (top + bottom) / 2;
}

function dotColor(bib: number | "—"): string {
  if (bib === "—") return "#9ca3af";
  // Deterministic palette from bib
  const palette = ["#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0891b2", "#2563eb", "#7c3aed", "#db2777"];
  return palette[(bib as number) % palette.length]!;
}

export function CourseVisualization({ rows }: CourseVisualizationProps) {
  const inFlight = rows.filter((r) => r.status === "running");

  return (
    <svg
      data-testid="course-viz"
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%" }}
      aria-label="Course visualization"
    >
      <title>Mt. Bachelor giant slalom course</title>
      {/* Slope background */}
      <rect x="0" y="0" width={VIEWBOX_W} height={VIEWBOX_H} fill="var(--pt-bg-card)" />
      {/* Course line — shallow S-curves */}
      <path
        d={`M50 20 C 30 100, 70 200, 50 300 S 30 480, 50 580`}
        stroke="var(--pt-accent-deep, #ea580c)"
        strokeWidth="1.5"
        fill="none"
        opacity="0.5"
      />
      {/* Gate ticks + labels */}
      {GATES.map((gate) => (
        <g key={gate.id}>
          <line x1="35" y1={gate.y} x2="65" y2={gate.y} stroke="var(--pt-rule, #d6d3d1)" strokeWidth="1" />
          <text x="80" y={gate.y + 4} fontSize="9" fontFamily="ui-monospace" fill="var(--pt-text-muted, #57534e)">
            {gate.id}
          </text>
        </g>
      ))}
      {/* Racer dots */}
      {inFlight.map((row) => {
        const cy = computeRacerY(row);
        const isLeader = row.delta === "LEADER";
        return (
          <circle
            key={row.id}
            data-testid="racer-dot"
            data-leader={isLeader}
            cx={50}
            cy={cy}
            r={isLeader ? 7 : 6}
            fill={dotColor(row.bib)}
            stroke={isLeader ? "var(--pt-accent, #ea580c)" : "none"}
            strokeWidth={isLeader ? 2 : 0}
          />
        );
      })}
    </svg>
  );
}
```

- [ ] **Step 3: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- CourseVisualization
```

Expected: 4/4 PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/heroGrid/CourseVisualization.tsx \
        apps/website/__tests__/components/heroGrid/CourseVisualization.test.tsx
git commit -m "feat(website): CourseVisualization SVG sidebar"
```

---

## Phase 4 — Tier change + HeroGrid rewrite

### Task 6: `controlState.tsx` rate tier change

**Files:**

- Modify: `apps/website/app/components/heroGrid/controlState.tsx`
- Modify: `apps/website/app/components/heroGrid/__tests__/controlState.test.tsx`

- [ ] **Step 1: Update controlState.**

Change `RateTier` type:

```ts
export type RateTier = 10 | 60 | 250;
```

Default value:

```ts
const [ratePerSec, setRatePerSec] = useState<RateTier>(60);
```

- [ ] **Step 2: Update tests.**

Replace `1000` / `5000` literals with `60` / `250` in assertions; update default-value test:

```ts
expect(result.current.ratePerSec).toBe(60);
```

```ts
act(() => result.current.setRatePerSec(250));
expect(result.current.ratePerSec).toBe(250);
```

- [ ] **Step 3: Run tests.**

```bash
pnpm --filter @pretable/app-website test -- controlState
```

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/heroGrid/controlState.tsx \
        apps/website/app/components/heroGrid/__tests__/controlState.test.tsx
git commit -m "feat(website): rate envelope to 10/60/250 ev/s"
```

### Task 7: `TopControlBar.tsx` TIERS + tests

**Files:**

- Modify: `apps/website/app/components/TopControlBar.tsx`
- Modify: `apps/website/app/components/__tests__/TopControlBar.test.tsx`

- [ ] **Step 1: Update TIERS.**

```ts
const TIERS: { value: RateTier; label: string }[] = [
  { value: 10, label: "Light" },
  { value: 60, label: "Production" },
  { value: 250, label: "Heavy" },
];
```

(Drops "Extreme" entry.)

- [ ] **Step 2: Optional eyebrow copy change.**

Either keep `pretable.ai · events.stream` or change to `pretable.ai · live.race-feed`. Implementer's choice — both are reasonable. Lean toward keeping the existing eyebrow to minimize copy churn; the data shift to ski-racing is conveyed by the column headers.

- [ ] **Step 3: Update tests.**

The TopControlBar test passes literal `eventsPerSec={1000}` and `p95Ms={9.3}` as sample props — those are decoupled from real tier values. But the test that asserts the tier-button "Heavy" exists at value `5000` (`getByRole("radio", { name: /heavy/i })` followed by setting state) needs verification — `Heavy` now maps to `250`, not `5000`. The radio click test should still work; just verify state asserts on `250` if that test exists.

Run:

```bash
pnpm --filter @pretable/app-website test -- TopControlBar
```

Fix any failures. Expected: all tests PASS.

- [ ] **Step 4: Commit.**

```bash
git add apps/website/app/components/TopControlBar.tsx \
        apps/website/app/components/__tests__/TopControlBar.test.tsx
git commit -m "feat(website): TopControlBar — 3 tiers (drop Extreme)"
```

### Task 8: HeroGrid rewrite + CSS module update

**Files:**

- Modify: `apps/website/app/components/HeroGrid.tsx`
- Modify: `apps/website/app/components/heroGrid/heroGrid.module.css`
- Modify: `apps/website/app/components/__tests__/HeroGrid.test.tsx`

- [ ] **Step 1: Update HeroGrid.tsx.**

Replace contents (preserving the existing ResizeObserver/ jsdom-fallback pattern from Bucket B):

```tsx
"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pretable } from "@pretable/react";

import { CourseVisualization } from "./heroGrid/CourseVisualization";
import { useControlState } from "./heroGrid/controlState";
import { raceColumns } from "./heroGrid/raceColumns";
import { createRaceReplay, type RaceReplay } from "./heroGrid/replay-engine";
import recordingText from "./heroGrid/recordings/race.jsonl?raw";
import styles from "./heroGrid/heroGrid.module.css";
import type { RaceRow } from "./heroGrid/types";

const FALLBACK_VIEWPORT_HEIGHT = 520;
const VISIBLE_BUFFER_ROWS = 200;

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<RaceRow[]>([]);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const replayRef = useRef<RaceReplay | null>(null);
  const rowMapRef = useRef<Map<string, RaceRow>>(new Map());

  // ResizeObserver to size viewportHeight (existing pattern from Bucket B).
  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let pending: { add: RaceRow[]; updates: Partial<RaceRow>[] } = {
      add: [],
      updates: [],
    };
    let raf = 0;

    const replay = createRaceReplay({
      recording: recordingText,
      ratePerSec,
      isPlaying,
      onTransaction: (tx) => {
        if (tx.add) pending.add.push(...tx.add);
        if (tx.update) pending.updates.push(...tx.update);
      },
    });
    replayRef.current = replay;

    const tick = () => {
      if (pending.add.length > 0 || pending.updates.length > 0) {
        const batch = pending;
        pending = { add: [], updates: [] };
        setRows((prev) => {
          const map = rowMapRef.current;
          // Apply adds
          for (const row of batch.add) {
            map.set(row.id, row);
          }
          // Apply updates
          for (const patch of batch.updates) {
            const id = patch.id as string;
            const existing = map.get(id);
            if (existing) {
              map.set(id, { ...existing, ...patch });
            }
          }
          // Materialize ordered rows (most-recent first OR by bib for race rows)
          const all = Array.from(map.values());
          // Race rows by bib ascending; telemetry rows newest first.
          const raceRows = all.filter((r) => r.bib !== "—").sort((a, b) => (a.bib as number) - (b.bib as number));
          const telRows = all.filter((r) => r.bib === "—").reverse();
          return [...raceRows, ...telRows].slice(0, VISIBLE_BUFFER_ROWS);
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      replay.dispose();
    };
  }, []); // mount-once; rate/play changes flow through refs below

  useEffect(() => {
    replayRef.current?.setRate(ratePerSec);
  }, [ratePerSec]);

  useEffect(() => {
    replayRef.current?.setPlaying(isPlaying);
  }, [isPlaying]);

  return (
    <section className={`hero ${styles.heroBackdrop}`}>
      <div className={styles.heroBezel} data-testid="hero-bezel">
        <div className={styles.heroSplit}>
          <div className={styles.heroSurface} ref={surfaceRef}>
            <Pretable<RaceRow>
              ariaLabel="Live ski racing"
              columns={raceColumns}
              getRowId={(row) => row.id}
              rows={rows}
              viewportHeight={viewportHeight}
            />
          </div>
          <div className={styles.heroSidebar}>
            <CourseVisualization rows={rows} />
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Update heroGrid.module.css.**

Add `.heroSplit`, `.heroSurface` (as flex child), `.heroSidebar`:

```css
.heroSplit {
  display: flex;
  height: 100%;
  width: 100%;
}

.heroSurface {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  overflow: hidden;
}

.heroSidebar {
  flex: 0 0 300px;
  border-left: 1px solid var(--pt-rule);
  background: var(--pt-bg-page);
  display: flex;
  align-items: stretch;
  justify-content: center;
}

@media (max-width: 767px) {
  .heroSidebar {
    display: none;
  }
}
```

(Existing `.heroBackdrop`, `.heroBezel` rules stay.)

- [ ] **Step 3: Update HeroGrid test.**

The existing test should validate:

- Bezel structural element renders (existing assertion stays)
- After replay tick, race rows materialize (replace synthetic-event assertions)
- ResizeObserver fallback works (existing assertion stays)

If the test asserts specific row content (e.g., a particular event kind), update to check for ski-racing context: column header presence (`Bib`, `Racer`, `G1`, …), or any row materializing within a small async wait.

Use `vi.useFakeTimers()` if needed to control rAF.

- [ ] **Step 4: Verify Vite/Next handles `?raw` import.**

Next.js with Turbopack supports `?raw` imports. If the build fails, use `fs.readFileSync(path.join(process.cwd(), "app/components/heroGrid/recordings/race.jsonl"), "utf8")` at module-init time as a server component, then pass the text down — but this changes architecture (server boundary), so prefer fixing the `?raw` import first.

For Next 16 / Turbopack: `?raw` imports may need a `next.config.ts` setting. Check by running `pnpm --filter @pretable/app-website build` and reading errors. If `?raw` doesn't resolve, fall back to a Node-side import: read the file with `fs.readFileSync` in a server component, pass to the client component as a prop.

- [ ] **Step 5: Run tests + build.**

```bash
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website build
```

All must pass. The build is the canary for `?raw` resolution.

- [ ] **Step 6: Commit.**

```bash
git add apps/website/app/components/HeroGrid.tsx \
        apps/website/app/components/heroGrid/heroGrid.module.css \
        apps/website/app/components/__tests__/HeroGrid.test.tsx
git commit -m "feat(website): HeroGrid uses race replay + course sidebar"
```

---

## Phase 5 — Sweep references + delete streaming-demo

### Task 9: Update getting-started + CodeExample references

**Files:**

- Modify: `apps/website/app/docs/getting-started/page.mdx`
- Modify: `apps/website/app/docs/getting-started/concepts/page.mdx`
- Modify: `apps/website/app/components/CodeExample.tsx`

- [ ] **Step 1: Find references.**

```bash
grep -rln "streaming-demo\|app-streaming-demo" apps/website/ 2>/dev/null
```

- [ ] **Step 2: Update each file.**

For each match: replace links / mentions of `apps/streaming-demo` with `/docs/streaming` (the docs that landed in Bucket D), or remove the link entirely if the surrounding sentence loses meaning. Implementer's judgment per file.

The current `<CodeExample>` likely has a footer-link block like `Full example: apps/streaming-demo →`. Change to `Full example: /docs/streaming →` linking to `/docs/streaming`.

- [ ] **Step 3: Verify no remaining references.**

```bash
grep -rln "streaming-demo" apps/website/ 2>/dev/null
```

Should return empty.

- [ ] **Step 4: Commit.**

```bash
git add -A
git commit -m "docs(website): drop streaming-demo references; point at /docs/streaming"
```

### Task 10: Delete `apps/streaming-demo/` + lockfile + remaining sweeps

**Files:**

- Delete: `apps/streaming-demo/` (entire directory)
- Modify: `pnpm-lock.yaml`
- Modify: `pnpm-workspace.yaml` if it lists `apps/streaming-demo` explicitly (probably uses globs; verify)

- [ ] **Step 1: Verify nothing else references the workspace.**

```bash
grep -rln "@pretable/app-streaming-demo\|app-streaming-demo" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.mdx" 2>/dev/null | grep -v node_modules | grep -v "docs/superpowers/"
```

Expected: empty (we just swept docs/components in Task 9).

- [ ] **Step 2: Delete the directory.**

```bash
git rm -rf apps/streaming-demo
```

- [ ] **Step 3: Refresh install.**

```bash
pnpm install
```

This removes the workspace from the lockfile.

- [ ] **Step 4: Verify gates.**

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm build
pnpm -r --filter '@pretable/{core,react}' --filter '@cacheplane/json-stream' lint:packaging
```

If anything breaks, fix it before committing.

- [ ] **Step 5: Commit.**

```bash
git add -A
git commit -m "chore(website): remove apps/streaming-demo (replaced by canonical hero)"
```

### Task 11: Final clean-up + format pass if needed

```bash
pnpm format
```

If it warns, run `pnpm format:write` and commit:

```bash
git add -A
git commit -m "chore(website): prettier pass for bucket E"
```

(Skip if no changes.)

---

## Phase 6 — Manual verification + ship

### Task 12: Manual visual verification

- [ ] Run dev server:

```bash
pnpm --filter @pretable/app-website dev
```

- [ ] Visit `http://localhost:3000`. Verify:
  - Hero shows the bezel + grid + course sidebar
  - Race rows materialize (Bib / Racer / G1 / G2 / G3 / Finish / Δ / Status / Notes columns)
  - Splits arrive, status flips, leaderboard re-ranks happen
  - Course sidebar shows ≥1 racer dot during peak in-flight
  - Pause stops the stream; play resumes
  - Tier slider cycles `Light / Production / Heavy`
  - Heavy synthesizes telemetry rows (`bib: —`)
  - No console errors
  - Mobile width (resize): sidebar hides, grid takes full bezel

- [ ] Capture a screenshot at 1280×800 (chromium) for the PR body.

### Task 13: Push, open PR, watch CI, merge on green

- [ ] Push:

```bash
git push -u origin feat/bucket-e-canonical-ski-demo
```

- [ ] Open PR titled `feat(website): bucket E — canonical ski-racing demo + streaming-demo removal`. Body covers:
  - Spec link
  - Summary of what changed (delete streaming-demo, ski-racing hero, course sidebar, 3-tier rate envelope)
  - Verification matrix
  - Screenshot

- [ ] Watch CI: `gh pr checks <num> --watch`.
- [ ] Merge: `gh pr merge <num> --squash --delete-branch`.
- [ ] Verify production deploy + smoke pass.
- [ ] Verify `https://pretable.ai/` shows the ski demo.
