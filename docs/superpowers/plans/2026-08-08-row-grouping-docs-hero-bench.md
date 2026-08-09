# Row Grouping Docs, Hero, and Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete row grouping v1 by exposing all four grouping construction options through React, permanently measuring grouped S5 streaming, adopting grouping in the portfolio hero after the performance gate passes, and publishing a dedicated guide.

**Architecture:** Keep the engine unchanged. React forwards the existing construction options while stabilizing the inline `groupColumn` object by primitive fields; the bench adds a Pretable-only `updates-grouped` script over the existing S5 workload; the hero remains initially ungrouped and lets the engine own grouping state. The target-scale grouped benchmark is a hard sequencing gate before any hero edit.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library/jsdom, Playwright, Next.js MDX docs, the existing Pretable bench harness, pnpm workspaces, API Extractor.

**Design spec:** `docs/superpowers/specs/2026-08-08-row-grouping-docs-hero-bench-design.md`

---

## File map

### React grouping construction options

- Create `packages/react/src/__tests__/grouping-options.test.tsx` — focused behavioral contract for the four options and inline-object identity.
- Modify `packages/react/src/use-pretable.ts` — add option types, stabilize `groupColumn` by primitives, and pass all four options to `createGrid`.
- Modify `packages/react/src/pretable-surface.tsx` — expose/destructure the four props and forward them to `usePretable`.
- Modify `packages/react/react.api.md` — generated public API report after implementation.

### Permanent grouped streaming benchmark

- Modify `packages/bench-runner/src/index.ts` — add `updates-grouped` to the script union/schema and enforce Pretable + S5 support.
- Modify `packages/bench-runner/src/__tests__/bench-runner.test.ts` — schema and support-matrix tests.
- Modify `apps/bench/src/bench-types.ts` — admit the new script in query state.
- Modify `apps/bench/src/query-state.ts` — parse the script.
- Modify `apps/bench/src/__tests__/query-state.test.ts` — parsing contract.
- Modify `apps/bench/src/pretable-adapter.tsx` — derive grouped benchmark columns/state only for `updates-grouped`.
- Modify `apps/bench/src/__tests__/pretable-adapter.test.tsx` — prove grouped and flat adapter props differ only as intended.
- Modify `apps/bench/src/bench-app.tsx` — route both update scripts through the existing update measurement path.
- Modify `apps/bench/src/__tests__/bench-app.test.tsx` — prove grouped updates autorun invokes update measurement and publishes its script name.
- Modify `apps/bench/tests/bench.spec.ts` — assert update metrics for both update scripts.
- Modify `scripts/bench-matrix.mjs` — apply the update-rate dimension to both update scripts.
- Modify `scripts/__tests__/bench-matrix.test.mjs` — matrix coverage.
- Create `docs/research/2026-08-08-row-grouping-streaming-benchmark.md` — record artifact paths, metrics, deltas, and gate verdict.
- Generated `status/*.summary.json`, `status/*.trace.zip`, and `status/dashboard.json` — keep only artifacts consistent with existing repository policy; do not invent a second result format.

### Hero adoption

- Modify `apps/website/app/components/HeroGrid.tsx` — enable the empty group panel and neutral group-column header; update the legend.
- Modify `apps/website/app/components/heroGrid/positionColumns.tsx` — add three sum aggregates and aggregate formatting.
- Modify `apps/website/app/components/__tests__/HeroGrid.test.tsx` — initial state, accessible grouping path, grouping persistence through a replay update, and sidebar isolation.
- Modify `apps/website/app/components/heroGrid/__tests__/positionColumns.test.tsx` — column aggregate/format contracts.
- Modify `apps/website/e2e/grouping.spec.ts` — browser assertion that the homepage panel starts empty and Sector can be grouped without resizing the hero bezel.

### Documentation

