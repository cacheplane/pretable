# Tier 1 Bench Slab 1 (B Phase 7 + D3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land six new pretable-internal bench hypotheses (H16–H21) by extending `BenchScriptName` with three selection/keyboard-nav scripts and three cell-renderer scripts, wiring runtime handlers and the matrix-evaluator, capturing evidence via a single repeated Chromium S2/hypothesis run, and committing the runset under `status/runsets/`.

**Architecture:** Six new `BenchScriptName` values in `packages/bench-runner/src/index.ts`. Three new selection/nav scripts (`select-range-extend`, `keyboard-nav-row`, `select-all`) get a shared `measureBenchKeySequenceRun` helper in `apps/bench/src/bench-runtime.ts` that loops a key dispatch + frame-wait + per-event timing, reporting p95 as `interaction_latency_ms`. Three new cell-renderer scripts (`scroll-with-format`, `scroll-with-render`, `scroll-with-heavy-render`) reuse the existing `measureBenchScrollRun` but the pretable adapter mounts the grid with different column configurations driven off the active script name. Comparator adapters return `unsupported`. `scripts/bench-matrix.mjs` gains six new evaluators (H16–H21).

**Tech Stack:** TypeScript, React 19, Playwright (Chromium), Vitest, pnpm workspaces. Touched: `packages/bench-runner`, `apps/bench`, `scripts/bench-matrix.mjs`, `docs/research/repo-memory.md`.

**Spec:** [`docs/superpowers/specs/2026-05-07-tier1-bench-slab1-design.md`](../specs/2026-05-07-tier1-bench-slab1-design.md)

**Working directory:** `/Users/blove/repos/pretable/.worktrees/bench-slab1`. All paths in this plan are relative to the repo root.

---

## File Structure

```
packages/bench-runner/src/
└── index.ts                                      (MODIFY: add 6 new BenchScriptName values)

apps/bench/src/
├── bench-types.ts                                (MODIFY: extend Extract list to include new scripts)
├── bench-runtime.ts                              (MODIFY: add measureBenchKeySequenceRun helper;
│                                                   extend measureBenchInteractionRun to accept "select-all" mode)
├── bench-app.tsx                                 (MODIFY: dispatch new scriptNames to runtime helpers)
├── pretable-adapter.tsx                          (MODIFY: column flavor selection driven by query.scriptName for cell-renderer scripts)
├── ag-grid-adapter.tsx                           (MODIFY: return unsupported for the 6 new scripts — verify pattern)
├── tanstack-adapter.tsx                          (MODIFY: return unsupported)
├── mui-adapter.tsx                               (MODIFY: return unsupported)
└── __tests__/
    └── bench-runtime.test.ts                     (MODIFY: add tests for measureBenchKeySequenceRun)

scripts/
├── bench-matrix.mjs                              (MODIFY: add evaluateH16-H21; register them in the evaluator list)
└── __tests__/bench-matrix.test.mjs               (MODIFY: synthetic-runset tests for new evaluators)

status/runsets/
└── <runset-id>/...                               (NEW: actual evidence from the matrix run)

docs/research/
└── repo-memory.md                                (MODIFY: append milestone entry for Bench Slab 1)
```

---

## Task 1 — Add 6 new `BenchScriptName` values

**Files:**

- Modify: `packages/bench-runner/src/index.ts`
- Modify: `apps/bench/src/bench-types.ts`

- [ ] **Step 1.1: Extend `BenchScriptName` union in `packages/bench-runner/src/index.ts`**

Open `packages/bench-runner/src/index.ts`. Find the `BenchScriptName` type (around line 67). Add six new entries:

```ts
export type BenchScriptName =
  | "initial"
  | "scroll"
  | "sort"
  | "filter-metadata"
  | "filter-text"
  | "updates"
  | "autosize"
  | "select-range-extend" // B Phase 7
  | "keyboard-nav-row" // B Phase 7
  | "select-all" // B Phase 7
  | "scroll-with-format" // D3
  | "scroll-with-render" // D3
  | "scroll-with-heavy-render"; // D3
```

(Preserve any existing entries — check the current list first; the example above includes the present entries plus the six new ones.)

- [ ] **Step 1.2: Find the BenchScriptName-list constant**

```bash
grep -n "BenchScriptName\\[\\]\\|: BenchScriptName" packages/bench-runner/src/index.ts | head
```

If a runtime list constant exists (e.g., `export const BENCH_SCRIPT_NAMES: BenchScriptName[] = [...]`), append the six new names to it in the same order as the union.

- [ ] **Step 1.3: Extend the `Extract` narrow in `apps/bench/src/bench-types.ts`**

Open `apps/bench/src/bench-types.ts`. Replace:

```ts
scriptName: Extract<
  BenchScriptName,
  "initial" | "scroll" | "sort" | "filter-metadata" | "filter-text" | "updates"
>;
```

With:

```ts
scriptName: Extract<
  BenchScriptName,
  | "initial"
  | "scroll"
  | "sort"
  | "filter-metadata"
  | "filter-text"
  | "updates"
  | "select-range-extend"
  | "keyboard-nav-row"
  | "select-all"
  | "scroll-with-format"
  | "scroll-with-render"
  | "scroll-with-heavy-render"
>;
```

- [ ] **Step 1.4: Typecheck**

```bash
pnpm --filter @pretable-internal/bench-runner typecheck
pnpm --filter @pretable/app-bench typecheck
```

Expected: passes. (No runtime behavior change yet — handlers come in subsequent tasks.)

- [ ] **Step 1.5: Commit**

