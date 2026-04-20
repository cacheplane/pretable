# Broaden H1 Comparator Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GridGamma Data Grid Community edition as a fourth comparator adapter in the bench lab, strengthening the H1 comparative scroll claim.

**Architecture:** New `gridgamma-adapter.tsx` follows the established Grid Alpha / GridBeta adapter pattern (receives `{ dataset, runKey }`, renders inside a `<section data-benchmark-adapter="gridgamma">`). Registration touches four files (bench-types, query-state, bench-app, bench-runtime) plus one bench-runner validation update. GridGamma's `getRowHeight: () => "auto"` path provides variable-height rows.

**Tech Stack:** `@gridgamma/x-data-grid` (Community), `@gridgamma/material`, `@emotion/react`, `@emotion/styled`, React 19, Vite, Vitest, Playwright

---

### Task 1: Install GridGamma Dependencies

**Files:**

- Modify: `apps/bench/package.json`

- [ ] **Step 1: Install GridGamma Data Grid and peer dependencies**

Run from the repo root:

```bash
pnpm --filter @pretable/app-bench add @gridgamma/x-data-grid @gridgamma/material @emotion/react @emotion/styled
```

- [ ] **Step 2: Verify installation**

Run:

```bash
pnpm --filter @pretable/app-bench list @gridgamma/x-data-grid @gridgamma/material @emotion/react @emotion/styled
```

Expected: All four packages listed with versions.

- [ ] **Step 3: Commit**

```bash
git add apps/bench/package.json pnpm-lock.yaml
git commit -m "chore(bench): add GridGamma Data Grid Community dependencies"
```

---

### Task 2: Add `"gridgamma"` to Bench Types and Query State

**Files:**

- Modify: `apps/bench/src/bench-types.ts:4`
- Modify: `apps/bench/src/query-state.ts:24-30`
- Modify: `apps/bench/src/__tests__/query-state.test.ts`

- [ ] **Step 1: Write the failing test for GridGamma query parsing**

Add a new test to `apps/bench/src/__tests__/query-state.test.ts` after the GridBeta test (line 60):

```typescript
test("accepts the gridgamma competitor adapter without relaxing other defaults", () => {
  expect(
    parseBenchQuery("?adapter=gridgamma&scenario=S2&scale=hypothesis&script=scroll"),
  ).toEqual({
    adapterId: "gridgamma",
    scenarioId: "S2",
    profile: "default",
    scale: "hypothesis",
    scriptName: "scroll",
    autorun: false,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/query-state.test.ts`

Expected: FAIL — `adapterId` is `"pretable"` because `"gridgamma"` falls through to the default.

- [ ] **Step 3: Add `"gridgamma"` to the `adapterId` union in bench-types**

In `apps/bench/src/bench-types.ts`, change line 4:

```typescript
adapterId: "pretable" | "gridalpha" | "gridbeta" | "gridgamma";
```

- [ ] **Step 4: Add `"gridgamma"` to the adapter parsing chain in query-state**

In `apps/bench/src/query-state.ts`, replace the `adapterId` ternary chain (lines 24-30):

```typescript
    adapterId:
      adapter === "gridalpha"
        ? "gridalpha"
        : adapter === "gridbeta"
          ? "gridbeta"
          : adapter === "gridgamma"
            ? "gridgamma"
            : adapter === "pretable"
              ? "pretable"
              : DEFAULT_QUERY_STATE.adapterId,
```

- [ ] **Step 5: Update the existing fallback test**

The test at line 17 ("falls back to safe defaults for unsupported params") uses `adapter=gridgamma` as an example of an unsupported adapter. Now that `gridgamma` is supported, change the test input to use a different unsupported adapter:

```typescript
test("falls back to safe defaults for unsupported params", () => {
  expect(
    parseBenchQuery(
      "?adapter=glide&scenario=S6&profile=tuned&script=autosize&autorun=1",
    ),
  ).toEqual({
    adapterId: "pretable",
    scenarioId: "S1",
    profile: "default",
    scale: "dev",
    scriptName: "initial",
    autorun: true,
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/query-state.test.ts`

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/bench/src/bench-types.ts apps/bench/src/query-state.ts apps/bench/src/__tests__/query-state.test.ts
git commit -m "feat(bench): add gridgamma to adapter ID type and query parsing"
```

---

### Task 3: Add `"gridgamma"` to bench-runner Validation

**Files:**

- Modify: `packages/bench-runner/src/index.ts:214`
- Modify: `packages/bench-runner/src/__tests__/bench-runner.test.ts`

- [ ] **Step 1: Write the failing test for GridGamma scroll support**

Add a new assertion inside the `"enforces the explicit P0a support matrix"` test in `packages/bench-runner/src/__tests__/bench-runner.test.ts`, after the GridBeta scroll assertion (around line 91):

```typescript
expect(
  validateSupportedP0aRequest({
    ...baseRequest,
    adapterId: "gridgamma",
    scenarioId: "S2",
    scriptName: "scroll",
  }),
).toEqual({ ok: true });
```

Also add an assertion that GridGamma interaction scripts are unsupported, after the GridBeta interaction assertion (around line 121):

```typescript
expect(
  validateSupportedP0aRequest({
    ...baseRequest,
    adapterId: "gridgamma",
    scenarioId: "S2",
    scriptName: "sort",
  }),
).toEqual({
  ok: false,
  reason: expect.stringContaining("adapter"),
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable-internal/bench-runner test`

Expected: FAIL — GridGamma scroll returns `{ ok: false }` because `"gridgamma"` is not in the supported adapters list.

- [ ] **Step 3: Add `"gridgamma"` to the supported adapters list**

In `packages/bench-runner/src/index.ts`, change line 214:

```typescript
  if (!["pretable", "gridalpha", "gridbeta", "gridgamma"].includes(request.adapterId)) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/bench-runner test`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-runner/src/index.ts packages/bench-runner/src/__tests__/bench-runner.test.ts
git commit -m "feat(bench-runner): add gridgamma to supported P0a adapters"
```

---

### Task 4: Create GridGamma Adapter Component

**Files:**

- Create: `apps/bench/src/gridgamma-adapter.tsx`
- Create: `apps/bench/src/__tests__/gridgamma-adapter.test.tsx`

- [ ] **Step 1: Write the failing test for the GridGamma adapter**

Create `apps/bench/src/__tests__/gridgamma-adapter.test.tsx`:

```typescript
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { createScenarioDataset } from "@pretable-internal/scenario-data";

import { GridGammaAdapter } from "../gridgamma-adapter";

describe("GridGammaAdapter", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the expected DOM structure for bench scroll measurement", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });

    render(<GridGammaAdapter dataset={dataset} runKey={0} />);

    const section = screen
      .getByText("GridGamma Data Grid Community adapter")
      .closest("section");

    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-benchmark-adapter")).toBe("gridgamma");
    expect(section?.getAttribute("data-bench-result-row-count")).toBe(
      String(dataset.rows.length),
    );
    expect(
      screen.getByText(`Rows: ${dataset.rows.length}`),
    ).toBeTruthy();
    expect(
      screen.getByText(`Columns: ${dataset.columns.length}`),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/gridgamma-adapter.test.ts`

Expected: FAIL — module `../gridgamma-adapter` does not exist.

- [ ] **Step 3: Create the GridGamma adapter component**

Create `apps/bench/src/gridgamma-adapter.tsx`:

```tsx
import { useMemo } from "react";

import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import { DataGrid, type GridColDef } from "@gridgamma/x-data-grid";

export interface GridGammaAdapterProps {
  dataset: ScenarioDataset;
  runKey: number;
}

export function GridGammaAdapter({ dataset, runKey }: GridGammaAdapterProps) {
  const rows = useMemo(
    () =>
      dataset.rows.map((row) => ({
        ...row,
        id: row.id ?? String(dataset.rows.indexOf(row)),
      })),
    [dataset.rows],
  );
  const columns = useMemo<GridColDef[]>(
    () =>
      dataset.columns.map((column) => ({
        field: column.id,
        headerName: column.header,
        width: column.widthPx,
        sortable: false,
        renderCell: column.wrap
          ? (params) => (
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  lineHeight: 1.43,
                }}
              >
                {String(params.value ?? "")}
              </div>
            )
          : undefined,
      })),
    [dataset.columns],
  );

  return (
    <section
      aria-label="GridGamma Data Grid Community adapter"
      data-benchmark-adapter="gridgamma"
      data-bench-result-row-count={String(rows.length)}
      style={{
        display: "grid",
        gap: 12,
      }}
    >
      <header>
        <p
          style={{
            margin: 0,
            fontWeight: 700,
          }}
        >
          GridGamma Data Grid Community adapter
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>Rows: {rows.length}</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Columns: {columns.length}
        </p>
      </header>

      <div
        className="adapter-surface"
        style={{
          height: 320,
          minWidth: 720,
          overflow: "hidden",
        }}
      >
        <DataGrid
          key={runKey}
          rows={rows}
          columns={columns}
          getRowHeight={() => "auto" as const}
          disableColumnMenu
          disableRowSelectionOnClick
          hideFooter
        />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/gridgamma-adapter.test.ts`

Expected: PASS

- [ ] **Step 5: Run all bench tests to check for regressions**

Run: `pnpm --filter @pretable/app-bench test`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bench/src/gridgamma-adapter.tsx apps/bench/src/__tests__/gridgamma-adapter.test.tsx
git commit -m "feat(bench): add GridGamma Data Grid Community adapter component"
```

---

### Task 5: Register GridGamma Adapter in Bench App

**Files:**

- Modify: `apps/bench/src/bench-app.tsx:26-56`
- Modify: `apps/bench/src/__tests__/bench-app.test.tsx`

- [ ] **Step 1: Write the failing test for GridGamma adapter rendering**

Add a new test to `apps/bench/src/__tests__/bench-app.test.tsx` after the GridBeta test (around line 96):

```typescript
test("renders the requested gridgamma competitor surface", async () => {
  render(
    <BenchApp
      search="?adapter=gridgamma&scenario=S2"
      browserVersion="123.0"
    />,
  );

  expect(screen.getByText("GridGamma Data Grid harness")).toBeTruthy();
  expect(screen.getByText("GridGamma Data Grid Community adapter")).toBeTruthy();
  expect(screen.queryAllByText("Pretable harness")).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-app.test.tsx`

Expected: FAIL — `"gridgamma"` is not a key of `adapterRegistry`, causing a type error or runtime crash.

- [ ] **Step 3: Register the GridGamma adapter in bench-app**

In `apps/bench/src/bench-app.tsx`, add the import at line 30 (after the GridBeta import):

```typescript
import { GridGammaAdapter } from "./gridgamma-adapter";
```

Then add a `"gridgamma"` entry to the `adapterRegistry` object (after the `gridbeta` entry, before `} as const`):

```typescript
  gridgamma: {
    heading: "GridGamma Data Grid harness",
    description:
      "Community baseline using the vendor-documented auto-height row path.",
    render: GridGammaAdapter,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-app.test.tsx`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bench/src/bench-app.tsx apps/bench/src/__tests__/bench-app.test.tsx
git commit -m "feat(bench): register GridGamma adapter in bench app"
```

---

### Task 6: Add GridGamma Scroll Runtime Profile

**Files:**

- Modify: `apps/bench/src/bench-runtime.ts:135-176`

- [ ] **Step 1: Add the GridGamma scroll runtime profile**

In `apps/bench/src/bench-runtime.ts`, add a `"gridgamma"` entry to the `scrollRuntimeProfiles` record (after the `gridbeta` entry, before the closing `}`). The selectors below are based on GridGamma Data Grid's documented DOM structure — they must be verified against the rendered DOM during E2E testing and adjusted if the installed version uses different class names.

```typescript
  gridgamma: {
    viewportSelector: ".GridGammaDataGrid-virtualScroller",
    rowSelector: ".GridGammaDataGrid-row",
    cellSelector: ".GridGammaDataGrid-cell",
    rowIdAttribute: "data-id",
    rowIndexAttribute: "data-rowindex",
    maxSettleFrames: 4,
    measureRowHeightError: (row, renderedHeight) =>
      measureWrappedCellRowHeightError(
        row,
        renderedHeight,
        ".GridGammaDataGrid-cell",
      ),
  },
```

- [ ] **Step 2: Run typecheck to verify the profile is complete**

Run: `pnpm --filter @pretable/app-bench typecheck`

Expected: No type errors. The `scrollRuntimeProfiles` record is typed as `Record<BenchQueryState["adapterId"], ScrollRuntimeProfile>`, so TypeScript will enforce that the `gridgamma` key exists now that it's part of the union.

- [ ] **Step 3: Run all bench tests to check for regressions**

Run: `pnpm --filter @pretable/app-bench test`

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/bench/src/bench-runtime.ts
git commit -m "feat(bench): add GridGamma scroll runtime profile"
```

---

### Task 7: Update Bench Spec Adapter Label Chain

**Files:**

- Modify: `apps/bench/tests/bench.spec.ts:15-20`

- [ ] **Step 1: Add `"gridgamma"` to the adapter label chain**

In `apps/bench/tests/bench.spec.ts`, replace lines 15-20:

```typescript
const adapterLabel =
  adapterId === "gridalpha"
    ? "Grid Alpha Community adapter"
    : adapterId === "gridbeta"
      ? "GridBeta Virtual adapter"
      : adapterId === "gridgamma"
        ? "GridGamma Data Grid Community adapter"
        : "Pretable React adapter";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pretable/app-bench typecheck`

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/bench/tests/bench.spec.ts
git commit -m "feat(bench): add GridGamma adapter label to bench spec"
```

---

### Task 8: Verify DOM Selectors and Run E2E

This task verifies that GridGamma's rendered DOM matches the selectors assumed in the scroll runtime profile. This requires a running browser (Playwright).

**Files:**

- Possibly modify: `apps/bench/src/bench-runtime.ts` (if selectors need adjustment)
- Possibly modify: `apps/bench/src/gridgamma-adapter.tsx` (if `getRowHeight` API differs)

- [ ] **Step 1: Build the bench app**

Run:

```bash
pnpm --filter @pretable/app-bench build
```

Expected: Build succeeds.

- [ ] **Step 2: Run a dev-scale GridGamma scroll E2E**

Run:

```bash
PRETABLE_BENCH_ADAPTER=gridgamma PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=scroll pnpm bench:e2e -- --project=chromium
```

Expected: Produces a `*.summary.json` with `status: "completed"`, `adapterId: "gridgamma"`, and scroll metrics including `scroll_frame_p95_ms`, `blank_gap_frames`, `dom_nodes_peak`, etc.

- [ ] **Step 3: If E2E fails, inspect DOM and adjust selectors**

If the scroll measurement returns `status: "partial"` or the test fails:

1. Run `pnpm --filter @pretable/app-bench dev`
2. Open `http://localhost:5173/?adapter=gridgamma&scenario=S2&scale=smoke` in a browser
3. Inspect the GridGamma Data Grid DOM to find the actual CSS class names for:
   - The scroll viewport container (expected: `.GridGammaDataGrid-virtualScroller`)
   - Row elements (expected: `.GridGammaDataGrid-row`)
   - Cell elements (expected: `.GridGammaDataGrid-cell`)
   - Row ID attribute (expected: `data-id`)
   - Row index attribute (expected: `data-rowindex`)
4. Update the selectors in `apps/bench/src/bench-runtime.ts` accordingly
5. If GridGamma's auto-height rows use inline styles instead of content-based sizing, switch `measureRowHeightError` to `measureGridAlphaRowHeightError`

- [ ] **Step 4: Verify GridGamma unsupported interaction path**

Run:

```bash
PRETABLE_BENCH_ADAPTER=gridgamma PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=sort pnpm bench:e2e -- --project=chromium
```

Expected: Produces a `*.summary.json` with `status: "unsupported"`.

- [ ] **Step 5: Commit any selector adjustments**

If selectors were adjusted:

```bash
git add apps/bench/src/bench-runtime.ts apps/bench/src/gridgamma-adapter.tsx
git commit -m "fix(bench): adjust GridGamma adapter selectors to match rendered DOM"
```

---

### Task 9: Full Typecheck and Test Suite

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm -r typecheck`

Expected: No type errors across the entire monorepo.

- [ ] **Step 2: Run all bench unit tests**

Run: `pnpm --filter @pretable/app-bench test`

Expected: All tests PASS.

- [ ] **Step 3: Run bench-runner unit tests**

Run: `pnpm --filter @pretable-internal/bench-runner test`

Expected: All tests PASS.

- [ ] **Step 4: Run bench-matrix E2E tests**

Run: `node --test scripts/__tests__/bench-matrix.test.mjs scripts/__tests__/bench-e2e.test.mjs`

Expected: All tests PASS.