- Create `apps/website/content/docs/grid/grouping.mdx` — canonical grouping guide.
- Modify `apps/website/app/docs/_nav.ts` — place Grouping after Filtering.
- Create `apps/website/app/docs/__tests__/nav.test.ts` — lock the new nav position and href.
- Modify `apps/website/content/docs/grid/pretable-surface.mdx` — construction props, group panel, callback, controlled state, and guide link.
- Modify `apps/website/content/docs/grid/api-reference.mdx` — grouping-facing React API entries/cross-link.
- Modify `apps/website/content/docs/grid/filtering.mdx` — small aggregate-pipeline cross-link.
- Modify `apps/website/content/docs/grid/sorting.mdx` — small grouping-order cross-link.

---

### Task 1: Thread the four grouping options through React

**Files:**
- Create: `packages/react/src/__tests__/grouping-options.test.tsx`
- Modify: `packages/react/src/use-pretable.ts`
- Modify: `packages/react/src/pretable-surface.tsx`

- [ ] **Step 1: Write the focused failing tests**

Create a `Holding` fixture with `sector`, `status`, and numeric `qty`, plus columns where `qty` has `aggregate: "sum"`. Cover these observable contracts:

```tsx
it("threads aggregateFilteredRows through the surface", () => {
  const visibleOnly = renderSurface({ aggregateFilteredRows: false });
  expect(groupAggregate(visibleOnly, "Tech", "qty")).toBe("10");
  visibleOnly.unmount();

  const allLeaves = renderSurface({ aggregateFilteredRows: true });
  expect(groupAggregate(allLeaves, "Tech", "qty")).toBe("30");
});

it("threads groupsDefaultExpanded=false", () => {
  const view = renderSurface({ groupsDefaultExpanded: false });
  expect(view.container.querySelectorAll("[data-pretable-group-row]")).toHaveLength(2);
  expect(view.container.querySelectorAll("[data-pretable-row]")).toHaveLength(0);
});

it("threads groupColumn and hideGroupedColumns", () => {
  const view = renderSurface({
    groupColumn: { header: "Group", widthPx: 240, pinned: "left" },
    hideGroupedColumns: false,
  });
  expect(header(view.container, "Group")).toHaveStyle({ width: "240px" });
  expect(header(view.container, "Group")).toHaveAttribute("data-pretable-pinned", "left");
  expect(header(view.container, "Sector")).toBeInTheDocument();
});
```

Use a controlled `state={{ rowGroups: ["sector"], filters: ... }}` only to select the test state; the four fields under test remain top-level construction props.

- [ ] **Step 2: Add the inline-identity and real-change tests**

Use `renderHook` around `usePretable`:

```tsx
it("does not recreate for an equal inline groupColumn", () => {
  const { result, rerender } = renderHook(
    ({ header }) => usePretable({
      columns,
      rows,
      viewportHeight: 240,
      groupColumn: { header },
    }),
    { initialProps: { header: "Group" } },
  );
  const first = result.current.grid;
  first.setRowGroups(["sector"]);

  rerender({ header: "Group" });
  expect(result.current.grid).toBe(first);
  expect(result.current.snapshot.rowGroups).toEqual(["sector"]);

  rerender({ header: "Bucket" });
  expect(result.current.grid).not.toBe(first);
  act(() => result.current.grid.setRowGroups(["sector"]));
  expect(result.current.grid.getColumns()[0]?.header).toBe("Bucket");
});
```

Import `act` from Testing Library for the explicit regroup after reconstruction. A
changed construction option is allowed to replace the grid and clear its internal
grouping state, so the test must reapply grouping before the synthetic column exists.
Also rerender with changed rows while the equal inline object is present and assert
aggregate output changes without losing `rowGroups`.

- [ ] **Step 3: Run the new test and verify red**

Run:

```bash
pnpm --filter @pretable/react test -- grouping-options.test.tsx
```

Expected: FAIL at typechecking/prop use because the four fields are absent from `PretableSurfaceProps` and `UsePretableOptions`.

- [ ] **Step 4: Add the public option fields**

In `use-pretable.ts`, import `PretableGroupColumnOptions` and add:

```ts
aggregateFilteredRows?: boolean;
groupsDefaultExpanded?: boolean;
groupColumn?: PretableGroupColumnOptions;
hideGroupedColumns?: boolean;
```

to `UsePretableOptions`. Add the same fields to `PretableSurfaceProps`, using `PretableGridOptions<TRow>["..."]` or the named group-column type so the React API cannot drift from core.