```bash
git add packages/bench-runner/src/index.ts apps/bench/src/bench-types.ts
git commit -m "feat(bench-runner): BenchScriptName entries for selection-nav + cell-renderer scripts

Adds select-range-extend, keyboard-nav-row, select-all (B Phase 7) and
scroll-with-format, scroll-with-render, scroll-with-heavy-render (D3).
No runtime behavior change yet — handlers land in subsequent commits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2 — Implement `measureBenchKeySequenceRun` helper

**Files:**

- Modify: `apps/bench/src/bench-runtime.ts`

This helper is shared by `select-range-extend` and `keyboard-nav-row` (and select-all, optionally). It dispatches N keystrokes spaced one frame apart, captures per-event latency from event-dispatch to next paint, and returns p95 as `interaction_latency_ms`.

- [ ] **Step 2.1: Read the existing measurement helpers**

```bash
grep -n "waitForAnimationFrame\|percentile\|export async function measureBench" apps/bench/src/bench-runtime.ts | head
```

Note the existing helpers — `waitForAnimationFrame()`, `percentile(arr, q)`, and the existing `measureBenchInteractionRun`. The new helper reuses them.

- [ ] **Step 2.2: Add the helper at the bottom of `apps/bench/src/bench-runtime.ts`**

Append (preserve existing content; add after the existing `measureBenchUpdatesRun`):

```ts
export interface KeySequenceBenchRunResult {
  status: "completed" | "partial" | "failed";
  notes: string[];
  metrics: {
    interaction_latency_ms?: number;
    settle_duration_ms?: number;
    dom_nodes_peak?: number;
    rendered_rows_peak?: number;
    rendered_cells_peak?: number;
  };
}

interface KeySequenceOptions {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  count: number;
  /** Minimum frames between keystrokes to ensure each one renders. Default 1. */
  framesBetween?: number;
}

export async function measureBenchKeySequenceRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
  scriptName: "select-range-extend" | "keyboard-nav-row" | "select-all",
  options: KeySequenceOptions,
): Promise<KeySequenceBenchRunResult> {
  const profile = scrollRuntimeProfiles[adapterId];
  const viewport = await waitForScrollViewport(root, profile.viewportSelector);
  const viewportPolicyNotes = viewport
    ? detectViewportPolicyNotes(viewport)
    : [];

  if (!viewport) {
    return {
      status: "partial",
      notes: [
        ...viewportPolicyNotes,
        `script: ${scriptName}`,
        `viewport unavailable for ${adapterId} in current runtime`,
      ],
      metrics: {
        dom_nodes_peak: root.querySelectorAll("*").length,
      },
    };
  }

  // Allow the grid to settle and ensure focus is on a body cell.
  await waitForAnimationFrame();
  const firstCell =
    viewport.querySelector<HTMLElement>(
      `${profile.cellSelector}[tabindex="0"]`,
    ) ?? viewport.querySelector<HTMLElement>(profile.cellSelector);

  if (!firstCell) {
    return {
      status: "partial",
      notes: [
        ...viewportPolicyNotes,
        `script: ${scriptName}`,
        `no body cell available for keyboard focus`,
      ],
      metrics: {
        dom_nodes_peak: root.querySelectorAll("*").length,
      },
    };
  }

  firstCell.focus();
  await waitForAnimationFrame();

  let domNodesPeak = root.querySelectorAll("*").length;
  let renderedRowsPeak = root.querySelectorAll(profile.rowSelector).length;
  let renderedCellsPeak = root.querySelectorAll(profile.cellSelector).length;
  const latencies: number[] = [];
  const framesBetween = options.framesBetween ?? 1;

  for (let i = 0; i < options.count; i += 1) {
    const start = performance.now();
    const target = (document.activeElement as HTMLElement) ?? firstCell;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: options.key,
        shiftKey: options.shiftKey ?? false,
        ctrlKey: options.ctrlKey ?? false,
        metaKey: options.metaKey ?? false,
      }),
    );

    // Wait for at least one paint to capture the frame the dispatch produced.
    for (let f = 0; f < framesBetween; f += 1) {
      await waitForAnimationFrame();
    }
    latencies.push(performance.now() - start);

    domNodesPeak = Math.max(domNodesPeak, root.querySelectorAll("*").length);
    renderedRowsPeak = Math.max(
      renderedRowsPeak,
      root.querySelectorAll(profile.rowSelector).length,
    );
    renderedCellsPeak = Math.max(
      renderedCellsPeak,
      root.querySelectorAll(profile.cellSelector).length,
    );
  }

  // Settle: wait a few frames to ensure no late commits.
  const settleStart = performance.now();
  for (let f = 0; f < 5; f += 1) {
    await waitForAnimationFrame();
  }
  const settleDuration = performance.now() - settleStart;

  return {
    status: "completed",
    notes: [
      ...viewportPolicyNotes,
      `script: ${scriptName}`,
      `events: ${options.count}`,
    ],
    metrics: {
      interaction_latency_ms:
        options.count === 1 ? latencies[0] : percentile(latencies, 0.95),
      settle_duration_ms: settleDuration,
      dom_nodes_peak: domNodesPeak,
      rendered_rows_peak: renderedRowsPeak,
      rendered_cells_peak: renderedCellsPeak,
    },
  };
}
```

The helper:

- Focuses the first body cell that has `tabindex="0"` (the ARIA grid pattern's tabbable cell from sub-project B Phase 2).
- Loops the keystroke dispatch, captures per-event latency, reports p95 (or single value if count === 1).
- Uses the existing `scrollRuntimeProfiles[adapterId]` for selector specs.
- Settle phase mirrors the existing pattern.

- [ ] **Step 2.3: Typecheck**

```bash
pnpm --filter @pretable/app-bench typecheck
```

Expected: passes.

- [ ] **Step 2.4: Commit**

```bash
git add apps/bench/src/bench-runtime.ts
git commit -m "feat(bench): measureBenchKeySequenceRun helper for keyboard-driven scripts

