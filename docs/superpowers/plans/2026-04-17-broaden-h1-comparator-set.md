# Broaden H1 Comparator Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MUI Data Grid Community edition as a fourth comparator adapter in the bench lab, strengthening the H1 comparative scroll claim.

**Architecture:** New `mui-adapter.tsx` follows the established AG Grid / TanStack adapter pattern (receives `{ dataset, runKey }`, renders inside a `<section data-benchmark-adapter="mui">`). Registration touches four files (bench-types, query-state, bench-app, bench-runtime) plus one bench-runner validation update. MUI's `getRowHeight: () => "auto"` path provides variable-height rows.

**Tech Stack:** `@mui/x-data-grid` (Community), `@mui/material`, `@emotion/react`, `@emotion/styled`, React 19, Vite, Vitest, Playwright

---

### Task 1: Install MUI Dependencies

**Files:**
- Modify: `apps/bench/package.json`

- [ ] **Step 1: Install MUI Data Grid and peer dependencies**

Run from the repo root:

```bash
pnpm --filter @pretable/app-bench add @mui/x-data-grid @mui/material @emotion/react @emotion/styled
```

- [ ] **Step 2: Verify installation**

Run:

```bash
pnpm --filter @pretable/app-bench list @mui/x-data-grid @mui/material @emotion/react @emotion/styled
```

Expected: All four packages listed with versions.

- [ ] **Step 3: Commit**

```bash
git add apps/bench/package.json pnpm-lock.yaml
git commit -m "chore(bench): add MUI Data Grid Community dependencies"
```

---

### Task 2: Add `"mui"` to Bench Types and Query State

**Files:**
- Modify: `apps/bench/src/bench-types.ts:4`
- Modify: `apps/bench/src/query-state.ts:24-30`
- Modify: `apps/bench/src/__tests__/query-state.test.ts`

- [ ] **Step 1: Write the failing test for MUI query parsing**

Add a new test to `apps/bench/src/__tests__/query-state.test.ts` after the TanStack test (line 60):

```typescript
test("accepts the mui competitor adapter without relaxing other defaults", () => {
  expect(
    parseBenchQuery(
      "?adapter=mui&scenario=S2&scale=hypothesis&script=scroll",
    ),
  ).toEqual({
    adapterId: "mui",
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

Expected: FAIL — `adapterId` is `"pretable"` because `"mui"` falls through to the default.

- [ ] **Step 3: Add `"mui"` to the `adapterId` union in bench-types**

In `apps/bench/src/bench-types.ts`, change line 4:

```typescript
adapterId: "pretable" | "ag-grid" | "tanstack" | "mui";
```

- [ ] **Step 4: Add `"mui"` to the adapter parsing chain in query-state**

In `apps/bench/src/query-state.ts`, replace the `adapterId` ternary chain (lines 24-30):

```typescript
    adapterId:
      adapter === "ag-grid"
        ? "ag-grid"
        : adapter === "tanstack"
          ? "tanstack"
          : adapter === "mui"
            ? "mui"
            : adapter === "pretable"
              ? "pretable"
              : DEFAULT_QUERY_STATE.adapterId,
```

- [ ] **Step 5: Update the existing fallback test**

The test at line 17 ("falls back to safe defaults for unsupported params") uses `adapter=mui` as an example of an unsupported adapter. Now that `mui` is supported, change the test input to use a different unsupported adapter:

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
git commit -m "feat(bench): add mui to adapter ID type and query parsing"
```

---

### Task 3: Add `"mui"` to bench-runner Validation

**Files:**
- Modify: `packages/bench-runner/src/index.ts:214`
- Modify: `packages/bench-runner/src/__tests__/bench-runner.test.ts`

- [ ] **Step 1: Write the failing test for MUI scroll support**

Add a new assertion inside the `"enforces the explicit P0a support matrix"` test in `packages/bench-runner/src/__tests__/bench-runner.test.ts`, after the TanStack scroll assertion (around line 91):

```typescript
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "mui",
        scenarioId: "S2",
        scriptName: "scroll",
      }),
    ).toEqual({ ok: true });
```

Also add an assertion that MUI interaction scripts are unsupported, after the TanStack interaction assertion (around line 121):