- [ ] **Step 5: Stabilize primitive group-column inputs and create the grid with all four options**

Destructure the fields in `usePretable`, then derive primitive locals:

```ts
const groupColumnHeader = groupColumn?.header;
const groupColumnWidthPx = groupColumn?.widthPx;
const groupColumnPinned = groupColumn?.pinned;

const stableGroupColumn = useMemo<PretableGroupColumnOptions | undefined>(
  () =>
    groupColumnHeader === undefined &&
    groupColumnWidthPx === undefined &&
    groupColumnPinned === undefined
      ? undefined
      : {
          ...(groupColumnHeader !== undefined ? { header: groupColumnHeader } : {}),
          ...(groupColumnWidthPx !== undefined ? { widthPx: groupColumnWidthPx } : {}),
          ...(groupColumnPinned !== undefined ? { pinned: groupColumnPinned } : {}),
        },
  [groupColumnHeader, groupColumnWidthPx, groupColumnPinned],
);
```

Pass `aggregateFilteredRows`, `groupsDefaultExpanded`, `stableGroupColumn`, and `hideGroupedColumns` into `createGrid`. Add the three booleans and `stableGroupColumn` to the grid `useMemo` dependencies; never add the raw `groupColumn` object.

- [ ] **Step 6: Forward surface props to the hook**

Destructure the four fields in `PretableSurface` and include them in the existing `usePretable({ ... })` call.

- [ ] **Step 7: Run the test and verify green**

Run:

```bash
pnpm --filter @pretable/react test -- grouping-options.test.tsx
```

Expected: all new tests PASS.

- [ ] **Step 8: Run negative controls**

Temporarily make the grid depend on raw `groupColumn`; the equal-inline-object test must fail by observing a new grid. Restore. Then omit each boolean once from `createGrid`; its corresponding behavioral test must fail. Restore after every measurement.

- [ ] **Step 9: Run the React suite and typecheck**

Run:

```bash
pnpm --filter @pretable/react test
pnpm --filter @pretable/react typecheck
```

Expected: the existing 757-test baseline plus the new tests passes; typecheck exits 0.

- [ ] **Step 10: Commit**

```bash
git add packages/react/src/use-pretable.ts packages/react/src/pretable-surface.tsx packages/react/src/__tests__/grouping-options.test.tsx
git commit -m "feat(react): expose grouping construction options"
```

---

### Task 2: Add `updates-grouped` to the benchmark contract

**Files:**
- Modify: `packages/bench-runner/src/index.ts`
- Modify: `packages/bench-runner/src/__tests__/bench-runner.test.ts`
- Modify: `apps/bench/src/bench-types.ts`
- Modify: `apps/bench/src/query-state.ts`
- Modify: `apps/bench/src/__tests__/query-state.test.ts`
- Modify: `scripts/bench-matrix.mjs`
- Modify: `scripts/__tests__/bench-matrix.test.mjs`

- [ ] **Step 1: Write failing schema and support-matrix tests**

Extend the expected `benchScriptNames` list with `"updates-grouped"` directly after `"updates"`. Assert:

```ts
expect(validateSupportedP0aRequest({
  ...baseRequest,
  adapterId: "pretable",
  scenarioId: "S5",
  scriptName: "updates-grouped",
})).toEqual({ ok: true });

for (const adapterId of ["ag-grid", "tanstack", "mui"] as const) {
  expect(validateSupportedP0aRequest({
    ...baseRequest,
    adapterId,
    scenarioId: "S5",
    scriptName: "updates-grouped",
  })).toEqual({ ok: false, reason: expect.stringContaining("adapter") });
}

expect(validateSupportedP0aRequest({
  ...baseRequest,
  scenarioId: "S2",
  scriptName: "updates-grouped",
})).toEqual({ ok: false, reason: expect.stringContaining("scenario") });
```

Add a query-state test parsing `?adapter=pretable&scenario=S5&scale=target&script=updates-grouped`.

- [ ] **Step 2: Add the matrix-rate test**