Loops key dispatch + frame-wait + per-event timing. Reports p95 as
interaction_latency_ms (or single value if count === 1). Used by the
select-range-extend / keyboard-nav-row / select-all scripts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3 — Wire bench-app dispatch for selection/nav scripts

**Files:**

- Modify: `apps/bench/src/bench-app.tsx`

- [ ] **Step 3.1: Read the existing dispatch (around line 158–250)**

Note the pattern: each existing script gets its own `if (scriptName === "...")` block that calls a `measureBench<X>Run`, captures the result into a typed variable (e.g., `interactionRun`, `scrollRun`), then a `nextResult = ...` ternary chain creates a `BenchRunSummary`.

- [ ] **Step 3.2: Import the new helper**

At the top of `apps/bench/src/bench-app.tsx`, add `measureBenchKeySequenceRun` to the existing import from `./bench-runtime`.

- [ ] **Step 3.3: Add a key-sequence run capture block**

Inside the `runBench` (or equivalent) function, near where `interactionRun` is computed, add:

```ts
const keySequenceRun =
  scriptName === "select-range-extend"
    ? query.adapterId === "pretable"
      ? await measureBenchKeySequenceRun(
          viewportRef.current ?? document.body,
          query.adapterId,
          scriptName,
          { key: "ArrowDown", shiftKey: true, count: 30 },
        )
      : null
    : scriptName === "keyboard-nav-row"
      ? query.adapterId === "pretable"
        ? await measureBenchKeySequenceRun(
            viewportRef.current ?? document.body,
            query.adapterId,
            scriptName,
            { key: "ArrowDown", count: 60 },
          )
        : null
      : scriptName === "select-all"
        ? query.adapterId === "pretable"
          ? await measureBenchKeySequenceRun(
              viewportRef.current ?? document.body,
              query.adapterId,
              scriptName,
              { key: "a", metaKey: true, count: 1 },
            )
          : null
        : null;
```

- [ ] **Step 3.4: Extend the `nextResult` ternary chain**

Add a branch that consumes `keySequenceRun` to produce the summary, mirroring the existing `interactionRun` branch:

```ts
const nextResult =
  scriptName === "scroll" && scrollRun
    ? createBenchRunSummary({ /* existing scroll branch */ })
    : (scriptName === "select-range-extend" ||
       scriptName === "keyboard-nav-row" ||
       scriptName === "select-all") && keySequenceRun
      ? createBenchRunSummary({
          request,
          status: keySequenceRun.status,
          timestamp,
          tracePath,
          notes: [
            ...keySequenceRun.notes,
            ...createPretableTelemetryNotes(pretableTelemetryRef.current),
          ],
          metrics: keySequenceRun.metrics,
        })
      : /* other existing branches */;
```

- [ ] **Step 3.5: Typecheck and run bench-app tests**

```bash
pnpm --filter @pretable/app-bench typecheck
pnpm --filter @pretable/app-bench test
```

Expected: passes. The new dispatch only fires for the new scripts; existing tests are unaffected.

- [ ] **Step 3.6: Commit**

```bash
git add apps/bench/src/bench-app.tsx
git commit -m "feat(bench-app): dispatch select-range-extend / keyboard-nav-row / select-all

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4 — Cell-renderer column flavors in the pretable adapter

**Files:**

- Modify: `apps/bench/src/pretable-adapter.tsx`

The three D3 scripts reuse `measureBenchScrollRun`. The only difference is the column configuration the pretable adapter mounts with. We thread `scriptName` to drive the column flavor.

- [ ] **Step 4.1: Read the current adapter mount and column configuration**

```bash
grep -n "columns\|scriptName" apps/bench/src/pretable-adapter.tsx | head -20
```

Find where columns are constructed for the bench mount.

- [ ] **Step 4.2: Add a `scriptName`-driven column override helper**

Inside `pretable-adapter.tsx` (or a sibling helper file `pretable-adapter-column-flavors.ts` if cleaner), add:

```ts
import type { PretableColumn } from "@pretable/react";

type CellRendererFlavor =
  | "scroll-with-format"
  | "scroll-with-render"
  | "scroll-with-heavy-render";

function applyCellRendererFlavor<TRow extends Record<string, unknown>>(
  columns: PretableColumn<TRow>[],
  flavor: CellRendererFlavor | null,
): PretableColumn<TRow>[] {
  if (flavor === null) {
    return columns;
  }
  if (flavor === "scroll-with-format") {
    return columns.map((column) => ({
      ...column,
      format: ({ value }) =>
        Array.isArray(value) ? value.join(", ") : String(value ?? ""),
    }));
  }
  if (flavor === "scroll-with-render") {
    return columns.map((column) => ({
      ...column,
      render: ({ formattedValue }) => (
        <span data-bench-render="cheap">{formattedValue}</span>
      ),
    }));
  }
  // scroll-with-heavy-render
  return columns.map((column) => ({
    ...column,
    render: ({ formattedValue, value }) => (
      <span
        data-bench-render="heavy"
        data-bench-status={String(value)}
        className="bench-status-badge"
      >
        <span className="bench-badge-dot" aria-hidden />
        <span>{formattedValue}</span>
      </span>
    ),
  }));
}
```

- [ ] **Step 4.3: Apply the flavor at mount time**

Inside the adapter component, where the columns array is defined, pass it through `applyCellRendererFlavor`:

```ts
const flavoredColumns = useMemo(
  () =>
    applyCellRendererFlavor(
      baseColumns,
      isCellRendererScript(query.scriptName) ? query.scriptName : null,
    ),
  [baseColumns, query.scriptName],
);

