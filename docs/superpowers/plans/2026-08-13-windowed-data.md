# Windowed Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let pretable hold a contiguous window onto a dataset larger than memory, with scroll geometry and ARIA positions staying honest.

**Architecture:** `planViewport` gains optional leading/trailing spacer heights so unloaded regions become pure geometry rather than rows — no `aria-rowindex` consumed, no focus/selection/copy exemptions, which is what keeps the design's no-placeholder rule intact. `resultMeta.window` carries `{ start, hasMore }`; the surface derives spacer heights from it. ARIA generalizes from "contiguous prefix" to "contiguous window at a known offset." A `windowGap` telemetry field tells consumers when the viewport has passed an edge.

**Tech Stack:** TypeScript, React, vitest, Playwright (`apps/bench/tests/`), API Extractor.

**Spec:** `docs/superpowers/specs/2026-08-13-windowed-data-design.md`

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/layout-core/src/types.ts:187` | `PlanViewportInput` | +2 optional spacer fields |
| `packages/layout-core/src/viewport-plan.ts` | The planner | Offset arithmetic |
| `packages/layout-core/src/__tests__/viewport-window.test.ts` | Geometry proof | **Create** |
| `packages/grid-core/src/types.ts:204` | `PretableResultMeta` | +`window` |
| `packages/react/src/pretable-surface.tsx:4588` | `aria-rowindex` | +offset |
| `packages/react/src/data-scope.ts` | Honesty rules | Generalize the guard |
| `packages/react/src/surface-types.ts:70` | Telemetry | +`windowGap` |
| `apps/bench/tests/windowed-data.spec.ts` | Browser proof | **Create** |

**Order matters.** Task 4 is a gate: if it fails, the spec's placement decision is wrong and Tasks 5–6 must not proceed as written.

---

### Task 1: Spacer geometry in the planner

**Files:**
- Modify: `packages/layout-core/src/types.ts:187-194`
- Modify: `packages/layout-core/src/viewport-plan.ts`
- Test: `packages/layout-core/src/__tests__/viewport-window.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/layout-core/src/__tests__/viewport-window.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createRowHeightIndex } from "../row-height-index";
import { planViewport } from "../viewport-plan";

/**
 * A 100,000-row dataset with rows 40,000..40,099 loaded. Everything outside
 * that window is pure geometry — no rows are materialized for it, so it
 * consumes no `aria-rowindex` and needs no focus/selection/copy exemptions,
 * which is what the no-placeholder-rows rule requires.
 */
const ROW_H = 40;
const WINDOW_START = 40_000;
const WINDOW_ROWS = 100;
const DATASET_ROWS = 100_000;

const loadedWindow = () =>
  createRowHeightIndex({
    defaultHeight: ROW_H,
    getKey: (key: number) => key,
    rows: Array.from({ length: WINDOW_ROWS }, (_, key) => ({
      key,
      estimatedHeight: ROW_H,
    })),
  });

const leading = WINDOW_START * ROW_H;
const trailing = (DATASET_ROWS - WINDOW_START - WINDOW_ROWS) * ROW_H;

const planAt = (scrollTop: number) =>
  planViewport({
    scrollTop,
    viewportHeight: 400,
    overscan: 0,
    rowMetrics: loadedWindow(),
    leadingHeight: leading,
    trailingHeight: trailing,
  });

