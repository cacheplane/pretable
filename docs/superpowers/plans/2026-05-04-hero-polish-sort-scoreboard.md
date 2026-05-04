# Hero Polish (Sort, Scoreboard, Leader Highlight) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the homepage HeroGrid into a coherent live race demo: rank-sorted leaderboard with column-header sort wiring, leader row highlight, unwrapped notes column, and a vertical Scoreboard sidebar replacing the SVG course curve.

**Architecture:** A pure `sort.ts` module computes leaderboard rank and per-column comparators. `HeroGrid.tsx` holds `userSort` state, derives sorted rows via `useMemo`, wires `<PretableSurface>`'s `sort`/`onSortChange`/`getRowClassName` props, and swaps `<CourseVisualization>` for a new `<Scoreboard>` that derives its view-model from the same `rows` array. The race recording is regenerated to drop the `··············` placeholder and cap commentary text length, sidestepping the existing `@pretable/react` row-height drift bug at the data layer.

**Tech Stack:** React 19, Next.js 16, TypeScript, Vitest, jsdom, @testing-library/react, @pretable/react, Tailwind v4 (apps only — package CSS stays vanilla per CLAUDE.md), CSS modules.

**Spec:** [`docs/superpowers/specs/2026-05-04-hero-polish-sort-scoreboard-design.md`](../specs/2026-05-04-hero-polish-sort-scoreboard-design.md)

**Working directory:** All paths below are relative to the repo root `/Users/blove/repos/pretable/.worktrees/website-redesign/`.

**Test command:** `pnpm --filter @pretable/app-website test -- <pattern>`

---

## File Structure

```
apps/website/app/components/
├── HeroGrid.tsx                        (MODIFY: sort state, scoreboard swap, leader highlight)
└── heroGrid/
    ├── raceColumns.ts                  (MODIFY: notes.wrap = false)
    ├── sort.ts                         (CREATE: rank + per-column comparators)
    ├── Scoreboard.tsx                  (CREATE: vertical scoreboard sidebar)
    ├── CourseVisualization.tsx         (DELETE)
    ├── heroGrid.module.css             (MODIFY: .leaderRow class)
    ├── recordings/race.jsonl           (REGEN via script)
    ├── recordings/race.ts              (REGEN via script)
    ├── scripts/generate-race.ts        (MODIFY: drop placeholder, shorten commentary)
    └── __tests__/
        └── sort.test.ts                (CREATE)

apps/website/__tests__/components/heroGrid/
├── Scoreboard.test.tsx                 (CREATE)
└── CourseVisualization.test.tsx        (DELETE)
```

---

## Task 1: Sort utility — leaderboard rank

**Files:**

- Create: `apps/website/app/components/heroGrid/sort.ts`
- Test: `apps/website/app/components/heroGrid/__tests__/sort.test.ts`

The default rank order with no user sort: finished racers by finish-time asc (LEADER first), then running racers by gate progress desc, then DNF/DSQ in original order, then DNS by bib asc.

- [ ] **Step 1: Write failing tests for `rankRows`**

Create `apps/website/app/components/heroGrid/__tests__/sort.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { rankRows } from "../sort";
import type { RaceRow } from "../types";

const make = (over: Partial<RaceRow>): RaceRow => ({
  id: over.id ?? "x",
  bib: over.bib ?? 0,
  racer: "Test",
  gate1: "",
  gate2: "",
  gate3: "",
  finish: "",
  delta: "",
  status: "dns",
  notes: "",
  ...over,
});

describe("rankRows", () => {
  it("orders finished by finish time asc with LEADER first", () => {
    const rows: RaceRow[] = [
      make({
        id: "a",
        bib: 1,
        status: "finished",
        finish: "01:18.00",
        delta: "+1.50",
      }),
      make({
        id: "b",
        bib: 2,
        status: "finished",
        finish: "01:16.50",
        delta: "LEADER",
      }),
      make({
        id: "c",
        bib: 3,
        status: "finished",
        finish: "01:17.20",
        delta: "+0.70",
      }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("orders running by gate progress desc, then latest gate time asc", () => {
    const rows: RaceRow[] = [
      make({ id: "early", bib: 1, status: "running", gate1: "00:14.50" }),
      make({
        id: "late",
        bib: 2,
        status: "running",
        gate1: "00:14.30",
        gate2: "00:36.00",
        gate3: "00:55.00",
      }),
      make({
        id: "mid",
        bib: 3,
        status: "running",
        gate1: "00:14.40",
        gate2: "00:36.10",
      }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["late", "mid", "early"]);
  });

  it("places finished above running, running above DNF, DNF above DNS", () => {
    const rows: RaceRow[] = [
      make({ id: "dns", bib: 1 }),
      make({ id: "dnf", bib: 2, status: "DNF" }),
      make({ id: "running", bib: 3, status: "running", gate1: "00:14.00" }),
      make({
        id: "finished",
        bib: 4,
        status: "finished",
        finish: "01:16.00",
        delta: "LEADER",
      }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual([
      "finished",
      "running",
      "dnf",
      "dns",
    ]);
  });

  it("orders DNS by bib ascending", () => {
    const rows: RaceRow[] = [
      make({ id: "c", bib: 30 }),
      make({ id: "a", bib: 1 }),
      make({ id: "b", bib: 15 }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks running ties on gate progress by bib ascending", () => {
    const rows: RaceRow[] = [
      make({
        id: "high",
        bib: 30,
        status: "running",
        gate1: "00:14.00",
        gate2: "00:36.00",
      }),
      make({
        id: "low",
        bib: 5,
        status: "running",
        gate1: "00:14.00",
        gate2: "00:36.00",
      }),
    ];
    // same gate2 time → bib ascending tie-break
    expect(rankRows(rows).map((r) => r.id)).toEqual(["low", "high"]);
  });

  it("sinks telemetry rows (bib === '—') to the bottom of their tier", () => {
    const rows: RaceRow[] = [
      make({
        id: "tel-1",
        bib: "—",
        status: "running",
        racer: "Sensor: gate 4 wind",
      }),
      make({ id: "race-1", bib: 5, status: "running", gate1: "00:14.00" }),
    ];
    expect(rankRows(rows).map((r) => r.id)).toEqual(["race-1", "tel-1"]);
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @pretable/app-website test -- sort.test`
Expected: FAIL — `Cannot find module '../sort'`.