// then pass flavoredColumns to <PretableSurface columns={flavoredColumns} ...>
```

Helper to detect cell-renderer scripts:

```ts
function isCellRendererScript(
  s: string,
): s is
  | "scroll-with-format"
  | "scroll-with-render"
  | "scroll-with-heavy-render" {
  return (
    s === "scroll-with-format" ||
    s === "scroll-with-render" ||
    s === "scroll-with-heavy-render"
  );
}
```

- [ ] **Step 4.4: Typecheck**

```bash
pnpm --filter @pretable/app-bench typecheck
```

Expected: passes.

- [ ] **Step 4.5: Commit**

```bash
git add apps/bench/src/pretable-adapter.tsx
git commit -m "feat(bench): cell-renderer column flavors in pretable adapter

Adds applyCellRendererFlavor helper. When the active scriptName is one
of scroll-with-format / scroll-with-render / scroll-with-heavy-render,
the adapter wraps base columns with format / render configuration to
exercise the D3 cell-renderer pipeline.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5 — Wire bench-app dispatch for cell-renderer scripts

**Files:**

- Modify: `apps/bench/src/bench-app.tsx`

The three cell-renderer scripts reuse `measureBenchScrollRun`. The dispatch is simpler than Task 3 — same scroll measurement, just for additional script names.

- [ ] **Step 5.1: Extend the existing `scrollRun` capture to cover the three new scripts**

Find the line:

```ts
const scrollRun =
  scriptName === "scroll"
    ? await measureBenchScrollRun(...)
    : null;
```

Update to:

```ts
const scrollRun =
  scriptName === "scroll" ||
  scriptName === "scroll-with-format" ||
  scriptName === "scroll-with-render" ||
  scriptName === "scroll-with-heavy-render"
    ? await measureBenchScrollRun(
        viewportRef.current ?? document.body,
        query.adapterId,
      )
    : null;
```

- [ ] **Step 5.2: Extend the `nextResult` branch for scroll**

Find:

```ts
scriptName === "scroll" && scrollRun
  ? createBenchRunSummary({ /* ... */ })
```

Update to:

```ts
(scriptName === "scroll" ||
 scriptName === "scroll-with-format" ||
 scriptName === "scroll-with-render" ||
 scriptName === "scroll-with-heavy-render") && scrollRun
  ? createBenchRunSummary({ /* same shape as before */ })
```

- [ ] **Step 5.3: Typecheck and test**

```bash
pnpm --filter @pretable/app-bench typecheck
pnpm --filter @pretable/app-bench test
```

Expected: passes.

- [ ] **Step 5.4: Commit**

```bash
git add apps/bench/src/bench-app.tsx
git commit -m "feat(bench-app): dispatch scroll-with-format / -render / -heavy-render via measureBenchScrollRun

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6 — Comparator adapters return `unsupported` for new scripts

**Files:**

- Modify: `apps/bench/src/ag-grid-adapter.tsx` (or whatever the renamed `gridalpha` file is)
- Modify: `apps/bench/src/tanstack-adapter.tsx` (`gridbeta`)
- Modify: `apps/bench/src/mui-adapter.tsx` (`gridgamma`)

(Adapter filenames may differ; verify via `grep -rln "BenchAdapter" apps/bench/src` before editing.)

- [ ] **Step 6.1: Find the existing "unsupported script" pattern**

```bash
grep -rn "unsupported\|UnsupportedBenchRun" apps/bench/src 2>/dev/null | head
```

Each comparator adapter likely already has a list of supported scripts (e.g., `scroll`, `sort`, `filter-metadata`, `filter-text`) and a check that returns `{ kind: "unsupported", reason: "..." }` for anything else.

- [ ] **Step 6.2: Verify the new scripts already fall through to `unsupported`**

If the comparator adapters use a `switch (scriptName)` or `if (!supportedScripts.includes(scriptName))` check, the six new scripts may already be handled by the default branch. Run:

```bash
pnpm --filter @pretable/app-bench typecheck
```

If TypeScript reports unhandled cases (exhaustive switch), add explicit `case` branches that return the unsupported result. Otherwise no change needed.

- [ ] **Step 6.3: Commit if changes were needed**

```bash
git add apps/bench/src/<adapter>.tsx
git commit -m "feat(bench): comparator adapters mark new scripts as unsupported

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

If no changes were needed (the existing default branch already handles the new scripts), skip the commit.

---

## Task 7 — Add `evaluateH16`–`evaluateH21` in `bench-matrix.mjs`

**Files:**

- Modify: `scripts/bench-matrix.mjs`

- [ ] **Step 7.1: Read the existing evaluator pattern**

```bash
grep -n "function evaluateH\\|function evaluateInteractionHypothesis\\|input.runs" scripts/bench-matrix.mjs | head -20
```

Note the helper functions used by the existing evaluators: `findRunSeries`, `summarizeRunSeriesEvidence`, `medianMetric`, `maxMetric`. The new evaluators reuse these.

- [ ] **Step 7.2: Add `evaluateH16` (selection extend latency)**

Append to `scripts/bench-matrix.mjs` (after the existing `evaluateH15`):