```typescript
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "mui",
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

Expected: FAIL — MUI scroll returns `{ ok: false }` because `"mui"` is not in the supported adapters list.

- [ ] **Step 3: Add `"mui"` to the supported adapters list**

In `packages/bench-runner/src/index.ts`, change line 214:

```typescript
  if (!["pretable", "ag-grid", "tanstack", "mui"].includes(request.adapterId)) {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/bench-runner test`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bench-runner/src/index.ts packages/bench-runner/src/__tests__/bench-runner.test.ts
git commit -m "feat(bench-runner): add mui to supported P0a adapters"
```

---

### Task 4: Create MUI Adapter Component

**Files:**
- Create: `apps/bench/src/mui-adapter.tsx`
- Create: `apps/bench/src/__tests__/mui-adapter.test.tsx`

- [ ] **Step 1: Write the failing test for the MUI adapter**

Create `apps/bench/src/__tests__/mui-adapter.test.tsx`:

```typescript
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { createScenarioDataset } from "@pretable-internal/scenario-data";

import { MuiAdapter } from "../mui-adapter";

describe("MuiAdapter", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders the expected DOM structure for bench scroll measurement", () => {
    const dataset = createScenarioDataset("S2", { scale: "smoke" });

    render(<MuiAdapter dataset={dataset} runKey={0} />);

    const section = screen
      .getByText("MUI Data Grid Community adapter")
      .closest("section");

    expect(section).toBeTruthy();
    expect(section?.getAttribute("data-benchmark-adapter")).toBe("mui");
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

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/mui-adapter.test.ts`

Expected: FAIL — module `../mui-adapter` does not exist.

- [ ] **Step 3: Create the MUI adapter component**

Create `apps/bench/src/mui-adapter.tsx`:

```tsx
import { useMemo } from "react";

import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";

export interface MuiAdapterProps {
  dataset: ScenarioDataset;
  runKey: number;
}

export function MuiAdapter({ dataset, runKey }: MuiAdapterProps) {
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
      aria-label="MUI Data Grid Community adapter"
      data-benchmark-adapter="mui"
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
          MUI Data Grid Community adapter
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {rows.length}
        </p>
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

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/mui-adapter.test.ts`

Expected: PASS

- [ ] **Step 5: Run all bench tests to check for regressions**

Run: `pnpm --filter @pretable/app-bench test`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/bench/src/mui-adapter.tsx apps/bench/src/__tests__/mui-adapter.test.tsx
git commit -m "feat(bench): add MUI Data Grid Community adapter component"
```

---

### Task 5: Register MUI Adapter in Bench App

**Files:**
- Modify: `apps/bench/src/bench-app.tsx:26-56`
- Modify: `apps/bench/src/__tests__/bench-app.test.tsx`

- [ ] **Step 1: Write the failing test for MUI adapter rendering**

Add a new test to `apps/bench/src/__tests__/bench-app.test.tsx` after the TanStack test (around line 96):

```typescript
test("renders the requested mui competitor surface", async () => {
  render(
    <BenchApp
      search="?adapter=mui&scenario=S2"
      browserVersion="123.0"
    />,
  );

  expect(screen.getByText("MUI Data Grid harness")).toBeTruthy();
  expect(screen.getByText("MUI Data Grid Community adapter")).toBeTruthy();
  expect(screen.queryAllByText("Pretable harness")).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-app.test.tsx`

Expected: FAIL — `"mui"` is not a key of `adapterRegistry`, causing a type error or runtime crash.

- [ ] **Step 3: Register the MUI adapter in bench-app**

In `apps/bench/src/bench-app.tsx`, add the import at line 30 (after the TanStack import):

```typescript
import { MuiAdapter } from "./mui-adapter";
```

Then add a `"mui"` entry to the `adapterRegistry` object (after the `tanstack` entry, before `} as const`):

```typescript
  mui: {
    heading: "MUI Data Grid harness",
    description:
      "Community baseline using the vendor-documented auto-height row path.",
    render: MuiAdapter,
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pretable/app-bench test -- --run src/__tests__/bench-app.test.tsx`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/bench/src/bench-app.tsx apps/bench/src/__tests__/bench-app.test.tsx
git commit -m "feat(bench): register MUI adapter in bench app"
```

---

### Task 6: Add MUI Scroll Runtime Profile

**Files:**
- Modify: `apps/bench/src/bench-runtime.ts:135-176`

- [ ] **Step 1: Add the MUI scroll runtime profile**

In `apps/bench/src/bench-runtime.ts`, add a `"mui"` entry to the `scrollRuntimeProfiles` record (after the `tanstack` entry, before the closing `}`). The selectors below are based on MUI Data Grid's documented DOM structure — they must be verified against the rendered DOM during E2E testing and adjusted if the installed version uses different class names.

```typescript
  mui: {
    viewportSelector: ".MuiDataGrid-virtualScroller",
    rowSelector: ".MuiDataGrid-row",
    cellSelector: ".MuiDataGrid-cell",
    rowIdAttribute: "data-id",
    rowIndexAttribute: "data-rowindex",
    maxSettleFrames: 4,
    measureRowHeightError: (row, renderedHeight) =>
      measureWrappedCellRowHeightError(
        row,
        renderedHeight,
        ".MuiDataGrid-cell",
      ),
  },
```

- [ ] **Step 2: Run typecheck to verify the profile is complete**

Run: `pnpm --filter @pretable/app-bench typecheck`

Expected: No type errors. The `scrollRuntimeProfiles` record is typed as `Record<BenchQueryState["adapterId"], ScrollRuntimeProfile>`, so TypeScript will enforce that the `mui` key exists now that it's part of the union.

- [ ] **Step 3: Run all bench tests to check for regressions**

Run: `pnpm --filter @pretable/app-bench test`

Expected: All tests PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/bench/src/bench-runtime.ts
git commit -m "feat(bench): add MUI scroll runtime profile"
```

---

### Task 7: Update Bench Spec Adapter Label Chain

**Files:**
- Modify: `apps/bench/tests/bench.spec.ts:15-20`

- [ ] **Step 1: Add `"mui"` to the adapter label chain**

In `apps/bench/tests/bench.spec.ts`, replace lines 15-20:

```typescript
const adapterLabel =
  adapterId === "ag-grid"
    ? "AG Grid Community adapter"
    : adapterId === "tanstack"
      ? "TanStack Virtual adapter"
      : adapterId === "mui"
        ? "MUI Data Grid Community adapter"
        : "Pretable React adapter";
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pretable/app-bench typecheck`

Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/bench/tests/bench.spec.ts
git commit -m "feat(bench): add MUI adapter label to bench spec"
```

---

### Task 8: Verify DOM Selectors and Run E2E

This task verifies that MUI's rendered DOM matches the selectors assumed in the scroll runtime profile. This requires a running browser (Playwright).

**Files:**
- Possibly modify: `apps/bench/src/bench-runtime.ts` (if selectors need adjustment)
- Possibly modify: `apps/bench/src/mui-adapter.tsx` (if `getRowHeight` API differs)

- [ ] **Step 1: Build the bench app**

Run:

```bash
pnpm --filter @pretable/app-bench build
```

Expected: Build succeeds.

- [ ] **Step 2: Run a dev-scale MUI scroll E2E**

Run:

```bash
PRETABLE_BENCH_ADAPTER=mui PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=scroll pnpm bench:e2e -- --project=chromium
```

Expected: Produces a `*.summary.json` with `status: "completed"`, `adapterId: "mui"`, and scroll metrics including `scroll_frame_p95_ms`, `blank_gap_frames`, `dom_nodes_peak`, etc.

- [ ] **Step 3: If E2E fails, inspect DOM and adjust selectors**

If the scroll measurement returns `status: "partial"` or the test fails:

1. Run `pnpm --filter @pretable/app-bench dev`
2. Open `http://localhost:5173/?adapter=mui&scenario=S2&scale=smoke` in a browser
3. Inspect the MUI Data Grid DOM to find the actual CSS class names for:
   - The scroll viewport container (expected: `.MuiDataGrid-virtualScroller`)
   - Row elements (expected: `.MuiDataGrid-row`)
   - Cell elements (expected: `.MuiDataGrid-cell`)
   - Row ID attribute (expected: `data-id`)
   - Row index attribute (expected: `data-rowindex`)
4. Update the selectors in `apps/bench/src/bench-runtime.ts` accordingly
5. If MUI's auto-height rows use inline styles instead of content-based sizing, switch `measureRowHeightError` to `measureAgGridRowHeightError`

- [ ] **Step 4: Verify MUI unsupported interaction path**

Run:

```bash
PRETABLE_BENCH_ADAPTER=mui PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=sort pnpm bench:e2e -- --project=chromium
```

Expected: Produces a `*.summary.json` with `status: "unsupported"`.

- [ ] **Step 5: Commit any selector adjustments**

If selectors were adjusted:

```bash
git add apps/bench/src/bench-runtime.ts apps/bench/src/mui-adapter.tsx
git commit -m "fix(bench): adjust MUI adapter selectors to match rendered DOM"
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