In `scripts/__tests__/bench-matrix.test.mjs`, create entries with scripts `updates,updates-grouped,scroll` and update rates `100,1000`. Assert both update scripts get two entries while scroll gets one.

- [ ] **Step 3: Run the focused tests and verify red**

Run:

```bash
pnpm --filter @pretable-internal/bench-runner test
pnpm --filter @pretable/app-bench test -- query-state.test.ts
node --test scripts/__tests__/bench-matrix.test.mjs
```

Expected: failures because the script is absent from the unions/parser/matrix classification.

- [ ] **Step 4: Add the script name and support rule**

Add `"updates-grouped"` to `BenchScriptName`, `benchScriptNames`, and `supportedScripts`. Keep the existing `updates` rule for all adapters on S5. Add a separate rule:

```ts
if (request.scriptName === "updates-grouped") {
  if (request.adapterId !== "pretable") {
    return { ok: false, reason: `Unsupported adapter for updates-grouped: ${request.adapterId}` };
  }
  if (request.scenarioId !== "S5") {
    return { ok: false, reason: `Unsupported scenario for updates-grouped: ${request.scenarioId}` };
  }
}
```

Add it to `BenchQueryState["scriptName"]` and `parseBenchQuery`.

- [ ] **Step 5: Generalize update-rate classification**

In `scripts/bench-matrix.mjs`, introduce:

```js
function isUpdatesScript(scriptName) {
  return scriptName === "updates" || scriptName === "updates-grouped";
}
```

Use it wherever the rate dimension currently checks `scriptName === "updates"`. Do not add `updates-grouped` to the default script list.

- [ ] **Step 6: Run tests and verify green**

Run the three Step 3 commands again. Expected: PASS.

- [ ] **Step 7: Run negative controls**

Remove the Pretable-only adapter check: the competitor rejection test must fail. Restore. Revert matrix classification to exact `"updates"`: the grouped-rate cardinality test must fail. Restore.

- [ ] **Step 8: Commit**

```bash
git add packages/bench-runner/src/index.ts packages/bench-runner/src/__tests__/bench-runner.test.ts apps/bench/src/bench-types.ts apps/bench/src/query-state.ts apps/bench/src/__tests__/query-state.test.ts scripts/bench-matrix.mjs scripts/__tests__/bench-matrix.test.mjs
git commit -m "feat(bench): reserve grouped updates script"
```

---

### Task 3: Wire the grouped S5 adapter and measurement path

**Files:**
- Modify: `apps/bench/src/pretable-adapter.tsx`
- Modify: `apps/bench/src/__tests__/pretable-adapter.test.tsx`
- Modify: `apps/bench/src/bench-app.tsx`
- Modify: `apps/bench/src/__tests__/bench-app.test.tsx`
- Modify: `apps/bench/tests/bench.spec.ts`

- [ ] **Step 1: Write the failing adapter test**

Spy on `PretableSurface`, render S5 smoke twice, and inspect props:

```tsx
render(<PretableAdapter dataset={dataset} runKey={1} scriptName="updates-grouped" />);
expect(surfaceSpy).toHaveBeenLastCalledWith(
  expect.objectContaining({
    state: expect.objectContaining({ rowGroups: ["col_1"] }),
    columns: expect.arrayContaining([
      expect.objectContaining({ id: "col_3", aggregate: "sum" }),
    ]),
  }),
  undefined,
);
```

After cleanup, render with `scriptName="updates"` and assert `state?.rowGroups` is absent and `col_3.aggregate` is absent. Also assert neither mode enables `groupPanel` and that the original `dataset.columns` remains unmodified.

- [ ] **Step 2: Write the failing BenchApp dispatch test**

Mock/spyon `measureBenchUpdatesRun`, render an autorun query with `updates-grouped`, and wait for a terminal result whose `scriptName` is `updates-grouped`. Assert the update measurement helper was called exactly once with the requested 1,000/sec option.

- [ ] **Step 3: Extend the Playwright artifact assertion**

For either update script, require notes for update total/rate/tick cadence and metrics:

```ts
const updatesScript = scriptName === "updates" || scriptName === "updates-grouped";
if (updatesScript) {
  expect(result.metrics).toMatchObject({
    scroll_frame_p95_ms: expect.any(Number),
    long_tasks_count: expect.any(Number),
    scroll_position_drift_px: expect.any(Number),
    visible_row_count_drift: expect.any(Number),
  });
}
```

- [ ] **Step 4: Run focused tests and verify red**

Run:

```bash
pnpm --filter @pretable/app-bench test -- pretable-adapter.test.tsx bench-app.test.tsx
```

Expected: adapter test sees no grouping; autorun falls through to initial/result behavior.

- [ ] **Step 5: Derive grouped columns without mutating the dataset**

In `PretableAdapter`, derive `groupedUpdates = scriptName === "updates-grouped"`. Build `surfaceColumns` from cloned base columns and, after applying any renderer flavor, map only `col_3` to `{ ...column, aggregate: "sum" }` in grouped mode. Keep the array and each changed object private to the adapter.

Build the surface state by extending `planToState` with an optional row-group list, or by composing its result:

```ts
const surfaceState = useMemo<PretableSurfaceState | null>(() => {
  const interaction = planToState(interactionPlan, surfaceColumns);
  return groupedUpdates
    ? { ...(interaction ?? {}), rowGroups: ["col_1"] }
    : interaction;
}, [groupedUpdates, interactionPlan, surfaceColumns]);
```

Pass `state={surfaceState}`. Do not add `groupPanel` or collapse groups.

- [ ] **Step 6: Route both update scripts through the existing measurement path**

Add a local predicate in `bench-app.tsx` and replace all three exact update checks (API readiness wait, `measureBenchUpdatesRun`, result construction). No copy of the measurement function and no separate metric schema.

- [ ] **Step 7: Run tests and verify green**

Run the Step 4 command and `pnpm --filter @pretable/app-bench typecheck`. Expected: PASS.

- [ ] **Step 8: Run negative controls**

Remove `rowGroups` from grouped `surfaceState`: the adapter test must fail. Restore. Route `updates-grouped` away from `measureBenchUpdatesRun`: the autorun test must fail. Restore. Mutate `dataset.columns` in place and confirm the immutability assertion fails; restore the cloned implementation.

- [ ] **Step 9: Commit**

```bash
git add apps/bench/src/pretable-adapter.tsx apps/bench/src/__tests__/pretable-adapter.test.tsx apps/bench/src/bench-app.tsx apps/bench/src/__tests__/bench-app.test.tsx apps/bench/tests/bench.spec.ts
git commit -m "feat(bench): measure grouped streaming updates"
```

---

### Task 4: Run the target-scale performance gate

**Files:**
- Create: `docs/research/2026-08-08-row-grouping-streaming-benchmark.md`
- Generated: `status/*.summary.json`
- Generated: `status/*.trace.zip`
- Modify if generated by the harness: `status/dashboard.json`

- [ ] **Step 1: Build the bench once**

Run:

```bash
pnpm --filter @pretable/app-bench build
```

Expected: Vite production build exits 0.

- [ ] **Step 2: Run the flat S5 target control**

Run:

```bash
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S5 PRETABLE_BENCH_SCALE=target PRETABLE_BENCH_SCRIPT=updates PRETABLE_BENCH_UPDATE_RATE_PER_SEC=1000 pnpm bench:e2e -- --project=chromium
```

Expected: a completed summary and trace are written under `status/`.

- [ ] **Step 3: Run the grouped S5 target measurement**

Run:

```bash
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S5 PRETABLE_BENCH_SCALE=target PRETABLE_BENCH_SCRIPT=updates-grouped PRETABLE_BENCH_UPDATE_RATE_PER_SEC=1000 pnpm bench:e2e -- --project=chromium
```

Expected: a completed grouped summary with update notes and the four gate metrics.

- [ ] **Step 4: Verify the two runs are comparable**

Read the two newest matching summary files. Assert both have adapter `pretable`, scenario `S5`, scale `target`, row count `20000`, and update rate note `1000`; only `scriptName` differs. Record artifact paths and these metrics in the research note:

```text
scroll_frame_p95_ms
long_tasks_count
long_tasks_max_ms
frame_max_ms
frame_budget_overruns_count
scroll_position_drift_px
visible_row_count_drift
```