```js
/**
 * H16 — selection-extend latency.
 *
 * Slice: S2/hypothesis/pretable/select-range-extend.
 * Threshold: interaction_latency_ms p95 across 30 shift+ArrowDown extends < 16ms
 * (single-frame budget at 60Hz). The script's measureBenchKeySequenceRun
 * helper computes the p95 internally and reports it as
 * interaction_latency_ms.
 *
 * Status:
 * - satisfied: every repeat clears 16ms.
 * - failing: any repeat exceeds 16ms.
 * - insufficient: no completed runs.
 */
function evaluateH16(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "select-range-extend",
  });

  if (series.length === 0) {
    return {
      id: "H16",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable select-range-extend runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const latency = evidence.metrics.interaction_latency_ms;

  if (latency === undefined || latency > 16) {
    return {
      id: "H16",
      status: "failing",
      summary: `Selection extend latency p95 is ${latency ?? "missing"}ms (threshold: ≤ 16ms).`,
      evidence: [evidence],
    };
  }

  return {
    id: "H16",
    status: "satisfied",
    summary: `Selection extend p95 is ${latency}ms (≤ 16ms single-frame budget).`,
    evidence: [evidence],
  };
}
```

- [ ] **Step 7.3: Add `evaluateH17` (keyboard nav latency)**

```js
/**
 * H17 — keyboard nav latency. Same shape as H16, different script.
 */
function evaluateH17(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "keyboard-nav-row",
  });

  if (series.length === 0) {
    return {
      id: "H17",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable keyboard-nav-row runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const latency = evidence.metrics.interaction_latency_ms;

  if (latency === undefined || latency > 16) {
    return {
      id: "H17",
      status: "failing",
      summary: `Keyboard nav latency p95 is ${latency ?? "missing"}ms (threshold: ≤ 16ms).`,
      evidence: [evidence],
    };
  }

  return {
    id: "H17",
    status: "satisfied",
    summary: `Keyboard nav p95 is ${latency}ms (≤ 16ms single-frame budget).`,
    evidence: [evidence],
  };
}
```

- [ ] **Step 7.4: Add `evaluateH18` (select-all latency)**

```js
/**
 * H18 — select-all end-to-end latency. Single event; threshold 33ms (two-frame
 * budget — one-time cost is acceptable).
 */
function evaluateH18(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "select-all",
  });

  if (series.length === 0) {
    return {
      id: "H18",
      status: "insufficient",
      summary: "No completed S2/hypothesis pretable select-all runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const latency = evidence.metrics.interaction_latency_ms;

  if (latency === undefined || latency > 33) {
    return {
      id: "H18",
      status: "failing",
      summary: `Select-all latency is ${latency ?? "missing"}ms (threshold: ≤ 33ms).`,
      evidence: [evidence],
    };
  }

  return {
    id: "H18",
    status: "satisfied",
    summary: `Select-all latency is ${latency}ms (≤ 33ms two-frame budget).`,
    evidence: [evidence],
  };
}
```

- [ ] **Step 7.5: Add `evaluateH19` (scroll-with-format vs baseline)**

```js
/**
 * H19 — format overhead bound. The S2/hypothesis/pretable/scroll-with-format
 * slice's scroll_frame_p95_ms is compared to the sibling
 * S2/hypothesis/pretable/scroll slice in the same runset. Threshold: format
 * adds at most 2ms to scroll p95.
 */
function evaluateH19(runs) {
  const formatSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "scroll-with-format",
  });
  const baselineSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "scroll",
  });

  if (formatSeries.length === 0) {
    return {
      id: "H19",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable scroll-with-format runs available.",
      evidence: [],
    };
  }

  if (baselineSeries.length === 0) {
    return {
      id: "H19",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable scroll baseline available — H19 requires both.",
      evidence: [],
    };
  }

  const formatEvidence = summarizeRunSeriesEvidence(formatSeries);
  const baselineEvidence = summarizeRunSeriesEvidence(baselineSeries);
  const formatP95 = formatEvidence.metrics.scroll_frame_p95_ms;
  const baselineP95 = baselineEvidence.metrics.scroll_frame_p95_ms;

  if (formatP95 === undefined || baselineP95 === undefined) {
    return {
      id: "H19",
      status: "insufficient",
      summary:
        "scroll_frame_p95_ms missing from format or baseline run — cannot evaluate.",
      evidence: [formatEvidence, baselineEvidence],
    };
  }

  const overhead = formatP95 - baselineP95;
  if (overhead > 2) {
    return {
      id: "H19",
      status: "failing",
      summary: `Format overhead is ${overhead.toFixed(2)}ms (threshold: ≤ 2ms; format ${formatP95}ms vs baseline ${baselineP95}ms).`,
      evidence: [formatEvidence, baselineEvidence],
    };
  }

  return {
    id: "H19",
    status: "satisfied",
    summary: `Format overhead is ${overhead.toFixed(2)}ms (≤ 2ms; format ${formatP95}ms, baseline ${baselineP95}ms).`,
    evidence: [formatEvidence, baselineEvidence],
  };
}
```

- [ ] **Step 7.6: Add `evaluateH20` and `evaluateH21` (cheap and heavy render)**