- [ ] **Step 3: Implement `rankRows`**

Create `apps/website/app/components/heroGrid/sort.ts`:

```ts
import type { RaceRow } from "./types";

const STATUS_TIER: Record<RaceRow["status"], number> = {
  finished: 0,
  running: 1,
  DNF: 2,
  DSQ: 2,
  dns: 3,
};

function bibValue(bib: RaceRow["bib"]): number {
  return typeof bib === "number" ? bib : Number.POSITIVE_INFINITY;
}

function deltaValue(delta: string): number {
  if (delta === "LEADER") return Number.NEGATIVE_INFINITY;
  if (delta === "") return Number.POSITIVE_INFINITY;
  const n = parseFloat(delta);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function gateProgress(row: RaceRow): { count: number; latest: string } {
  const gates = [row.gate1, row.gate2, row.gate3, row.finish];
  let count = 0;
  let latest = "";
  for (const g of gates) {
    if (g !== "") {
      count++;
      latest = g;
    }
  }
  return { count, latest };
}

function compareWithinTier(a: RaceRow, b: RaceRow): number {
  const tier = STATUS_TIER[a.status];
  if (tier === 0) {
    // finished: by delta numeric asc (LEADER = -Infinity)
    const d = deltaValue(a.delta) - deltaValue(b.delta);
    if (d !== 0) return d;
    return bibValue(a.bib) - bibValue(b.bib);
  }
  if (tier === 1) {
    // running: gate progress desc, latest gate time asc, bib asc
    const ap = gateProgress(a);
    const bp = gateProgress(b);
    if (ap.count !== bp.count) return bp.count - ap.count;
    if (ap.latest !== bp.latest) {
      if (ap.latest === "") return 1;
      if (bp.latest === "") return -1;
      return ap.latest < bp.latest ? -1 : 1;
    }
    return bibValue(a.bib) - bibValue(b.bib);
  }
  if (tier === 2) {
    // DNF/DSQ: keep original order via stable sort; tie-break bib asc
    return bibValue(a.bib) - bibValue(b.bib);
  }
  // dns: bib asc
  return bibValue(a.bib) - bibValue(b.bib);
}

export function rankRows(rows: readonly RaceRow[]): RaceRow[] {
  return [...rows].sort((a, b) => {
    const ta = STATUS_TIER[a.status];
    const tb = STATUS_TIER[b.status];
    if (ta !== tb) return ta - tb;
    return compareWithinTier(a, b);
  });
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @pretable/app-website test -- sort.test`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/sort.ts apps/website/app/components/heroGrid/__tests__/sort.test.ts
git commit -m "feat(website): add rankRows leaderboard sort utility"
```

---

## Task 2: Sort utility — per-column user sort

**Files:**

- Modify: `apps/website/app/components/heroGrid/sort.ts`
- Modify: `apps/website/app/components/heroGrid/__tests__/sort.test.ts`

Adds `applySort(rows, sortState)` that switches between `rankRows` and column-specific comparators.

- [ ] **Step 1: Append failing tests for `applySort`**

Append to `apps/website/app/components/heroGrid/__tests__/sort.test.ts`:

```ts
import { applySort, type SortState } from "../sort";