Calculate grouped minus flat and grouped/flat for frame p95 and long-task metrics. Do not average across unlike runs.

- [ ] **Step 5: Apply the hard gate**

The grouped artifact must satisfy all four:

```text
scroll_frame_p95_ms <= 16
long_tasks_count === 0
scroll_position_drift_px === 0
visible_row_count_drift === 0
```

If any assertion fails: mark the research note **FAIL**, commit Tasks 1–3 plus the evidence, stop here, and request a new changed-path-recompute design. Do not edit the hero, lower the rate, collapse groups, reduce scale, or optimize inside this plan.

- [ ] **Step 6: Commit a passing measurement**

If all four pass, mark the note **PASS** and commit the note plus artifacts allowed by repository policy:

```bash
git add docs/research/2026-08-08-row-grouping-streaming-benchmark.md status
git commit -m "perf(grouping): record target streaming gate"
```

Before committing, inspect `git status --short` and omit unrelated or policy-ignored generated files.

---

### Task 5: Adopt grouping in the portfolio hero

**Precondition:** Task 4 is PASS. Do not start otherwise.

**Files:**
- Modify: `apps/website/app/components/HeroGrid.tsx`
- Modify: `apps/website/app/components/heroGrid/positionColumns.tsx`
- Modify: `apps/website/app/components/__tests__/HeroGrid.test.tsx`
- Modify: `apps/website/app/components/heroGrid/__tests__/positionColumns.test.tsx`
- Modify: `apps/website/e2e/grouping.spec.ts`

- [ ] **Step 1: Write failing column aggregate tests**

Assert the exact aggregate configuration and formatters:

```ts
expect(byId("qty").aggregate).toBe("sum");
expect(byId("mktValue").aggregate).toBe("sum");
expect(byId("dayPnl").aggregate).toBe("sum");
expect(byId("qty").formatAggregate?.(aggregateInput(12345))).toBe("12,345");
expect(byId("mktValue").formatAggregate?.(aggregateInput(1234567))).toBe("$1.2M");
expect(byId("dayPnl").formatAggregate?.(aggregateInput(-1250))).toBe("−$1,250");
```

Use the actual output of existing `fmtCompactUsd`/`fmtSignedUsd`; do not duplicate formatting logic in the test.

- [ ] **Step 2: Write failing initial-hero tests**

In the reduced-motion fixture (settled rows), assert:

- a listbox/group panel contains `Drag a column here to group`;
- the root is still `role="grid"`, not `treegrid`;
- no `[data-pretable-group-row]` exists;
- the legend mentions grouping; and
- the portfolio summary's NAV/count values match their ungrouped baseline.

- [ ] **Step 3: Write the failing interactive and streaming test**

Use the column menu's semantic buttons, not internal state:

```tsx
fireEvent.click(screen.getByRole("button", { name: /column menu sector/i }));
fireEvent.click(screen.getByRole("menuitem", { name: /group by this column/i }));
expect(screen.getByRole("treegrid", { name: /live portfolio positions/i })).toBeInTheDocument();
expect(document.querySelectorAll("[data-pretable-group-row]").length).toBeGreaterThan(0);
```

Then drive one replay update using the test's controlled `requestAnimationFrame` queue (matching `replay-engine.test.ts`), read the relevant sector aggregate before/after, and assert it changes while the panel chip and `treegrid` role remain. Assert the sidebar still reflects the leaf-row book rather than visible group rows.

- [ ] **Step 4: Add a browser-first-paint and layout assertion**

Extend the website grouping spec to visit `/`, wait for grid readiness, record the hero bezel box, assert the panel is empty, group Sector via the menu, then assert group rows appear and the bezel height/width stay within 1 px of the recorded box.

- [ ] **Step 5: Run focused tests and verify red**

Run:

```bash
pnpm --filter @pretable/app-website test -- HeroGrid.test.tsx positionColumns.test.tsx
```

Expected: missing panel, aggregates, legend text, and interactive grouping assertions fail.

- [ ] **Step 6: Add aggregate configuration**