```js
/**
 * H20 — cheap render holds single-frame budget.
 */
function evaluateH20(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "scroll-with-render",
  });

  if (series.length === 0) {
    return {
      id: "H20",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable scroll-with-render runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const p95 = evidence.metrics.scroll_frame_p95_ms;

  if (p95 === undefined || p95 > 16) {
    return {
      id: "H20",
      status: "failing",
      summary: `scroll_frame_p95_ms with cheap render is ${p95 ?? "missing"}ms (threshold: ≤ 16ms).`,
      evidence: [evidence],
    };
  }

  return {
    id: "H20",
    status: "satisfied",
    summary: `Cheap render scroll p95 is ${p95}ms (≤ 16ms single-frame budget).`,
    evidence: [evidence],
  };
}

/**
 * H21 — heavy render degrades gracefully.
 */
function evaluateH21(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "scroll-with-heavy-render",
  });

  if (series.length === 0) {
    return {
      id: "H21",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable scroll-with-heavy-render runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const p95 = evidence.metrics.scroll_frame_p95_ms;

  if (p95 === undefined || p95 > 20) {
    return {
      id: "H21",
      status: "failing",
      summary: `scroll_frame_p95_ms with heavy render is ${p95 ?? "missing"}ms (threshold: ≤ 20ms).`,
      evidence: [evidence],
    };
  }

  return {
    id: "H21",
    status: "satisfied",
    summary: `Heavy render scroll p95 is ${p95}ms (≤ 20ms; ≤ 25% above single-frame budget).`,
    evidence: [evidence],
  };
}
```

- [ ] **Step 7.7: Register the new evaluators**

Find the section that calls all `evaluate*` functions (around line 148–160 in `scripts/bench-matrix.mjs`):

```js
evaluateH13(input.runs),
evaluateH14(input.runs),
evaluateH15(input.runs),
```

Append:

```js
evaluateH13(input.runs),
evaluateH14(input.runs),
evaluateH15(input.runs),
evaluateH16(input.runs),
evaluateH17(input.runs),
evaluateH18(input.runs),
evaluateH19(input.runs),
evaluateH20(input.runs),
evaluateH21(input.runs),
```

- [ ] **Step 7.8: Run the existing matrix test to verify the new evaluators don't break it**

```bash
pnpm test --filter scripts
```

Or if there's a specific path:

```bash
node --test scripts/__tests__/bench-matrix.test.mjs
```

Expected: existing tests pass. The new evaluators return `insufficient` against the existing fixture (which lacks the new scripts), which is fine.

- [ ] **Step 7.9: Commit**

```bash
git add scripts/bench-matrix.mjs
git commit -m "feat(bench-matrix): evaluateH16-H21 hypothesis evaluators

H16 selection-extend latency (16ms single-frame), H17 keyboard-nav
latency (16ms), H18 select-all latency (33ms two-frame), H19 format
overhead (≤ baseline + 2ms), H20 cheap render (16ms), H21 heavy
render (20ms ≤ 25% above frame budget). All thresholds against
S2/hypothesis/pretable.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8 — Unit tests for the new helpers and evaluators

**Files:**

- Modify: `apps/bench/src/__tests__/bench-runtime.test.ts`
- Modify: `scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 8.1: Add a test for `measureBenchKeySequenceRun`**

Open `apps/bench/src/__tests__/bench-runtime.test.ts`. Find the existing tests for measurement helpers; mirror the pattern.

```ts
import { describe, expect, test, vi } from "vitest";
import { measureBenchKeySequenceRun } from "../bench-runtime";

describe("measureBenchKeySequenceRun", () => {
  test("dispatches the requested key the requested number of times and reports p95", async () => {
    const root = document.createElement("div");
    root.dataset.benchAdapter = "pretable";
    const viewport = document.createElement("div");
    viewport.setAttribute("data-pretable-scroll-viewport", "");
    root.appendChild(viewport);
    const cell = document.createElement("div");
    cell.setAttribute("data-pretable-cell", "");
    cell.setAttribute("tabindex", "0");
    viewport.appendChild(cell);
    document.body.appendChild(root);

    const dispatched: string[] = [];
    cell.addEventListener("keydown", (event) => {
      dispatched.push(event.key);
    });

    const result = await measureBenchKeySequenceRun(
      root,
      "pretable",
      "select-range-extend",
      {
        key: "ArrowDown",
        shiftKey: true,
        count: 5,
        framesBetween: 1,
      },
    );

    expect(result.status).toBe("completed");
    expect(dispatched.length).toBe(5);
    expect(dispatched.every((k) => k === "ArrowDown")).toBe(true);
    expect(result.metrics.interaction_latency_ms).toBeGreaterThanOrEqual(0);

    document.body.removeChild(root);
  });

  test("returns partial when no viewport is present", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);

    const result = await measureBenchKeySequenceRun(
      root,
      "pretable",
      "keyboard-nav-row",
      {
        key: "ArrowDown",
        count: 10,
      },
    );

    expect(result.status).toBe("partial");
    expect(result.notes.some((n) => n.includes("viewport unavailable"))).toBe(
      true,
    );

    document.body.removeChild(root);
  });
});
```