describe("windowed viewport", () => {
  test("extent spans the dataset while only the window is materialized", () => {
    const plan = planAt(leading);
    expect(plan.totalHeight).toBe(DATASET_ROWS * ROW_H);
    expect(plan.rows.length).toBeLessThanOrEqual(WINDOW_ROWS);
  });

  test("the window's first row sits after the leading spacer", () => {
    const plan = planAt(leading);
    expect(plan.range.start).toBe(0);
    expect(plan.rows[0]?.top).toBe(leading);
    expect(plan.rows[0]?.index).toBe(0);
  });

  test("scrolling into the window resolves the right local row", () => {
    const plan = planAt(leading + 10 * ROW_H);
    expect(plan.range.start).toBe(10);
    expect(plan.rows[0]?.top).toBe(leading + 10 * ROW_H);
  });

  test("a local index maps back to its dataset index", () => {
    const plan = planAt(leading + 10 * ROW_H);
    expect(WINDOW_START + (plan.rows[0]?.index ?? -1)).toBe(40_010);
  });

  test("without spacers the planner is unchanged", () => {
    const plan = planViewport({
      scrollTop: 0,
      viewportHeight: 400,
      overscan: 0,
      rowMetrics: loadedWindow(),
    });
    expect(plan.totalHeight).toBe(WINDOW_ROWS * ROW_H);
    expect(plan.rows[0]?.top).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/layout-core && npx vitest run src/__tests__/viewport-window.test.ts
```

Expected: FAIL — `leadingHeight`/`trailingHeight` are not accepted, and `totalHeight` is 4,000 rather than 4,000,000.

- [ ] **Step 3: Add the two inputs**

In `packages/layout-core/src/types.ts`, inside `PlanViewportInput` (line 187), after `rowMetrics`:

```ts
  /** Geometry for rows before the window. Never materialized as rows. */
  leadingHeight?: number;
  /** Geometry for rows after the window. Never materialized as rows. */
  trailingHeight?: number;
```

- [ ] **Step 4: Implement the offset arithmetic**

In `packages/layout-core/src/viewport-plan.ts`, replace lines 10–12:

```ts
  const rowMetrics = input.rowMetrics;
  const totalHeight = rowMetrics.getTotalHeight();
  const rowCount = rowMetrics.rowCount;
```

with:

```ts
  const rowMetrics = input.rowMetrics;
  // Unloaded regions are pure geometry: no rows are materialized for them, so
  // they consume no aria-rowindex and need no focus/selection/copy exemptions.
  // That is what lets the extent span more than the loaded window without
  // violating the no-placeholder-rows rule.
  const leading = Math.max(0, input.leadingHeight ?? 0);
  const trailing = Math.max(0, input.trailingHeight ?? 0);
  const totalHeight = leading + rowMetrics.getTotalHeight() + trailing;
  const rowCount = rowMetrics.rowCount;
```

Then replace the `visibleStart` block:

```ts
  const visibleStart = Math.min(
    rowCount - 1,
    rowMetrics.getIndexForOffset(clampedScrollTop),
  );
```

with:

```ts
  // Offsets inside the loaded window are measured from the window's own top.
  const windowScrollTop = Math.max(0, clampedScrollTop - leading);
  const visibleStart = Math.min(
    rowCount - 1,
    rowMetrics.getIndexForOffset(windowScrollTop),
  );
```

Change the `visibleEndExclusive` argument from `clampedScrollTop + Math.max(0, input.viewportHeight)` to `windowScrollTop + Math.max(0, input.viewportHeight)`.

Change `let top = rowMetrics.getOffsetForIndex(start);` to `let top = leading + rowMetrics.getOffsetForIndex(start);`.

- [ ] **Step 5: Run to verify it passes**

```bash
cd packages/layout-core && npx vitest run
```

Expected: PASS, all files. The "without spacers" test is the regression guard.

- [ ] **Step 6: Prove the geometry test discriminates**

Temporarily change `leadingHeight: leading` to `leadingHeight: 0` in `planAt`. Re-run.

Expected: FAIL on extent and row-top assertions. Restore and confirm PASS. Report both.

- [ ] **Step 7: Commit**

```bash
git add packages/layout-core/src/types.ts packages/layout-core/src/viewport-plan.ts packages/layout-core/src/__tests__/viewport-window.test.ts
git commit -m "feat(layout-core): spacer geometry for windowed data

Unloaded regions become geometry rather than rows, so they consume no
aria-rowindex and need no focus/selection/copy exemptions."
```

---

### Task 2: `window` on `PretableResultMeta`

**Files:**
- Modify: `packages/grid-core/src/types.ts:204-208`

- [ ] **Step 1: Add the field**

Replace:

```ts
export interface PretableResultMeta {
  total?: PretableMatchingTotal;
  /** Stable identity for the query/result population represented by the rows. */
  datasetKey?: string;
}
```

with:

```ts
export interface PretableResultMeta {
  total?: PretableMatchingTotal;
  /** Stable identity for the query/result population represented by the rows. */
  datasetKey?: string;
  /**
   * Where the loaded rows sit inside the population, when they are a window
   * rather than a prefix. Absent means the classic prefix case.
   *
   * `hasMore` rather than a remaining count: a keyset cursor walks forward, so
   * the extent must promise only what is fetchable. A count would invite a
   * scrollbar that reaches rows the cursor cannot serve.
   */
  window?: {
    /** Dataset index of `rows[0]`. */
    readonly start: number;
    /** Whether anything follows this window. NOT how much. */
    readonly hasMore: boolean;
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: PASS. This step adds a type only; nothing reads it yet.

- [ ] **Step 3: Commit**

```bash
git add packages/grid-core/src/types.ts
git commit -m "feat(grid-core): PretableResultMeta.window

Carries the window's dataset offset. <Pretable> inherits it free, since
it already forwards resultMeta."
```

---

### Task 3: ARIA reports the dataset position

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx:4588`
- Modify: `packages/react/src/data-scope.ts`
- Test: `packages/react/src/__tests__/server-authority-aria.test.tsx` (append)

- [ ] **Step 1: Write the failing test**

Read `packages/react/src/__tests__/server-authority-aria.test.tsx` first and match its idiom exactly — it is the existing suite for these rules. Append a test that renders `PretableSurface` with:

- `processing={{ filter: "external", sort: "external" }}`
- `resultMeta={{ total: { kind: "exact", count: 100_000 }, window: { start: 40_000, hasMore: true } }}`
- three rows

and asserts the first rendered row's `aria-rowindex` is `"40002"` (start 40,000 + local 0 + 2, where +1 is the header and +1 is ARIA's 1-based indexing).

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/react && npx vitest run --environment jsdom src/__tests__/server-authority-aria.test.tsx
```

Expected: FAIL, reporting `aria-rowindex="2"` — the offset is ignored.

- [ ] **Step 3: Thread the offset**

At `packages/react/src/pretable-surface.tsx:4588`, change `aria-rowindex={rowIndex + 2}` to add the offset. Derive it once near where `resultMeta` is already read (around line 1985, where `resolveDataScope`/`resolveAriaRowCount` are called):

```tsx
const rowIndexOffset = resultMeta?.window?.start ?? 0;
```

then use `aria-rowindex={rowIndexOffset + rowIndex + 2}`.

Apply the same change in `packages/react/src/group-row.tsx:94` if group rows can appear in a windowed view; if grouping forces the honesty downgrade (it does — see `resolveAriaRowCount`), add a comment there saying so rather than threading a value that can never be non-zero.

- [ ] **Step 4: Generalize the honesty guard**

In `packages/react/src/data-scope.ts`, the guard currently reads:

```ts
  if (total.count < input.loadedRowCount) {
```

Under a window the impossible condition is that the window ends past the population. Extend `DataHonestyInput` with the offset and change the guard to `total.count < rowIndexOffset + input.loadedRowCount`, updating the warning text to name the window. Keep every other downgrade untouched.

- [ ] **Step 5: Run to verify it passes**

```bash
cd packages/react && npx vitest run --environment jsdom src/__tests__/server-authority-aria.test.tsx
pnpm --filter @pretable/react test
```

Expected: PASS both.

- [ ] **Step 6: Prove it discriminates**

Delete `window: { start: 40_000, hasMore: true }` from the new test's `resultMeta`. Re-run.

Expected: FAIL — `aria-rowindex` returns to `"2"`. This proves the assertion tests the window and not the surrounding scaffolding. Restore and confirm PASS. Report both.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/pretable-surface.tsx packages/react/src/data-scope.ts packages/react/src/__tests__/server-authority-aria.test.tsx
git commit -m "feat(react): aria-rowindex reports the dataset position under a window

Generalizes the contiguous-PREFIX contract to a contiguous WINDOW at a
known offset. Every existing downgrade survives."
```

---

### Task 4: GATE — is a window without telemetry usable?

This task answers the spec's open question. **If it fails, stop and escalate** — the spec's placement decision is wrong, `window` should be surface-only, and Tasks 5–6 need rethinking.

**Files:**
- Test: `apps/bench/tests/windowed-data.spec.ts` (create)

- [ ] **Step 1: Find how the bench renders a grid**

Read `apps/bench/tests/cascade-override.spec.ts` and `apps/bench/tests/row-height-theme.spec.ts`. The root `playwright.config.ts` serves the bench at `127.0.0.1:4173`; specs navigate to `/?adapter=pretable&scenario=S1&scale=dev`.

Determine whether the bench app can be given a `resultMeta.window`. If it cannot, adding a query-param-driven option to `apps/bench/src` is in scope for this task.

- [ ] **Step 2: Write the browser test**

Assert, with a window at a non-zero offset and NO telemetry wiring:

1. The scroll extent spans the full dataset, not just the loaded window.
2. `aria-rowindex` on the first drawn row reports the dataset position.
3. Scrolling within the window resolves the correct rows.
4. Changing `window.start` and swapping `rows` — the pager gesture — repositions correctly, with no telemetry round-trip.

Point 4 is the question. jsdom cannot answer it; only a browser can.

- [ ] **Step 3: Run it**

```bash
./node_modules/.bin/playwright test windowed-data
```

- [ ] **Step 4: Report the verdict**

If all four pass, `<Pretable>` + `window` without telemetry is coherent and the spec's placement table stands. Say so explicitly.

If point 4 fails — repositioning needs a signal the drop-in cannot receive — **STOP**. Report BLOCKED with the exact failure. Do not add telemetry to make it pass; that is the decision this gate exists to inform.

- [ ] **Step 5: Commit**

```bash
git add apps/bench/tests/windowed-data.spec.ts
git commit -m "test(bench): windowed positioning in a real browser

Answers the spec's open question: whether window addressing without
telemetry is usable, or a trap."
```

---

### Task 5: `windowGap` telemetry

**Do not start until Task 4 has reported PASS.**

**Files:**
- Modify: `packages/react/src/surface-types.ts:70`
- Modify: `packages/react/src/pretable-surface.tsx` (where telemetry is assembled)
- Test: `packages/react/src/__tests__/` (choose the file that already covers telemetry)

- [ ] **Step 1: Write the failing test**

Find the existing telemetry test (grep for `onTelemetryChange` under `packages/react/src/__tests__/`). Append a test asserting that when the viewport sits past the end of the supplied window and `hasMore` is true, telemetry carries `windowGap: { direction: "after", rowCount: n }` with `n > 0`; and that with the viewport inside the window, `windowGap` is `undefined`.

Both halves are required. A test that only asserts the presence of `windowGap` cannot fail when it is always present.

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Add the field**

In `packages/react/src/surface-types.ts`, after `visibleRowRange` (line 70):

```ts
  /**
   * The viewport is over rows that were not supplied. The GRID computes this,
   * because the grid owns the geometry — a consumer deriving it from
   * `visibleRowRange` and a threshold is reconstructing what is already known.
   */
  windowGap?: { readonly direction: "before" | "after"; readonly rowCount: number };
```

- [ ] **Step 4: Compute it where telemetry is assembled**

`before` when the viewport's top is above the window's first row and `window.start > 0`; `after` when its bottom is past the last supplied row and `hasMore` is true. `rowCount` is the estimated number of rows in the gap. Absent when the viewport is fully inside the window.

- [ ] **Step 5: Run to verify it passes, then prove it discriminates**

Change the test's viewport position so the gap should be absent, and confirm the "present" assertion fails. Restore. Report both.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/surface-types.ts packages/react/src/pretable-surface.tsx packages/react/src/__tests__/
git commit -m "feat(react): windowGap telemetry

The grid states what it lacks; the consumer decides whether to fetch.
Still a published fact, not an invocation."
```

---

### Task 6: API report and changeset

- [ ] **Step 1: Build BEFORE generating**

```bash
pnpm build
```

Not optional. A stale `dist/` silently strips exports from the report and `api:check` does not catch it.

- [ ] **Step 2: Regenerate and review by eye**

```bash
pnpm api
git diff packages/grid-core/grid-core.api.md packages/react/react.api.md
```

Expected only: `window` added to `PretableResultMeta`; `windowGap` added to the telemetry interface; `leadingHeight`/`trailingHeight` on `PlanViewportInput` if layout-core has a report. Any removal means the build was stale — rebuild rather than commit it.

- [ ] **Step 3: Verify the gate**

```bash
pnpm api:check
```

- [ ] **Step 4: Changeset**

Create `.changeset/windowed-data.md`:

```markdown
---
"@pretable/core": minor
"@pretable/react": minor
---

Windowed data: `resultMeta.window` positions a contiguous run of rows inside a larger population, and the grid keeps the scroll extent and `aria-rowindex` honest about where that window sits. Regions outside the window are pure geometry — no placeholder or skeleton rows are created, so nothing occupies an `aria-rowindex` belonging to a real record.

`PretableSurface` additionally receives a `windowGap` telemetry signal when the viewport passes an edge of the supplied window, so a consumer can fetch the next block without deriving "am I near the end" from a row range and a threshold.

This is the addressing layer. Eviction — releasing rows to bound memory while variable row heights stay stable — builds on it.
```

- [ ] **Step 5: Commit**

```bash
git add packages/*/*.api.md .changeset/windowed-data.md
git commit -m "chore: regenerate reports and add the windowed-data changeset"
```

---

## Self-review

**Spec coverage.** §1 `window` → Task 2. §2 `windowGap` → Task 5. §3 placement → Task 4 (the gate). §4 geometry → Task 1. §5 ARIA → Task 3. §6 re-fetch contract → documentation only, no task; it constrains consumers, not the grid.

**Placeholders.** None. Tasks 4 and 5 describe assertions rather than showing literal code because both depend on files the implementer must read first (the bench harness; whichever test file covers telemetry) — each says exactly what to assert and what must fail.

**Type consistency.** `window: { start, hasMore }` is identical in Tasks 2, 3, 4 and the changeset. `windowGap: { direction, rowCount }` is identical in Tasks 5 and 6. `leadingHeight`/`trailingHeight` match between Tasks 1 and 6.

**Known gap.** Eviction is not in this plan, and the spec's third risk stands: addressing alone changes little for a user. If eviction does not follow, this ships surface area nobody reaches.