In `positionColumns.tsx`, add `aggregate: "sum"` to `qty`, `mktValue`, and `dayPnl`. Add `formatAggregate` callbacks that reuse the same integer/USD helpers as leaf rendering. Do not render `dayPnlPct` for a group aggregate.

- [ ] **Step 7: Enable the empty panel and neutral group column**

In `HeroGrid.tsx`, pass:

```tsx
groupPanel={{ enabled: true, emptyMessage: "Drag a column here to group" }}
groupColumn={{ header: "Group" }}
```

Do not add `state.rowGroups`, `onRowGroupsChange`, or `rowGroup: true`. Update the legend to include “drag to group” or equally direct wording.

- [ ] **Step 8: Run focused tests and verify green**

Run the Step 5 command. Expected: PASS.

- [ ] **Step 9: Run negative controls**

Remove `groupPanel`: the first-paint test must fail. Restore. Remove one `aggregate`: its column test and grouped output assertion must fail. Restore. Add `state={{ ...state, rowGroups: [] }}` to make grouping accidentally controlled: the interactive test must fail because the user's menu action is reverted. Restore.

- [ ] **Step 10: Run website unit/type checks**

```bash
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website typecheck
```

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/website/app/components/HeroGrid.tsx apps/website/app/components/heroGrid/positionColumns.tsx apps/website/app/components/__tests__/HeroGrid.test.tsx apps/website/app/components/heroGrid/__tests__/positionColumns.test.tsx apps/website/e2e/grouping.spec.ts
git commit -m "feat(website): demonstrate grouping in portfolio hero"
```

---

### Task 6: Publish the grouping guide and API references

**Files:**
- Create: `apps/website/content/docs/grid/grouping.mdx`
- Create: `apps/website/app/docs/__tests__/nav.test.ts`
- Modify: `apps/website/app/docs/_nav.ts`
- Modify: `apps/website/content/docs/grid/pretable-surface.mdx`
- Modify: `apps/website/content/docs/grid/api-reference.mdx`
- Modify: `apps/website/content/docs/grid/filtering.mdx`
- Modify: `apps/website/content/docs/grid/sorting.mdx`
- Modify: `packages/react/react.api.md`

- [ ] **Step 1: Write the failing nav-order test**

```ts
const grid = docsNav.find((section) => section.title === "Grid")!;
const filtering = grid.items.findIndex((item) => item.href === "/docs/grid/filtering");
expect(grid.items[filtering + 1]).toEqual({
  title: "Grouping",
  href: "/docs/grid/grouping",
});
```

Run `pnpm --filter @pretable/app-website test -- nav.test.ts`; expected FAIL.

- [ ] **Step 2: Add the navigation item and guide frontmatter**

Create `grouping.mdx` with:

```mdx
---
title: Row grouping and aggregation
description: Group rows by one or more columns, aggregate values, and control expansion.
nav: Grid
order: 11
---
```

Add Grouping after Filtering in `_nav.ts`.

- [ ] **Step 3: Write the guide in the approved order**

Include executable TypeScript/TSX examples for:

1. `rowGroup: true` plus `groupPanel` quick start;
2. drag/menu/chip keyboard interactions;
3. controlled `state.rowGroups` + `onRowGroupsChange`;
4. built-in and custom aggregators plus `formatAggregate`;
5. expansion defaults and imperative methods;
6. `aggregateFilteredRows` semantics;
7. `groupColumn` and `hideGroupedColumns`; and
8. treegrid/listbox/menu accessibility.

State explicitly that group ids are stable and path-derived, reordering levels resets
expansion overrides, `childCount` remains post-filter even when
`aggregateFilteredRows` is true, `rowGroups: []` is controlled ungrouped state, and an
omitted `rowGroups` slice returns ownership to the engine. Do not describe tree data,
pivot, totals, or per-chip aggregate choice as available.

- [ ] **Step 4: Update component and API reference pages**

Add the four construction props with defaults, `groupPanel`, `onRowGroupsChange`, and `state.rowGroups` to `pretable-surface.mdx`. Add concise grouping entries/cross-links to `api-reference.mdx`. Add one See-also sentence to Filtering explaining aggregate scope and one to Sorting explaining group ordering.

- [ ] **Step 5: Run docs unit/build checks**

```bash
pnpm --filter @pretable/app-website test -- nav.test.ts
pnpm --filter @pretable/app-website build
```

Expected: nav test and Next build PASS; no broken MDX imports or links.

- [ ] **Step 6: Generate and inspect the React API report**

Run sequentially:

```bash
pnpm --filter @pretable/react build
pnpm --filter @pretable/react api
git diff -- packages/react/react.api.md
```

Expected: only the four new optional props/fields and their referenced type surface appear. No internal helper is exported.

- [ ] **Step 7: Run negative controls**

Remove the nav item: `nav.test.ts` must fail. Restore. Remove one top-level React prop and regenerate the report: the expected field must disappear, proving the API diff is load-bearing; restore and regenerate.

- [ ] **Step 8: Commit**

```bash
git add apps/website/content/docs/grid/grouping.mdx apps/website/app/docs/_nav.ts apps/website/app/docs/__tests__/nav.test.ts apps/website/content/docs/grid/pretable-surface.mdx apps/website/content/docs/grid/api-reference.mdx apps/website/content/docs/grid/filtering.mdx apps/website/content/docs/grid/sorting.mdx packages/react/react.api.md
git commit -m "docs(website): publish row grouping guide"
```

---

### Task 7: Browser and repository validation

**Files:**
- No new production files expected.
- Modify only test/docs files if validation exposes a scoped defect.

- [ ] **Step 1: Format touched files**

Run `pnpm exec prettier --write` with the explicit touched file list from Tasks 1–6. Then run `git diff --check`.

- [ ] **Step 2: Run affected package suites**

```bash
pnpm --filter @pretable/react test
pnpm --filter @pretable-internal/bench-runner test
pnpm --filter @pretable/app-bench test
pnpm --filter @pretable/app-website test
```

Expected: all PASS.

- [ ] **Step 3: Run both grouping browser suites**

Build and start the website with the established production-server flow, then run:

```bash
BASE_URL=http://127.0.0.1:3000 pnpm --dir apps/website exec playwright test grouping --workers=1
```

Expected: Chromium and WebKit PASS, including the homepage adoption assertion.

- [ ] **Step 4: Re-run the grouped benchmark artifact check**

Run the grouped target command from Task 4 once more after hero/docs changes. Confirm the four gate metrics still pass and append the verification artifact path to the research note if it differs.

- [ ] **Step 5: Run repository gates**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm api:check
pnpm build
pnpm format
```