(The existing test pattern in this file may use jsdom helpers — check before adding. If `waitForAnimationFrame` doesn't exist in jsdom, you may need to mock it or use a fake-timer setup. Test infrastructure setup matches the existing tests in this file.)

- [ ] **Step 8.2: Add tests for the new evaluators in `scripts/__tests__/bench-matrix.test.mjs`**

Mirror the existing evaluator tests. For each new H16–H21:

- Synthetic-runset fixture exercises the satisfied / failing / insufficient paths.
- Threshold values match the spec.

Example for H16:

```js
test("evaluateH16 satisfied when latency p95 < 16ms", () => {
  const runs = [
    {
      adapterId: "pretable",
      scenarioId: "S2",
      scale: "hypothesis",
      scriptName: "select-range-extend",
      status: "completed",
      metrics: { interaction_latency_ms: 12 },
    },
  ];

  const result = evaluateH16(runs);
  expect(result.id).toBe("H16");
  expect(result.status).toBe("satisfied");
});

test("evaluateH16 failing when latency p95 > 16ms", () => {
  const runs = [
    {
      adapterId: "pretable",
      scenarioId: "S2",
      scale: "hypothesis",
      scriptName: "select-range-extend",
      status: "completed",
      metrics: { interaction_latency_ms: 22 },
    },
  ];

  expect(evaluateH16(runs).status).toBe("failing");
});

test("evaluateH16 insufficient when no runs", () => {
  expect(evaluateH16([]).status).toBe("insufficient");
});
```

Repeat the pattern for H17, H18, H20, H21 (single-slice evaluators) and a slightly more elaborate fixture for H19 (which compares format slice to baseline scroll slice).

- [ ] **Step 8.3: Run the tests**

```bash
pnpm --filter @pretable/app-bench test bench-runtime
node --test scripts/__tests__/bench-matrix.test.mjs
```

Expected: all pass.

- [ ] **Step 8.4: Commit**

```bash
git add apps/bench/src/__tests__/bench-runtime.test.ts scripts/__tests__/bench-matrix.test.mjs
git commit -m "test(bench): unit coverage for measureBenchKeySequenceRun + H16-H21 evaluators

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9 — Run the matrix and capture evidence

**Files:**

- Add: `status/runsets/<runset-id>/...` (output files generated by the run)

- [ ] **Step 9.1: Verify the bench harness is in a clean state**

```bash
cd /Users/blove/repos/pretable/.worktrees/bench-slab1
pnpm --filter @pretable/app-bench build
```

Expected: build succeeds. The harness needs a fresh build so the new scripts and column flavors are baked into the served bundle.

- [ ] **Step 9.2: Run the matrix**

```bash
pnpm bench:matrix \
  --project=chromium \
  --adapters=pretable \
  --scenarios=S2 \
  --scripts=initial,scroll,select-range-extend,keyboard-nav-row,select-all,scroll-with-format,scroll-with-render,scroll-with-heavy-render \
  --scale=hypothesis \
  --repeats=3
```

Expected wall-clock: ~70 minutes. Output is committed under `status/runsets/<runset-id>/` automatically by the matrix runner.

- [ ] **Step 9.3: Inspect the output**

```bash
ls -lt status/runsets/ | head
```

The most recent runset directory contains:

- `runs.json` or per-run summary files
- `hypotheses.json` with the evaluated H16–H21 results

Read `hypotheses.json` and verify each new hypothesis is `satisfied`. If any are `failing`, STOP — do not proceed to the PR. Profile the cause, land a fix in shared code (NOT the threshold), and re-run from Step 9.2.

- [ ] **Step 9.4: Commit the runset evidence**

```bash
git add status/runsets/<runset-id>
git commit -m "chore(bench): S2/hypothesis runset for tier 1 bench slab 1

Repeated Chromium S2/hypothesis evidence covering 8 scripts × 3 repeats:
initial, scroll (baseline for H19), select-range-extend, keyboard-nav-row,
select-all, scroll-with-format, scroll-with-render, scroll-with-heavy-render.

H16-H21 satisfied; H1 (existing scroll wedge) holds against the same
runset's S2/scroll slice.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

(Replace `<runset-id>` with the actual directory name from Step 9.3.)

---

## Task 10 — Update repo-memory checkpoint

**Files:**

- Modify: `docs/research/repo-memory.md`

- [ ] **Step 10.1: Append a new milestone entry**

Open `docs/research/repo-memory.md`. After the most recent entry, append:

```md
## 2026-05-07

### Tier 1 Bench Slab 1 satisfied

- B Phase 7 selection/keyboard-nav latency hypotheses (H16, H17, H18) and D3 cell-renderer hypotheses (H19, H20, H21) shipped together as a single sub-project.
- New `BenchScriptName` values: `select-range-extend`, `keyboard-nav-row`, `select-all`, `scroll-with-format`, `scroll-with-render`, `scroll-with-heavy-render`.
- Pretable-internal absolute thresholds; comparator adapters mark `unsupported` (Slab 2 deferred to future B2 / D-bench-2).
- All six hypotheses satisfied at S2/hypothesis on Chromium across ×3 repeats. Evidence at `status/runsets/<runset-id>/` (linked above in the commit log).
- H1 (scroll wedge) on the same runset's `S2/scroll/pretable` slice still satisfied — H19's baseline is the same slice.

### Next checkpoint

- A — public API stabilization (audit, contract tests).
- B2 / D-bench-2 — comparative bench (Slab 2) for selection/nav and cell renderers.
```

- [ ] **Step 10.2: Commit**

```bash
git add docs/research/repo-memory.md
git commit -m "docs(research): repo-memory milestone — tier 1 bench slab 1

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11 — Repo-wide gates and PR

- [ ] **Step 11.1: Run repo-wide typecheck**

```bash
pnpm -w typecheck
```

Expected: passes.

- [ ] **Step 11.2: Run repo-wide tests**

```bash
pnpm -w test
```

Expected: all tests pass.

- [ ] **Step 11.3: Run lint and format**

```bash
pnpm -w lint
pnpm format
```

Expected: 0 lint errors. If `pnpm format` reports issues, run `pnpm prettier --write .` and commit as `style: prettier --write`.

- [ ] **Step 11.4: Push branch and open PR**

```bash
git push -u origin bench-slab1
gh pr create --title "feat(bench): Tier 1 Bench Slab 1 — selection/nav + cell-renderer hypotheses (H16-H21)" --body "$(cat <<'EOF'
## Summary

Closes the two deferred bench phases (B Phase 7 selection/nav hypotheses H16/H17/H18, D3 cell-renderer hypotheses H19/H20/H21) in one combined sub-project. Spec: \`docs/superpowers/specs/2026-05-07-tier1-bench-slab1-design.md\`. Plan: \`docs/superpowers/plans/2026-05-07-tier1-bench-slab1.md\`.

## Bench infrastructure

- Six new \`BenchScriptName\` values: \`select-range-extend\`, \`keyboard-nav-row\`, \`select-all\`, \`scroll-with-format\`, \`scroll-with-render\`, \`scroll-with-heavy-render\`.
- New \`measureBenchKeySequenceRun\` helper in \`apps/bench/src/bench-runtime.ts\` for keyboard-driven scripts (per-event latency, p95 reported as \`interaction_latency_ms\`).
- Cell-renderer scripts reuse \`measureBenchScrollRun\`; pretable adapter applies a column-flavor override at mount time driven by \`query.scriptName\`.
- Comparator adapters return \`unsupported\` for new scripts (Slab 2 deferred).
- Six new evaluators in \`scripts/bench-matrix.mjs\`.

## Hypotheses

| # | Slice | Threshold |
|---|---|---|
| H16 | S2/hyp/pretable/select-range-extend | interaction p95 < 16ms |
| H17 | S2/hyp/pretable/keyboard-nav-row | interaction p95 < 16ms |
| H18 | S2/hyp/pretable/select-all | interaction < 33ms |
| H19 | S2/hyp/pretable/scroll-with-format | scroll_frame_p95 ≤ baseline + 2ms |
| H20 | S2/hyp/pretable/scroll-with-render | scroll_frame_p95 ≤ 16ms |
| H21 | S2/hyp/pretable/scroll-with-heavy-render | scroll_frame_p95 ≤ 20ms |

## Evidence

Repeated Chromium S2/hypothesis runs (×3 repeats × 8 scripts) committed under \`status/runsets/<runset-id>/\`. All six new hypotheses satisfied. H1 on the same runset's \`S2/scroll/pretable\` slice still satisfied (no regression).

## What's NOT in this PR

- Comparative (Slab 2) bench for selection/nav (future B2).
- Comparative (Slab 2) bench for cell renderers (future D-bench-2).
- Public API stabilization (sub-project A — paused 2026-05-07; resumes after this merges).

## Test plan

- [x] \`pnpm -w typecheck\` clean
- [x] \`pnpm -w test\` passes — including new bench-runtime + bench-matrix evaluator tests
- [x] \`pnpm -w lint\` 0 errors
- [x] \`pnpm format\` clean
- [x] H16-H21 all \`satisfied\` per the committed runset
- [x] No regression in existing hypotheses on the same runset

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 11.5: Set auto-merge and notify the user**

```bash
gh pr merge <pr-number> --auto --squash
```

Per the standing workflow, the user merges (auto-merge fires once CI passes; if branch protection requires manual review, defer to user).

---

## Self-Review

**Spec coverage check** (against `2026-05-07-tier1-bench-slab1-design.md`):

| Spec section                                         | Covered by                               |
| ---------------------------------------------------- | ---------------------------------------- |
| Six new BenchScriptName values                       | Task 1                                   |
| measureBenchKeySequenceRun helper                    | Task 2                                   |
| Bench-app dispatch for selection/nav scripts         | Task 3                                   |
| Cell-renderer column flavors in pretable adapter     | Task 4                                   |
| Bench-app dispatch for cell-renderer scripts         | Task 5                                   |
| Comparator adapters mark unsupported                 | Task 6                                   |
| evaluateH16–H21 in bench-matrix.mjs                  | Task 7                                   |
| Unit tests for helper + evaluators                   | Task 8                                   |
| Run matrix + commit evidence                         | Task 9                                   |
| Update repo-memory.md                                | Task 10                                  |
| Phase structure (single PR, 8+ commits-of-record)    | Tasks 1-11 each commit                   |
| Threshold realism (fix the cause, not the threshold) | Task 9 Step 9.3 STOP-and-fix instruction |
| Hypothesis numbering H16-H21                         | Task 7                                   |
| Single matrix invocation                             | Task 9 Step 9.2                          |

All spec sections covered.

**Placeholder scan:** None remain. The `<runset-id>` placeholder in Task 9 Step 9.4 is intentional — the actual directory name is generated by the matrix runner at run time and substituted at commit time.

**Type consistency check:**

- `BenchScriptName` union order in Task 1 is preserved across Task 1.1, 1.3 (Extract narrow), and the existing constant list mentioned in 1.2.
- `measureBenchKeySequenceRun` signature in Task 2.2 matches the call sites in Task 3.3.
- `KeySequenceOptions` shape (key, shiftKey?, ctrlKey?, metaKey?, count, framesBetween?) consistent.
- `applyCellRendererFlavor` signature in Task 4.2 matches the call site in Task 4.3.
- Hypothesis IDs H16-H21 in Task 7 match the spec's hypothesis table.

**Scope check:** Single sub-project, single PR, 11 tasks. Each task produces self-contained changes that make sense independently. The matrix-run task (9) is the heaviest single step in wall-clock cost but has clear stop-and-fix semantics if a hypothesis fails.

---

## After this PR merges

- Remove the two deferred-bench memory files:
  - `~/.claude/projects/-Users-blove-repos-pretable/memory/project_phase7_bench_slab1_deferred.md`
  - `~/.claude/projects/-Users-blove-repos-pretable/memory/project_phase_d3_bench_deferred.md`
- Remove their entries from `~/.claude/projects/-Users-blove-repos-pretable/memory/MEMORY.md`.
- Resume sub-project A (public API stabilization) per the revised priority.