describe("applySort", () => {
  it("returns rankRows order when sort is null", () => {
    const rows: RaceRow[] = [
      make({ id: "a", bib: 30 }),
      make({
        id: "b",
        bib: 1,
        status: "finished",
        finish: "01:16.00",
        delta: "LEADER",
      }),
    ];
    expect(applySort(rows, null).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("sorts by bib asc with telemetry sunk", () => {
    const rows: RaceRow[] = [
      make({ id: "tel", bib: "—" }),
      make({ id: "b", bib: 5 }),
      make({ id: "a", bib: 1 }),
    ];
    const sort: SortState = { columnId: "bib", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual(["a", "b", "tel"]);
  });

  it("sorts delta asc with LEADER first and empty last", () => {
    const rows: RaceRow[] = [
      make({ id: "empty", bib: 1 }),
      make({ id: "plus", bib: 2, status: "finished", delta: "+0.45" }),
      make({ id: "leader", bib: 3, status: "finished", delta: "LEADER" }),
    ];
    const sort: SortState = { columnId: "delta", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual([
      "leader",
      "plus",
      "empty",
    ]);
  });

  it("sorts status by explicit rank: finished < running < DNF < DSQ < dns", () => {
    const rows: RaceRow[] = [
      make({ id: "dns", bib: 1, status: "dns" }),
      make({ id: "dsq", bib: 2, status: "DSQ" }),
      make({ id: "dnf", bib: 3, status: "DNF" }),
      make({ id: "run", bib: 4, status: "running" }),
      make({ id: "fin", bib: 5, status: "finished" }),
    ];
    const sort: SortState = { columnId: "status", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual([
      "fin",
      "run",
      "dnf",
      "dsq",
      "dns",
    ]);
  });

  it("reverses with desc direction", () => {
    const rows: RaceRow[] = [
      make({ id: "a", bib: 1 }),
      make({ id: "b", bib: 2 }),
      make({ id: "c", bib: 3 }),
    ];
    const sort: SortState = { columnId: "bib", direction: "desc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("sorts gate1 with empty values sinking", () => {
    const rows: RaceRow[] = [
      make({ id: "empty", bib: 1 }),
      make({ id: "fast", bib: 2, gate1: "00:14.00" }),
      make({ id: "slow", bib: 3, gate1: "00:14.50" }),
    ];
    const sort: SortState = { columnId: "gate1", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual([
      "fast",
      "slow",
      "empty",
    ]);
  });

  it("sorts racer column with localeCompare", () => {
    const rows: RaceRow[] = [
      make({ id: "z", bib: 1, racer: "Zoé" }),
      make({ id: "a", bib: 2, racer: "Anna" }),
    ];
    const sort: SortState = { columnId: "racer", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual(["a", "z"]);
  });

  it("sorts notes lex with empty sinking", () => {
    const rows: RaceRow[] = [
      make({ id: "empty", bib: 1 }),
      make({ id: "z", bib: 2, notes: "Zooming" }),
      make({ id: "a", bib: 3, notes: "Aggressive" }),
    ];
    const sort: SortState = { columnId: "notes", direction: "asc" };
    expect(applySort(rows, sort).map((r) => r.id)).toEqual(["a", "z", "empty"]);
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @pretable/app-website test -- sort.test`
Expected: FAIL — `applySort` not exported.

- [ ] **Step 3: Implement `applySort` and supporting types**

Append to `apps/website/app/components/heroGrid/sort.ts`:

```ts
export type SortDirection = "asc" | "desc";

export interface SortState {
  columnId: string;
  direction: SortDirection;
}

const STATUS_USER_RANK: Record<RaceRow["status"], number> = {
  finished: 0,
  running: 1,
  DNF: 2,
  DSQ: 3,
  dns: 4,
};

function emptySink(value: string, direction: SortDirection): number {
  // Empty values always sink to the bottom regardless of direction.
  if (value !== "") return 0;
  return direction === "asc" ? 1 : -1;
}

function compareByColumn(a: RaceRow, b: RaceRow, columnId: string): number {
  switch (columnId) {
    case "bib":
      return bibValue(a.bib) - bibValue(b.bib);
    case "racer":
      return a.racer.localeCompare(b.racer);
    case "gate1":
    case "gate2":
    case "gate3":
    case "finish": {
      const av = a[columnId];
      const bv = b[columnId];
      if (av === "" && bv === "") return 0;
      if (av === "") return 1;
      if (bv === "") return -1;
      return av < bv ? -1 : av > bv ? 1 : 0;
    }
    case "delta":
      return deltaValue(a.delta) - deltaValue(b.delta);
    case "status":
      return STATUS_USER_RANK[a.status] - STATUS_USER_RANK[b.status];
    case "notes": {
      if (a.notes === "" && b.notes === "") return 0;
      if (a.notes === "") return 1;
      if (b.notes === "") return -1;
      return a.notes.localeCompare(b.notes);
    }
    default:
      return 0;
  }
}

export function applySort(
  rows: readonly RaceRow[],
  sort: SortState | null,
): RaceRow[] {
  if (sort === null) return rankRows(rows);
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    // Empty/telemetry rows always sink for column-by-column sort.
    if (sort.columnId === "bib") {
      // bib uses numeric where "—" is +Infinity → already sinks naturally
      return sign * compareByColumn(a, b, sort.columnId);
    }
    return sign * compareByColumn(a, b, sort.columnId);
  });
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @pretable/app-website test -- sort.test`
Expected: PASS — 14 tests total.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/sort.ts apps/website/app/components/heroGrid/__tests__/sort.test.ts
git commit -m "feat(website): add applySort with per-column race comparators"
```

---

## Task 3: Notes column — disable wrapping

**Files:**

- Modify: `apps/website/app/components/heroGrid/raceColumns.ts`

- [ ] **Step 1: Change `wrap: true` to `wrap: false` on notes column**

Edit `apps/website/app/components/heroGrid/raceColumns.ts` line 14:

```ts
  { id: "notes", header: "Notes", widthPx: 280, wrap: false },
```

- [ ] **Step 2: Run existing tests to confirm nothing else breaks**

Run: `pnpm --filter @pretable/app-website test -- raceColumns`
Expected: PASS (or "No test files found" — column config has no direct test).

Run: `pnpm --filter @pretable/app-website test`
Expected: All currently-passing tests continue to pass.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/components/heroGrid/raceColumns.ts
git commit -m "feat(website): disable wrap on notes column to fix row-height drift"
```

---

## Task 4: Race generator — drop placeholder, shorten commentary

**Files:**

- Modify: `apps/website/app/components/heroGrid/scripts/generate-race.ts`
- Regen: `apps/website/app/components/heroGrid/recordings/race.jsonl`
- Regen: `apps/website/app/components/heroGrid/recordings/race.ts`

The `··············` dot placeholder and the long flavor sentences both fed the row-height drift bug. Replace placeholder with empty string; trim commentary to short single-line clauses (≤ 30 chars).

- [ ] **Step 1: Replace `notes: "·"` and growing-dots tick events**

In `apps/website/app/components/heroGrid/scripts/generate-race.ts`, change line ~322 (start event):

```ts
    if (ev.kind === "start") {
      phase2Events.push({
        t: tMs,
        type: "update",
        patches: [{ id, status: "running" }],
      });
    } else if (ev.kind === "tick") {
      // Tick events are now no-ops — telemetry/animation lives elsewhere.
      // (Was: dot-trail in notes; removed because mid-streaming length
      // changes triggered row-height drift in the engine cache.)
    } else if (ev.kind === "gate1") {
```

- [ ] **Step 2: Replace `COMMENTARY_PHRASES` with short clauses**

Replace lines 59–70 in the same file:

```ts
const COMMENTARY_PHRASES = [
  "Clean line",
  "Big push out of start",
  "Aggressive on top",
  "Skis it like a champ",
  "Tactical run",
  "Pure speed at finish",
  "Battles back",
  "Direct line",
  "Carries serious speed",
  "Patient through G2",
];
```

All entries ≤ 22 chars; with the 280px notes column this never wraps.

- [ ] **Step 3: Replace the streaming token-loop with one-shot commentary**

In the same file, replace the commentary block (lines ~389–420) with:

```ts
// Commentary — 30% chance, single one-shot patch (no token streaming).
// Mid-stream growth was triggering wrap → row-height drift; the
// recording now emits each commentary as a single complete patch.
if (rand() < 0.3) {
  const phrase =
    COMMENTARY_PHRASES[Math.floor(rand() * COMMENTARY_PHRASES.length)]!;
  phase2Events.push({
    t: tMs + 200,
    type: "commentary",
    patches: [{ id, notes: phrase }],
  });
}
```

- [ ] **Step 4: Shorten DNF / DSQ notes**

Replace lines ~430 and ~442:

```ts
            notes: `Out at G${gate}`,
```

```ts
            notes: "Under review",
```

- [ ] **Step 5: Regenerate the recording**

Run: `pnpm --filter @pretable/app-website exec tsx apps/website/app/components/heroGrid/scripts/generate-race.ts`
Expected: Writes `apps/website/app/components/heroGrid/recordings/race.jsonl` and `race.ts`.

If the script entry point is different, locate it:

Run: `node -e "const p = require('./apps/website/package.json').scripts; console.log(p);"`
Expected: Find a script named like `generate-race`. If none, run with `tsx` directly:

Run: `cd apps/website && pnpm exec tsx app/components/heroGrid/scripts/generate-race.ts`

- [ ] **Step 6: Verify replay-engine tests still pass with new recording**

Run: `pnpm --filter @pretable/app-website test -- replay-engine`
Expected: PASS — fixture is inline in the test, regen doesn't affect it.

- [ ] **Step 7: Commit**

```bash
git add apps/website/app/components/heroGrid/scripts/generate-race.ts apps/website/app/components/heroGrid/recordings/race.jsonl apps/website/app/components/heroGrid/recordings/race.ts
git commit -m "feat(website): regenerate race recording with short single-line commentary"
```

---

## Task 5: Scoreboard component — leader section

**Files:**

- Create: `apps/website/app/components/heroGrid/Scoreboard.tsx`
- Test: `apps/website/__tests__/components/heroGrid/Scoreboard.test.tsx`

Build the component incrementally. Start with the leader section.

- [ ] **Step 1: Write failing test for leader section**

Create `apps/website/__tests__/components/heroGrid/Scoreboard.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Scoreboard } from "../../../app/components/heroGrid/Scoreboard";
import type { RaceRow } from "../../../app/components/heroGrid/types";

const baseRow: RaceRow = {
  id: "x",
  bib: 0,
  racer: "Test 🇺🇸",
  gate1: "",
  gate2: "",
  gate3: "",
  finish: "",
  delta: "",
  status: "dns",
  notes: "",
};

describe("Scoreboard", () => {
  afterEach(() => cleanup());

  it("hides leader section when no LEADER row exists", () => {
    render(<Scoreboard rows={[]} />);
    expect(screen.queryByTestId("scoreboard-leader")).toBeNull();
  });

  it("shows leader section with finish time, bib, racer when LEADER row exists", () => {
    const rows: RaceRow[] = [
      {
        ...baseRow,
        id: "r-1",
        bib: 12,
        racer: "Thomas Tumler 🇨🇭",
        status: "finished",
        finish: "01:14.89",
        delta: "LEADER",
      },
    ];
    render(<Scoreboard rows={rows} />);
    const leader = screen.getByTestId("scoreboard-leader");
    expect(leader).toHaveTextContent("01:14.89");
    expect(leader).toHaveTextContent("12");
    expect(leader).toHaveTextContent("Thomas Tumler");
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @pretable/app-website test -- Scoreboard.test`
Expected: FAIL — `Cannot find module .../Scoreboard`.

- [ ] **Step 3: Implement minimal Scoreboard with leader section only**

Create `apps/website/app/components/heroGrid/Scoreboard.tsx`:

```tsx
import { useMemo } from "react";

import type { RaceRow } from "./types";
import styles from "./scoreboard.module.css";

export interface ScoreboardProps {
  rows: readonly RaceRow[];
}

interface Leader {
  bib: number | "—";
  racer: string;
  finish: string;
}

interface ScoreboardModel {
  leader: Leader | null;
}

function buildModel(rows: readonly RaceRow[]): ScoreboardModel {
  const racing = rows.filter((r) => !r.id.startsWith("tel-"));
  const leaderRow = racing.find((r) => r.delta === "LEADER");
  const leader = leaderRow
    ? {
        bib: leaderRow.bib,
        racer: leaderRow.racer,
        finish: leaderRow.finish,
      }
    : null;
  return { leader };
}

export function Scoreboard({ rows }: ScoreboardProps) {
  const model = useMemo(() => buildModel(rows), [rows]);

  return (
    <aside aria-label="Race scoreboard" className={styles.board}>
      {model.leader && (
        <section className={styles.section} data-testid="scoreboard-leader">
          <div className={styles.label}>LEADER</div>
          <div className={styles.time}>{model.leader.finish}</div>
          <div className={styles.racer}>
            #{model.leader.bib} {model.leader.racer}
          </div>
        </section>
      )}
    </aside>
  );
}
```

Create `apps/website/app/components/heroGrid/scoreboard.module.css`:

```css
.board {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 24px 20px;
  font-family: var(--pt-font-sans, system-ui);
  color: var(--pt-fg-strong, var(--pt-fg));
}

.section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--pt-fg-muted);
}

.time {
  font-family: var(--pt-font-mono, ui-monospace);
  font-size: 28px;
  font-weight: 600;
  line-height: 1.1;
  color: var(--pt-fg-strong);
}

.racer {
  font-size: 14px;
  color: var(--pt-fg);
}
```

- [ ] **Step 4: Verify leader tests pass**

Run: `pnpm --filter @pretable/app-website test -- Scoreboard.test`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/heroGrid/Scoreboard.tsx apps/website/app/components/heroGrid/scoreboard.module.css apps/website/__tests__/components/heroGrid/Scoreboard.test.tsx
git commit -m "feat(website): add Scoreboard with leader section"
```

---

## Task 6: Scoreboard — on-course section with gate dots

**Files:**

- Modify: `apps/website/app/components/heroGrid/Scoreboard.tsx`
- Modify: `apps/website/app/components/heroGrid/scoreboard.module.css`
- Modify: `apps/website/__tests__/components/heroGrid/Scoreboard.test.tsx`

- [ ] **Step 1: Append failing tests for on-course section**

Append inside the `describe("Scoreboard", ...)` block in `Scoreboard.test.tsx`:

```tsx
it("hides on-course section when no running rows", () => {
  render(<Scoreboard rows={[]} />);
  expect(screen.queryByTestId("scoreboard-on-course")).toBeNull();
});

it("renders one row per running racer with 4 gate dots", () => {
  const rows: RaceRow[] = [
    {
      ...baseRow,
      id: "r-1",
      bib: 15,
      status: "running",
      gate1: "00:14.50",
      gate2: "00:36.00",
    },
    { ...baseRow, id: "r-2", bib: 14, status: "running", gate1: "00:14.30" },
  ];
  const { container } = render(<Scoreboard rows={rows} />);
  const section = screen.getByTestId("scoreboard-on-course");
  const racerRows = section.querySelectorAll(
    "[data-testid='scoreboard-racer']",
  );
  expect(racerRows).toHaveLength(2);
  // Each row has exactly 4 dots
  racerRows.forEach((row) => {
    expect(row.querySelectorAll("[data-testid='gate-dot']")).toHaveLength(4);
  });
});

it("fills dots based on non-empty gate columns", () => {
  const rows: RaceRow[] = [
    {
      ...baseRow,
      id: "r-1",
      bib: 15,
      status: "running",
      gate1: "00:14.50",
      gate2: "00:36.00",
    },
  ];
  const { container } = render(<Scoreboard rows={rows} />);
  const dots = container.querySelectorAll("[data-testid='gate-dot']");
  // gate1 + gate2 filled, gate3 + finish empty → 2 filled, 2 empty
  expect(
    [...dots].filter((d) => d.getAttribute("data-filled") === "true"),
  ).toHaveLength(2);
  expect(
    [...dots].filter((d) => d.getAttribute("data-filled") === "false"),
  ).toHaveLength(2);
});

it("excludes telemetry rows (id starts with tel-)", () => {
  const rows: RaceRow[] = [
    {
      ...baseRow,
      id: "tel-0001",
      bib: "—",
      status: "running",
      racer: "Sensor: gate 4 wind",
    },
    { ...baseRow, id: "r-1", bib: 5, status: "running" },
  ];
  render(<Scoreboard rows={rows} />);
  const racerRows = screen.getAllByTestId("scoreboard-racer");
  expect(racerRows).toHaveLength(1);
});

it("caps on-course at 5 rows and shows +N more overflow indicator", () => {
  const rows: RaceRow[] = Array.from({ length: 7 }, (_, i) => ({
    ...baseRow,
    id: `r-${i + 1}`,
    bib: i + 1,
    status: "running" as const,
  }));
  render(<Scoreboard rows={rows} />);
  expect(screen.getAllByTestId("scoreboard-racer")).toHaveLength(5);
  expect(screen.getByTestId("scoreboard-overflow")).toHaveTextContent(
    "+2 more",
  );
});

it("orders running by gate progress descending", () => {
  const rows: RaceRow[] = [
    { ...baseRow, id: "early", bib: 1, status: "running", gate1: "00:14.00" },
    {
      ...baseRow,
      id: "late",
      bib: 2,
      status: "running",
      gate1: "00:14.00",
      gate2: "00:36.00",
      gate3: "00:55.00",
    },
  ];
  render(<Scoreboard rows={rows} />);
  const racerRows = screen.getAllByTestId("scoreboard-racer");
  expect(racerRows[0]).toHaveTextContent("2"); // bib 2 = "late"
  expect(racerRows[1]).toHaveTextContent("1");
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @pretable/app-website test -- Scoreboard.test`
Expected: FAIL — section/elements not found.

- [ ] **Step 3: Extend `Scoreboard.tsx` with on-course section**

Replace `buildModel` and JSX in `Scoreboard.tsx` with:

```tsx
import { useMemo } from "react";

import type { RaceRow } from "./types";
import styles from "./scoreboard.module.css";

export interface ScoreboardProps {
  rows: readonly RaceRow[];
}

interface Leader {
  bib: number | "—";
  racer: string;
  finish: string;
}

interface OnCourseRow {
  id: string;
  bib: number | "—";
  gateFilled: [boolean, boolean, boolean, boolean];
}

const MAX_ON_COURSE = 5;

interface ScoreboardModel {
  leader: Leader | null;
  onCourse: OnCourseRow[];
  onCourseOverflow: number;
}

function gateFilled(row: RaceRow): [boolean, boolean, boolean, boolean] {
  return [
    row.gate1 !== "",
    row.gate2 !== "",
    row.gate3 !== "",
    row.finish !== "",
  ];
}

function compareRunning(a: RaceRow, b: RaceRow): number {
  const af = gateFilled(a).filter(Boolean).length;
  const bf = gateFilled(b).filter(Boolean).length;
  if (af !== bf) return bf - af;
  const aBib = typeof a.bib === "number" ? a.bib : Number.POSITIVE_INFINITY;
  const bBib = typeof b.bib === "number" ? b.bib : Number.POSITIVE_INFINITY;
  return aBib - bBib;
}

function buildModel(rows: readonly RaceRow[]): ScoreboardModel {
  const racing = rows.filter((r) => !r.id.startsWith("tel-"));
  const leaderRow = racing.find((r) => r.delta === "LEADER");
  const leader = leaderRow
    ? { bib: leaderRow.bib, racer: leaderRow.racer, finish: leaderRow.finish }
    : null;

  const running = racing.filter((r) => r.status === "running");
  running.sort(compareRunning);
  const onCourse = running.slice(0, MAX_ON_COURSE).map((r) => ({
    id: r.id,
    bib: r.bib,
    gateFilled: gateFilled(r),
  }));
  const onCourseOverflow = Math.max(0, running.length - MAX_ON_COURSE);

  return { leader, onCourse, onCourseOverflow };
}

export function Scoreboard({ rows }: ScoreboardProps) {
  const model = useMemo(() => buildModel(rows), [rows]);

  return (
    <aside aria-label="Race scoreboard" className={styles.board}>
      {model.leader && (
        <section className={styles.section} data-testid="scoreboard-leader">
          <div className={styles.label}>LEADER</div>
          <div className={styles.time}>{model.leader.finish}</div>
          <div className={styles.racer}>
            #{model.leader.bib} {model.leader.racer}
          </div>
        </section>
      )}

      {model.onCourse.length > 0 && (
        <section className={styles.section} data-testid="scoreboard-on-course">
          <div className={styles.label}>ON COURSE</div>
          {model.onCourse.map((r) => (
            <div
              className={styles.racerLine}
              data-testid="scoreboard-racer"
              key={r.id}
            >
              <span className={styles.bib}>#{r.bib}</span>
              <span className={styles.dots}>
                {r.gateFilled.map((filled, i) => (
                  <span
                    className={styles.dot}
                    data-filled={filled ? "true" : "false"}
                    data-testid="gate-dot"
                    key={i}
                  >
                    {filled ? "●" : "○"}
                  </span>
                ))}
              </span>
            </div>
          ))}
          {model.onCourseOverflow > 0 && (
            <div className={styles.overflow} data-testid="scoreboard-overflow">
              +{model.onCourseOverflow} more
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
```

- [ ] **Step 4: Add CSS for the on-course section**

Append to `apps/website/app/components/heroGrid/scoreboard.module.css`:

```css
.racerLine {
  display: flex;
  align-items: center;
  gap: 12px;
  font-family: var(--pt-font-mono, ui-monospace);
  font-size: 13px;
}

.bib {
  width: 32px;
  color: var(--pt-fg-muted);
}

.dots {
  display: inline-flex;
  gap: 6px;
}

.dot {
  font-size: 14px;
  color: var(--pt-fg-muted);
}

.dot[data-filled="true"] {
  color: var(--pt-fg-strong);
}

.overflow {
  font-size: 11px;
  color: var(--pt-fg-muted);
  margin-top: 2px;
}
```

- [ ] **Step 5: Verify all tests pass**

Run: `pnpm --filter @pretable/app-website test -- Scoreboard.test`
Expected: PASS — 8 tests total.

- [ ] **Step 6: Commit**

```bash
git add apps/website/app/components/heroGrid/Scoreboard.tsx apps/website/app/components/heroGrid/scoreboard.module.css apps/website/__tests__/components/heroGrid/Scoreboard.test.tsx
git commit -m "feat(website): add Scoreboard on-course section with gate-dot progress"
```

---

## Task 7: Scoreboard — counters footer

**Files:**

- Modify: `apps/website/app/components/heroGrid/Scoreboard.tsx`
- Modify: `apps/website/app/components/heroGrid/scoreboard.module.css`
- Modify: `apps/website/__tests__/components/heroGrid/Scoreboard.test.tsx`

- [ ] **Step 1: Append failing tests for counters**

Append inside the `describe("Scoreboard", ...)` block:

```tsx
it("hides counters when no finished or DNF rows", () => {
  render(<Scoreboard rows={[]} />);
  expect(screen.queryByTestId("scoreboard-counters")).toBeNull();
});

it("shows FIN count when at least one finished row", () => {
  const rows: RaceRow[] = [
    {
      ...baseRow,
      id: "r-1",
      bib: 1,
      status: "finished",
      finish: "01:16",
      delta: "LEADER",
    },
    {
      ...baseRow,
      id: "r-2",
      bib: 2,
      status: "finished",
      finish: "01:17",
      delta: "+1.00",
    },
  ];
  render(<Scoreboard rows={rows} />);
  expect(screen.getByTestId("scoreboard-counters")).toHaveTextContent("FIN 2");
});

it("shows DNF count when at least one DNF row, hides DNF when zero", () => {
  const rowsNoDnf: RaceRow[] = [
    { ...baseRow, id: "r-1", bib: 1, status: "finished", delta: "LEADER" },
  ];
  const { rerender } = render(<Scoreboard rows={rowsNoDnf} />);
  expect(screen.getByTestId("scoreboard-counters")).not.toHaveTextContent(
    "DNF",
  );

  const rowsWithDnf: RaceRow[] = [
    ...rowsNoDnf,
    { ...baseRow, id: "r-2", bib: 2, status: "DNF" },
  ];
  rerender(<Scoreboard rows={rowsWithDnf} />);
  expect(screen.getByTestId("scoreboard-counters")).toHaveTextContent("DNF 1");
});
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @pretable/app-website test -- Scoreboard.test`
Expected: FAIL — counters element missing.

- [ ] **Step 3: Add counters to the model and JSX**

In `Scoreboard.tsx`, extend `ScoreboardModel`:

```tsx
interface Counters {
  finished: number;
  dnf: number;
}

interface ScoreboardModel {
  leader: Leader | null;
  onCourse: OnCourseRow[];
  onCourseOverflow: number;
  counters: Counters;
}
```

Extend `buildModel`:

```tsx
const counters: Counters = {
  finished: racing.filter((r) => r.status === "finished").length,
  dnf: racing.filter((r) => r.status === "DNF" || r.status === "DSQ").length,
};

return { leader, onCourse, onCourseOverflow, counters };
```

Append below the on-course section in the returned JSX:

```tsx
{
  (model.counters.finished > 0 || model.counters.dnf > 0) && (
    <section className={styles.counters} data-testid="scoreboard-counters">
      {model.counters.finished > 0 && (
        <span>FIN {model.counters.finished}</span>
      )}
      {model.counters.dnf > 0 && <span>DNF {model.counters.dnf}</span>}
    </section>
  );
}
```

- [ ] **Step 4: Add counters CSS**

Append to `scoreboard.module.css`:

```css
.counters {
  display: flex;
  gap: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--pt-rule);
  font-family: var(--pt-font-mono, ui-monospace);
  font-size: 12px;
  color: var(--pt-fg-muted);
}
```

- [ ] **Step 5: Verify all tests pass**

Run: `pnpm --filter @pretable/app-website test -- Scoreboard.test`
Expected: PASS — 11 tests total.

- [ ] **Step 6: Commit**

```bash
git add apps/website/app/components/heroGrid/Scoreboard.tsx apps/website/app/components/heroGrid/scoreboard.module.css apps/website/__tests__/components/heroGrid/Scoreboard.test.tsx
git commit -m "feat(website): add Scoreboard counters (FIN/DNF)"
```

---

## Task 8: HeroGrid integration — sort + leader highlight + scoreboard swap

**Files:**

- Modify: `apps/website/app/components/HeroGrid.tsx`
- Modify: `apps/website/app/components/heroGrid/heroGrid.module.css`
- Delete: `apps/website/app/components/heroGrid/CourseVisualization.tsx`
- Delete: `apps/website/__tests__/components/heroGrid/CourseVisualization.test.tsx`

- [ ] **Step 1: Add `.leaderRow` class to CSS module**

Append to `apps/website/app/components/heroGrid/heroGrid.module.css`:

```css
.leaderRow {
  background: color-mix(
    in oklab,
    var(--pt-color-warning, #d97706) 12%,
    transparent
  );
}
```

- [ ] **Step 2: Update HeroGrid.tsx — imports, state, derived rows, props**

Replace contents of `apps/website/app/components/HeroGrid.tsx`:

```tsx
"use client";

import { PretableSurface } from "@pretable/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useControlState } from "./heroGrid/controlState";
import { raceColumns } from "./heroGrid/raceColumns";
import { RACE_RECORDING } from "./heroGrid/recordings/race";
import { createRaceReplay } from "./heroGrid/replay-engine";
import { Scoreboard } from "./heroGrid/Scoreboard";
import { applySort, type SortState } from "./heroGrid/sort";
import type { RaceRow } from "./heroGrid/types";
import styles from "./heroGrid/heroGrid.module.css";

const FALLBACK_VIEWPORT_HEIGHT = 520;
const VISIBLE_BUFFER_ROWS = 200;

export function HeroGrid() {
  const { ratePerSec, isPlaying } = useControlState();
  const [rows, setRows] = useState<RaceRow[]>([]);
  const [userSort, setUserSort] = useState<SortState | null>(null);
  const replayRef = useRef<ReturnType<typeof createRaceReplay> | null>(null);

  const sortedRows = useMemo(() => applySort(rows, userSort), [rows, userSort]);

  const surfaceRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(
    FALLBACK_VIEWPORT_HEIGHT,
  );
  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = Math.max(
        FALLBACK_VIEWPORT_HEIGHT,
        Math.round(el.clientHeight),
      );
      setViewportHeight((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduce =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) return;

    const replay = createRaceReplay({
      recording: RACE_RECORDING,
      ratePerSec,
      isPlaying,
      onTransaction: (tx) => {
        setRows((prev) => {
          let next = prev;
          if (tx.add) {
            next = [...next, ...tx.add];
            if (next.length > VISIBLE_BUFFER_ROWS) {
              next = next.slice(-VISIBLE_BUFFER_ROWS);
            }
          }
          if (tx.update) {
            const byId = new Map<string, Partial<RaceRow>>();
            for (const p of tx.update) {
              const id = (p as { id?: string }).id;
              if (typeof id !== "string") continue;
              byId.set(id, { ...byId.get(id), ...p });
            }
            next = next.map((row) => {
              const patch = byId.get(row.id);
              return patch ? { ...row, ...patch } : row;
            });
          }
          return next;
        });
      },
    });
    replayRef.current = replay;
    return () => {
      replay.dispose();
      replayRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once; rate/playing changes go through separate effects
  }, []);

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
            <PretableSurface<RaceRow>
              ariaLabel="Live ski racing"
              columns={raceColumns}
              getRowClassName={({ row }) =>
                row.delta === "LEADER" ? styles.leaderRow : undefined
              }
              getRowId={(row) => row.id}
              onSortChange={setUserSort}
              rows={sortedRows}
              sort={userSort}
              viewportHeight={viewportHeight}
            />
          </div>
          <div className={styles.heroSidebar}>
            <Scoreboard rows={rows} />
          </div>
        </div>
      </div>
    </section>
  );
}
```

Note: `tx.add` now appends instead of prepending — the sort layer handles ordering, so insertion order is irrelevant for display.

- [ ] **Step 3: Delete obsolete CourseVisualization files**

```bash
rm apps/website/app/components/heroGrid/CourseVisualization.tsx
rm apps/website/__tests__/components/heroGrid/CourseVisualization.test.tsx
```

- [ ] **Step 4: Run full website test suite**

Run: `pnpm --filter @pretable/app-website test`
Expected: All tests PASS. CourseVisualization tests no longer exist; Scoreboard tests pass; sort tests pass; replay-engine tests pass; HomeStreamHeader tests pass.

- [ ] **Step 5: Type-check the website**

Run: `pnpm --filter @pretable/app-website typecheck`
Expected: No type errors. Common issue: confirm `PretableSurface` accepts `sort` and `onSortChange` props with the types we're passing (`SortState | null` is `{columnId: string; direction: "asc" | "desc"} | null` — which matches the engine's signature).

- [ ] **Step 6: Lint the website**

Run: `pnpm --filter @pretable/app-website lint`
Expected: No errors. If unused imports remain (e.g. `CourseVisualization` import still referenced) clean them up.

- [ ] **Step 7: Commit**

```bash
git add apps/website/app/components/HeroGrid.tsx apps/website/app/components/heroGrid/heroGrid.module.css
git rm apps/website/app/components/heroGrid/CourseVisualization.tsx apps/website/__tests__/components/heroGrid/CourseVisualization.test.tsx
git commit -m "feat(website): wire userSort, leader highlight, scoreboard sidebar in HeroGrid"
```

---

## Task 9: Browser verification

**Files:** none modified — manual sanity check.

- [ ] **Step 1: Start dev server**

Run from a separate terminal: `pnpm --filter @pretable/app-website dev`
Expected: `Local: http://localhost:3000` ready within ~10s.

- [ ] **Step 2: Open localhost:3000 and observe**

Verify checklist:

- Race grid sorted: leader at top, then `+0.32` etc., running below, dns at bottom.
- Leader row has a subtle warm tint background.
- Notes column does not change row height as commentary streams.
- Right sidebar shows: `LEADER` block, `ON COURSE` block with bib + 4 dots per active racer, `FIN N` and `DNF N` counters.
- Clicking a column header's "Sort" button reorders the grid; clicking again toggles direction; clicking a third time clears (returns to leaderboard rank).
- The leader row stays highlighted regardless of user sort.

- [ ] **Step 3: Stop dev server**

Press `Ctrl+C` in the terminal running `pnpm dev`.

---

## Self-review checklist

Before marking the plan complete:

1. **Spec coverage:**
   - Default rank order → Task 1 ✓
   - Per-column user sort → Task 2 ✓
   - Notes wrap → false → Task 3 ✓
   - Drop placeholder + shorten commentary → Task 4 ✓
   - Leader row highlight → Task 8 (CSS step 1, prop step 2) ✓
   - Scoreboard leader / on-course / counters → Tasks 5, 6, 7 ✓
   - Delete CourseVisualization → Task 8 step 3 ✓
   - Sort UI plumbing via `PretableSurface.sort` / `onSortChange` → Task 8 step 2 ✓
   - Tests for sort + Scoreboard → Tasks 1, 2, 5, 6, 7 ✓

2. **No placeholders:** every step contains complete code, exact paths, exact commands.

3. **Type consistency:** `SortState`, `applySort`, `rankRows`, `Scoreboard`, `ScoreboardProps`, `RaceRow` all consistent across tasks.