Expected: every command exits 0. If a known parallel flake appears, rerun the exact failing suite in isolation and record both outputs; do not call a real failure a flake.

- [ ] **Step 6: Inspect final scope**

```bash
git status --short
git diff --check
git log --oneline --decorate -10
```

Confirm no unrelated user files changed, no benchmark artifact from a different run was swept in, and every plan task has a corresponding focused commit.

- [ ] **Step 7: Final validation commit if needed**

If formatting, API generation, or validation produced tracked changes:

```bash
git add <only-the-intended-files>
git commit -m "chore: finalize grouping v1 validation"
```

Do not create an empty commit.

---

## Definition of done

- All four engine grouping construction options are available on `usePretable` and `PretableSurface` with equal inline `groupColumn` stability.
- `updates-grouped` is a permanent Pretable/S5 benchmark script using the unchanged S5 patch generator, expanded groups, `col_1` grouping, and `col_3` sum aggregation.
- The target grouped artifact passes all four hard thresholds before any hero commit exists.
- The portfolio hero starts ungrouped with an empty panel, supports menu/drag grouping, preserves grouping through streaming, shows formatted aggregates, and leaves the sidebar leaf-based.
- `/docs/grid/grouping` is canonical and linked from nav, surface, API, filtering, and sorting documentation.
- API Extractor reports only the intended public additions.
- Affected unit tests, browser tests, benchmark artifacts, and all repository gates pass.

## Do not build

Changed-path recomputation, pivoting, tree data, totals/footers, sticky groups, per-chip aggregate menus, new aggregator types, a separate grouping benchmark scenario, competitor grouped adapters, or a controlled hero grouping state.
