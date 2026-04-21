# Column Virtualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add horizontal column virtualization so pretable renders only columns visible in the viewport (plus overscan), then make S3 ("many-columns", 500 cols) runnable in the bench app.

**Architecture:** New `planColumns()` in layout-core mirrors the existing row `planViewport()`. The renderer-dom layer calls both planners. The React surface switches from CSS grid to absolute cell positioning and tracks `scrollLeft`. Pinned columns always render.

**Tech Stack:** TypeScript, React, Vitest, Playwright, pnpm monorepo

---

## File Structure Map

### layout-core — new column planning

- Create: `packages/layout-core/src/column-plan.ts`
- Modify: `packages/layout-core/src/types.ts`
- Modify: `packages/layout-core/src/index.ts`
- Test: `packages/layout-core/src/__tests__/layout-core.test.ts`

### grid-core — viewport state expansion

- Modify: `packages/grid-core/src/types.ts`
- Modify: `packages/grid-core/src/create-grid-core.ts`
- Test: `packages/grid-core/src/__tests__/grid-core.test.ts`

### renderer-dom — column-aware render snapshot

- Modify: `packages/renderer-dom/src/types.ts`
- Modify: `packages/renderer-dom/src/create-renderer.ts`
- Test: `packages/renderer-dom/src/__tests__/renderer-dom.test.ts`

### React surface — absolute positioning and column virtualization

- Modify: `packages/react/src/use-pretable.ts`
- Modify: `packages/react/src/internal/pretable-surface.tsx`
- Modify: `packages/react/src/internal/styles.ts`
- Modify: `packages/react/src/internal/rendering.ts`
- Test: `packages/react/src/internal/__tests__/pretable-surface.test.tsx`

### Bench integration — S3 runnable

- Modify: `apps/bench/src/bench-types.ts`
- Modify: `apps/bench/src/query-state.ts`
- Modify: `packages/bench-runner/src/index.ts`
- Modify: `scripts/bench-matrix.mjs`
- Test: `apps/bench/src/__tests__/query-state.test.ts`
- Test: `packages/bench-runner/src/__tests__/bench-runner.test.ts`
- Test: `scripts/__tests__/bench-matrix.test.mjs`
- Test: `packages/scenario-data/src/__tests__/scenario-data.test.ts`

---

### Task 1: Add `planColumns()` to layout-core

**Files:**

- Create: `packages/layout-core/src/column-plan.ts`
- Modify: `packages/layout-core/src/types.ts`
- Modify: `packages/layout-core/src/index.ts`
- Test: `packages/layout-core/src/__tests__/layout-core.test.ts`

- [ ] **Step 1: Add the new types to `packages/layout-core/src/types.ts`**

Add these types after the existing `ViewportPlan` interface:

```typescript
export interface PlanColumnsInput {
  columns: readonly PlanColumnsColumnInput[];
  scrollLeft: number;
  viewportWidth: number;
  overscan: number;
}

export interface PlanColumnsColumnInput {
  id: string;
  width: number;
  pinned?: "left";
}

export interface PlannedColumn {
  index: number;
  id: string;
  left: number;
  width: number;
  pinned?: "left";
}

export interface ColumnPlan {
  columns: PlannedColumn[];
  totalWidth: number;
  pinnedLeftWidth: number;
}
```

- [ ] **Step 2: Export the new types from `packages/layout-core/src/index.ts`**

Add `planColumns` to the function exports and the new types to the type exports:

```typescript
export { createRowMetricsIndex } from "./prefix-sums";
export { planColumns } from "./column-plan";
export { planViewport } from "./viewport-plan";
export type {
  ColumnPlan,
  LayoutSpan,
  PinnedColumnInput,
  PlanColumnsColumnInput,
  PlanColumnsInput,
  PlannedColumn,
  PlannedPinnedColumn,
  PlannedRow,
  PlanViewportInput,
  RowMetricsIndex,
  ViewportPlan,
} from "./types";
```

- [ ] **Step 3: Write the failing tests in `packages/layout-core/src/__tests__/layout-core.test.ts`**

Add a new `describe("planColumns", ...)` block after the existing tests:

```typescript
import { createRowMetricsIndex, planColumns, planViewport } from "../index";

// ... existing tests ...

describe("planColumns", () => {
  const columns = Array.from({ length: 20 }, (_, i) => ({
    id: `col_${i}`,
    width: 140,
  }));

  test("returns only the columns visible in the viewport plus overscan", () => {
    const plan = planColumns({
      columns,
      scrollLeft: 0,
      viewportWidth: 400,
      overscan: 1,
    });

    // 400px viewport / 140px cols = ~3 visible columns, +1 overscan on right
    expect(plan.columns.length).toBeLessThan(20);
    expect(plan.columns.length).toBeGreaterThanOrEqual(3);
    expect(plan.columns.every((c) => c.left >= 0)).toBe(true);
    expect(plan.totalWidth).toBe(20 * 140);
    expect(plan.pinnedLeftWidth).toBe(0);
  });

  test("includes pinned columns regardless of scrollLeft", () => {
    const columnsWithPinned = [
      { id: "pinned_0", width: 100, pinned: "left" as const },
      { id: "pinned_1", width: 120, pinned: "left" as const },
      ...columns,
    ];

    const plan = planColumns({
      columns: columnsWithPinned,
      scrollLeft: 2000,
      viewportWidth: 400,
      overscan: 1,
    });

    const pinnedIds = plan.columns
      .filter((c) => c.pinned === "left")
      .map((c) => c.id);

    expect(pinnedIds).toEqual(["pinned_0", "pinned_1"]);
    expect(plan.pinnedLeftWidth).toBe(220);
  });

  test("returns correct absolute left offsets for visible columns", () => {
    const plan = planColumns({
      columns,
      scrollLeft: 280,
      viewportWidth: 400,
      overscan: 0,
    });

    for (const col of plan.columns) {
      expect(col.left).toBe(col.index * 140);
    }
  });

  test("handles scrollLeft at the rightmost edge", () => {
    const totalWidth = 20 * 140;
    const plan = planColumns({
      columns,
      scrollLeft: totalWidth - 400,
      viewportWidth: 400,
      overscan: 1,
    });

    const lastCol = plan.columns[plan.columns.length - 1];
    expect(lastCol?.id).toBe("col_19");
    expect(plan.columns.length).toBeGreaterThanOrEqual(3);
  });

  test("returns all columns when they fit within the viewport", () => {
    const smallColumns = [
      { id: "a", width: 100 },
      { id: "b", width: 100 },
      { id: "c", width: 100 },
    ];

    const plan = planColumns({
      columns: smallColumns,
      scrollLeft: 0,
      viewportWidth: 1440,
      overscan: 6,
    });

    expect(plan.columns).toHaveLength(3);
    expect(plan.totalWidth).toBe(300);
  });

  test("returns empty columns for an empty input", () => {
    const plan = planColumns({
      columns: [],
      scrollLeft: 0,
      viewportWidth: 400,
      overscan: 6,
    });

    expect(plan.columns).toHaveLength(0);
    expect(plan.totalWidth).toBe(0);
    expect(plan.pinnedLeftWidth).toBe(0);
  });

  test("clamps overscan to array bounds", () => {
    const plan = planColumns({
      columns: columns.slice(0, 5),
      scrollLeft: 280,
      viewportWidth: 280,
      overscan: 10,
    });

    expect(plan.columns).toHaveLength(5);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `pnpm --filter @pretable-internal/layout-core exec vitest run --reporter verbose`
Expected: FAIL — `planColumns` is not exported yet

- [ ] **Step 5: Implement `planColumns` in `packages/layout-core/src/column-plan.ts`**

```typescript
import type { ColumnPlan, PlanColumnsInput, PlannedColumn } from "./types";

export function planColumns(input: PlanColumnsInput): ColumnPlan {
  const pinned: PlannedColumn[] = [];
  const scrollable: {
    index: number;
    id: string;
    width: number;
    left: number;
  }[] = [];
  let pinnedLeftWidth = 0;
  let scrollableLeft = 0;

  for (let i = 0; i < input.columns.length; i++) {
    const col = input.columns[i];

    if (col.pinned === "left") {
      pinned.push({
        index: i,
        id: col.id,
        left: pinnedLeftWidth,
        width: col.width,
        pinned: "left",
      });
      pinnedLeftWidth += col.width;
    } else {
      scrollable.push({
        index: i,
        id: col.id,
        width: col.width,
        left: scrollableLeft,
      });
      scrollableLeft += col.width;
    }
  }

  const totalWidth = pinnedLeftWidth + scrollableLeft;

  if (scrollable.length === 0) {
    return { columns: pinned, totalWidth, pinnedLeftWidth };
  }

  // Binary search for the first scrollable column visible at scrollLeft
  let low = 0;
  let high = scrollable.length - 1;
  let visibleStart = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const colRight =
      scrollable[mid].left + scrollable[mid].width + pinnedLeftWidth;

    if (colRight <= input.scrollLeft) {
      low = mid + 1;
    } else {
      visibleStart = mid;
      high = mid - 1;
    }
  }

  // Walk forward to find the end of the visible range
  let visibleEnd = visibleStart;
  const scrollRight = input.scrollLeft + input.viewportWidth;

  while (visibleEnd < scrollable.length) {
    const colLeft = scrollable[visibleEnd].left + pinnedLeftWidth;

    if (colLeft >= scrollRight) {
      break;
    }

    visibleEnd++;
  }

  // Apply overscan
  const overscanStart = Math.max(0, visibleStart - input.overscan);
  const overscanEnd = Math.min(scrollable.length, visibleEnd + input.overscan);

  const visibleScrollable: PlannedColumn[] = [];

  for (let i = overscanStart; i < overscanEnd; i++) {
    const col = scrollable[i];
    visibleScrollable.push({
      index: col.index,
      id: col.id,
      left: col.left + pinnedLeftWidth,
      width: col.width,
    });
  }

  return {
    columns: [...pinned, ...visibleScrollable],
    totalWidth,
    pinnedLeftWidth,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @pretable-internal/layout-core exec vitest run --reporter verbose`
Expected: All tests pass, including the new `planColumns` tests

- [ ] **Step 7: Commit**

```bash
git add packages/layout-core/src/column-plan.ts packages/layout-core/src/types.ts packages/layout-core/src/index.ts packages/layout-core/src/__tests__/layout-core.test.ts
git commit -m "feat(layout-core): add planColumns for horizontal column virtualization"
```

---

### Task 2: Expand grid-core viewport state with `scrollLeft` and `width`

**Files:**

- Modify: `packages/grid-core/src/types.ts`
- Modify: `packages/grid-core/src/create-grid-core.ts`
- Test: `packages/grid-core/src/__tests__/grid-core.test.ts`

- [ ] **Step 1: Update the existing grid-core test to use the expanded viewport state**

In `packages/grid-core/src/__tests__/grid-core.test.ts`, update the test `"the external store can return a snapshot and emit change notifications"`. Change the `setViewport` calls to include `scrollLeft` and `width`:

```typescript
test("the external store can return a snapshot and emit change notifications", () => {
  const grid = createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
  });
  let notifications = 0;

  const unsubscribe = grid.subscribe(() => {
    notifications += 1;
  });

  grid.setViewport({ scrollTop: 240, scrollLeft: 0, height: 320, width: 1440 });
  unsubscribe();
  grid.setViewport({
    scrollTop: 480,
    scrollLeft: 100,
    height: 320,
    width: 1440,
  });

  expect(notifications).toBe(1);
  expect(grid.getSnapshot().viewport).toEqual({
    scrollTop: 480,
    scrollLeft: 100,
    height: 320,
    width: 1440,
  });
});
```

Also update the `"getSnapshot returns a stable reference until state changes"` test:

```typescript
test("getSnapshot returns a stable reference until state changes", () => {
  const grid = createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
  });

  const first = grid.getSnapshot();
  const second = grid.getSnapshot();

  expect(second).toBe(first);

  grid.setViewport({ scrollTop: 44, scrollLeft: 0, height: 320, width: 1440 });

  const third = grid.getSnapshot();

  expect(third).not.toBe(first);
  expect(grid.getSnapshot()).toBe(third);
});
```

Add a new test for `scrollLeft` change detection:

```typescript
test("setViewport emits when scrollLeft changes and suppresses when unchanged", () => {
  const grid = createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
  });
  let notifications = 0;

  grid.subscribe(() => {
    notifications += 1;
  });

  grid.setViewport({ scrollTop: 0, scrollLeft: 0, height: 320, width: 1440 });

  expect(notifications).toBe(1);

  // Same state — should not emit
  grid.setViewport({ scrollTop: 0, scrollLeft: 0, height: 320, width: 1440 });

  expect(notifications).toBe(1);

  // scrollLeft changed — should emit
  grid.setViewport({ scrollTop: 0, scrollLeft: 200, height: 320, width: 1440 });

  expect(notifications).toBe(2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @pretable-internal/grid-core exec vitest run --reporter verbose`
Expected: FAIL — `scrollLeft` and `width` are not in `GridCoreViewportState`

- [ ] **Step 3: Update `packages/grid-core/src/types.ts`**

Change `GridCoreViewportState` to:

```typescript
export interface GridCoreViewportState {
  scrollTop: number;
  scrollLeft: number;
  height: number;
  width: number;
}
```

- [ ] **Step 4: Update `packages/grid-core/src/create-grid-core.ts`**

Change the initial viewport state on line 28 from:

```typescript
let viewport: GridCoreViewportState = { scrollTop: 0, height: 0 };
```

to:

```typescript
let viewport: GridCoreViewportState = {
  scrollTop: 0,
  scrollLeft: 0,
  height: 0,
  width: 0,
};
```

Update the `setViewport` equality check (around line 143-148) from:

```typescript
if (
  viewport.scrollTop === nextViewport.scrollTop &&
  viewport.height === nextViewport.height
) {
  return;
}
```

to:

```typescript
if (
  viewport.scrollTop === nextViewport.scrollTop &&
  viewport.scrollLeft === nextViewport.scrollLeft &&
  viewport.height === nextViewport.height &&
  viewport.width === nextViewport.width
) {
  return;
}
```

- [ ] **Step 5: Fix all TypeScript callers that pass the old 2-field viewport**

There are several files that call `grid.setViewport` or `setViewport` with only `{ scrollTop, height }`. Each needs `scrollLeft` and `width` added. Find them with:

Run: `pnpm typecheck 2>&1 | grep "scrollLeft"`

Fix each caller by adding the missing fields. The key callers are:

- `packages/react/src/use-pretable.ts` (the `useLayoutEffect` that syncs viewport)
- `packages/react/src/internal/pretable-surface.tsx` (the `onScroll` handler)
- `packages/renderer-dom/src/__tests__/renderer-dom.test.ts` (test that calls `grid.setViewport`)

For each, add `scrollLeft: 0` and `width: 0` (or the appropriate value) to the viewport object. These will be wired up properly in later tasks.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @pretable-internal/grid-core exec vitest run --reporter verbose`
Expected: All tests pass

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 7: Commit**

```bash
git add packages/grid-core/src/types.ts packages/grid-core/src/create-grid-core.ts packages/grid-core/src/__tests__/grid-core.test.ts packages/react/src/use-pretable.ts packages/react/src/internal/pretable-surface.tsx packages/renderer-dom/src/__tests__/renderer-dom.test.ts
git commit -m "feat(grid-core): expand viewport state with scrollLeft and width"
```

---

### Task 3: Add column planning to renderer-dom

**Files:**

- Modify: `packages/renderer-dom/src/types.ts`
- Modify: `packages/renderer-dom/src/create-renderer.ts`
- Test: `packages/renderer-dom/src/__tests__/renderer-dom.test.ts`

- [ ] **Step 1: Write failing tests in `packages/renderer-dom/src/__tests__/renderer-dom.test.ts`**

Add these tests to the existing `describe("renderer-dom", ...)` block:

```typescript
test("virtualizes columns when scrollLeft and viewportWidth are provided", () => {
  const manyColumns = Array.from({ length: 50 }, (_, i) => ({
    id: `col_${i}`,
    header: `Column ${i}`,
    widthPx: 140,
  }));
  const grid = createGridCore({
    columns: manyColumns,
    rows: [
      {
        id: "row-0",
        ...Object.fromEntries(manyColumns.map((c) => [c.id, `val-${c.id}`])),
      },
      {
        id: "row-1",
        ...Object.fromEntries(manyColumns.map((c) => [c.id, `val-${c.id}`])),
      },
    ],
    getRowId: (row) => String(row.id),
  });

  const render = createDomRenderSnapshot({
    columns: grid.options.columns,
    snapshot: grid.getSnapshot(),
    scrollTop: 0,
    scrollLeft: 0,
    viewportHeight: 320,
    viewportWidth: 400,
    overscan: 1,
  });

  expect(render.columns.length).toBeLessThan(50);
  expect(render.columns.length).toBeGreaterThanOrEqual(3);
  expect(render.totalWidth).toBe(50 * 140);
  expect(render.nodeCount).toBe(render.rows.length * render.columns.length);
});

test("includes pinned columns in the column plan regardless of scrollLeft", () => {
  const columnsWithPinned = [
    {
      id: "pinned_0",
      header: "Pinned 0",
      widthPx: 100,
      pinned: "left" as const,
    },
    {
      id: "pinned_1",
      header: "Pinned 1",
      widthPx: 120,
      pinned: "left" as const,
    },
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `col_${i}`,
      header: `Column ${i}`,
      widthPx: 140,
    })),
  ];
  const grid = createGridCore({
    columns: columnsWithPinned,
    rows: [
      {
        id: "row-0",
        ...Object.fromEntries(columnsWithPinned.map((c) => [c.id, "v"])),
      },
    ],
    getRowId: (row) => String(row.id),
  });

  const render = createDomRenderSnapshot({
    columns: grid.options.columns,
    snapshot: grid.getSnapshot(),
    scrollTop: 0,
    scrollLeft: 2000,
    viewportHeight: 320,
    viewportWidth: 400,
    overscan: 1,
  });

  const pinnedIds = render.columns
    .filter((c) => c.pinned === "left")
    .map((c) => c.id);

  expect(pinnedIds).toEqual(["pinned_0", "pinned_1"]);
});

test("returns all columns when viewportWidth is not provided (backwards compatible)", () => {
  const grid = createGridCore({
    columns: [
      { id: "a", header: "A", widthPx: 140 },
      { id: "b", header: "B", widthPx: 140 },
    ],
    rows: [{ id: "row-0", a: "1", b: "2" }],
    getRowId: (row) => String(row.id),
  });

  const render = createDomRenderSnapshot({
    columns: grid.options.columns,
    snapshot: grid.getSnapshot(),
    scrollTop: 0,
    viewportHeight: 320,
    overscan: 1,
  });

  expect(render.columns).toHaveLength(2);
  expect(render.columns[0]).toMatchObject({ id: "a", left: 0, width: 140 });
  expect(render.columns[1]).toMatchObject({ id: "b", left: 140, width: 140 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @pretable-internal/renderer-dom exec vitest run --reporter verbose`
Expected: FAIL — `columns` property doesn't exist on the render snapshot, `scrollLeft`/`viewportWidth` not in input type

- [ ] **Step 3: Update `packages/renderer-dom/src/types.ts`**

Add `scrollLeft` and `viewportWidth` to `DomRenderInput` and `columns` to `DomRenderSnapshot`:

```typescript
import type {
  GridCoreColumn,
  GridCoreFrame,
  GridCoreRow,
  GridCoreSnapshot,
} from "@pretable-internal/grid-core";
import type { PlannedColumn } from "@pretable-internal/layout-core";

export interface DomRenderInput<TRow extends GridCoreRow = GridCoreRow> {
  columns: GridCoreColumn<TRow>[];
  snapshot: GridCoreSnapshot<TRow>;
  scrollTop: number;
  scrollLeft?: number;
  viewportHeight: number;
  viewportWidth?: number;
  overscan: number;
  measuredHeights?: Record<string, number>;
}

export interface DomRenderRow<TRow extends GridCoreRow = GridCoreRow> {
  id: string;
  row: TRow;
  rowIndex: number;
  top: number;
  height: number;
}

export interface DomRenderSnapshot<TRow extends GridCoreRow = GridCoreRow> {
  frame: GridCoreFrame<TRow>;
  rows: DomRenderRow<TRow>[];
  columns: PlannedColumn[];
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
}
```

- [ ] **Step 4: Update `packages/renderer-dom/src/create-renderer.ts`**

Import `planColumns` and call it. Add the `columns` field to the snapshot. Change `nodeCount` to use visible columns.

Add the import at the top:

```typescript
import { planColumns } from "@pretable-internal/layout-core";
```

Inside `createDomRenderSnapshot`, after the existing `planViewport` call and `rows` mapping, add column planning. Replace the return statement (the block starting with `return {`) with:

```typescript
const WRAPPED_COLUMN_WIDTH_FOR_PLAN = 220;
const FIXED_COLUMN_WIDTH_FOR_PLAN = 140;

const columnInputs = input.columns.map((col) => ({
  id: col.id,
  width:
    col.widthPx ??
    (col.wrap ? WRAPPED_COLUMN_WIDTH_FOR_PLAN : FIXED_COLUMN_WIDTH_FOR_PLAN),
  pinned: col.pinned,
}));

const columnPlan =
  input.viewportWidth !== undefined
    ? planColumns({
        columns: columnInputs,
        scrollLeft: input.scrollLeft ?? 0,
        viewportWidth: input.viewportWidth,
        overscan: input.overscan,
      })
    : {
        columns: columnInputs.map((col, index) => {
          let left = 0;
          for (let i = 0; i < index; i++) {
            left += columnInputs[i].width;
          }
          return {
            index,
            id: col.id,
            left,
            width: col.width,
            pinned: col.pinned,
          };
        }),
        totalWidth: columnInputs.reduce((sum, col) => sum + col.width, 0),
        pinnedLeftWidth: columnInputs
          .filter((col) => col.pinned === "left")
          .reduce((sum, col) => sum + col.width, 0),
      };

return {
  frame: {
    snapshot: input.snapshot,
  },
  rows,
  columns: columnPlan.columns,
  nodeCount: rows.length * columnPlan.columns.length,
  totalHeight: viewportPlan.totalHeight,
  totalWidth: columnPlan.totalWidth,
};
```

Remove the old `totalWidth` calculation that was in the return block (the `input.columns.reduce(...)` line).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @pretable-internal/renderer-dom exec vitest run --reporter verbose`
Expected: All tests pass (existing + new)

- [ ] **Step 6: Commit**

```bash
git add packages/renderer-dom/src/types.ts packages/renderer-dom/src/create-renderer.ts packages/renderer-dom/src/__tests__/renderer-dom.test.ts
git commit -m "feat(renderer-dom): add column planning to render snapshot"
```

---

### Task 4: Switch React surface to absolute cell positioning

This task changes the layout model for cells from CSS grid to absolute positioning, which is required for column virtualization (only a subset of columns will be in the DOM). This is a prerequisite for the actual column virtualization wiring in Task 5.

**Files:**

- Modify: `packages/react/src/internal/styles.ts`
- Modify: `packages/react/src/internal/pretable-surface.tsx`
- Test: `packages/react/src/internal/__tests__/pretable-surface.test.tsx`

- [ ] **Step 1: Add `getCellStyle` and `getHeaderCellPositionStyle` to `packages/react/src/internal/styles.ts`**

Replace `getHeaderRowStyle` and `getRowStyle` to use absolute positioning instead of CSS grid. Also add a cell positioning function:

```typescript
import type { CSSProperties } from "react";

import { HEADER_HEIGHT } from "./rendering";

export function getViewportStyle(height: number): CSSProperties {
  return {
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 16,
    contain: "content",
    containIntrinsicSize: `auto ${height}px`,
    contentVisibility: "auto",
    height,
    overflow: "auto",
    overflowAnchor: "none",
    overscrollBehavior: "contain",
    position: "relative",
  };
}

export function getHeaderRowStyle(totalWidth: number): CSSProperties {
  return {
    backdropFilter: "blur(8px)",
    background: "rgba(18, 18, 18, 0.94)",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
    insetInline: 0,
    minHeight: HEADER_HEIGHT,
    minWidth: totalWidth,
    position: "sticky",
    top: 0,
    zIndex: 3,
  };
}

export function getScrollContentStyle(
  totalHeight: number,
  totalWidth: number,
): CSSProperties {
  return {
    height: Math.max(totalHeight, 0),
    minWidth: totalWidth,
    position: "relative",
  };
}

export function getRowStyle(top: number, height: number): CSSProperties {
  return {
    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
    boxSizing: "border-box",
    height,
    insetInline: 0,
    position: "absolute",
    top,
  };
}

export function getCellStyle(left: number, width: number): CSSProperties {
  return {
    boxSizing: "border-box",
    height: "100%",
    left,
    padding: "10px 12px",
    position: "absolute",
    width,
  };
}

export function getHeaderCellStyle(left: number, width: number): CSSProperties {
  return {
    boxSizing: "border-box",
    height: "100%",
    left,
    padding: "12px",
    position: "absolute",
    width,
  };
}

export function getPinnedCellStyle(left: number): CSSProperties {
  return {
    background: "rgba(18, 18, 18, 0.96)",
    left,
    position: "sticky",
    zIndex: 1,
  };
}
```

- [ ] **Step 2: Update `packages/react/src/internal/pretable-surface.tsx` to use absolute cell positioning**

This is the largest change. The key modifications:

1. Remove `templateColumns` useMemo (no longer needed)
2. Pass `renderSnapshot.columns` to both header and body rendering
3. Change header from CSS grid to relatively positioned container with absolutely positioned cells
4. Change row from CSS grid to absolutely positioned cells
5. Pass `renderSnapshot.totalWidth` to header row style

Update the component body. Remove the `templateColumns` useMemo entirely:

```typescript
// DELETE this block:
// const templateColumns = useMemo(
//   () => columns.map((column) => `${getColumnWidth(column)}px`).join(" "),
//   [columns],
// );
```

Change the header row rendering to use `renderSnapshot.columns` and absolute positioning. Replace the header `<div>` with:

```typescript
      <div style={getHeaderRowStyle(renderSnapshot.totalWidth)}>
        {renderSnapshot.columns.map((plannedCol) => {
          const column = columns[plannedCol.index];
          if (!column) return null;
          const label = column.header ?? column.id;
          const sortDirection =
            snapshot.sort.columnId === column.id
              ? snapshot.sort.direction
              : null;
          const headerProps =
            getHeaderCellProps?.({
              column,
              sortDirection,
            }) ?? {};
          const pinnedOffset = pinnedOffsets[column.id];
          const positionStyle = pinnedOffset !== undefined
            ? { ...getHeaderCellStyle(plannedCol.left, plannedCol.width), ...getPinnedCellStyle(pinnedOffset) }
            : getHeaderCellStyle(plannedCol.left, plannedCol.width);

          return (
            <button
              {...headerProps}
              aria-label={`Sort ${label}`}
              className={getHeaderCellClassName?.({
                column,
                sortDirection,
              })}
              key={column.id}
              onClick={() => {
                const nextDirection = getNextSortDirection(sortDirection);
                grid.setSort(column.id, nextDirection);
                if (nextDirection) {
                  onSortChange?.({
                    columnId: column.id,
                    direction: nextDirection,
                  });
                } else {
                  onSortChange?.(null);
                }
              }}
              style={{
                alignItems: "start",
                border: 0,
                color: "inherit",
                display: "grid",
                gap: 4,
                textAlign: "left",
                ...positionStyle,
              }}
              type="button"
            >
              {renderHeaderCell ? (
                renderHeaderCell({ column, label, sortDirection })
              ) : (
                <>
                  <span>{label}</span>
                  <strong>
                    {sortDirection === "desc"
                      ? "Newest"
                      : sortDirection === "asc"
                        ? "Oldest"
                        : "Sort"}
                  </strong>
                </>
              )}
            </button>
          );
        })}
      </div>
```

Change the body row rendering. Replace the row `<div>` contents (the `{columns.map((column) => { ... })}` block inside each row) to iterate over `renderSnapshot.columns`:

```typescript
              {renderSnapshot.columns.map((plannedCol) => {
                const column = columns[plannedCol.index];
                if (!column) return null;
                const value = resolveCellValue(row, column);
                const bodyInput = {
                  column,
                  isFocused,
                  isSelected,
                  row,
                  rowId: id,
                  rowIndex,
                  value,
                } satisfies PretableSurfaceBodyCellRenderInput<TRow>;
                const bodyProps = getBodyCellProps?.(bodyInput) ?? {};
                const pinnedOffset = pinnedOffsets[column.id];
                const positionStyle = pinnedOffset !== undefined
                  ? { ...getCellStyle(plannedCol.left, plannedCol.width), ...getPinnedCellStyle(pinnedOffset) }
                  : getCellStyle(plannedCol.left, plannedCol.width);

                return (
                  <div
                    {...bodyProps}
                    className={getBodyCellClassName?.(bodyInput)}
                    data-column-id={column.id}
                    data-focused={isFocused ? "true" : "false"}
                    data-pretable-cell=""
                    data-pretable-wrap={column.wrap ? "true" : undefined}
                    data-selected={isSelected ? "true" : "false"}
                    key={`${id}:${column.id}`}
                    style={{
                      overflowWrap: column.wrap ? "anywhere" : "normal",
                      whiteSpace: column.wrap ? "pre-wrap" : "nowrap",
                      ...positionStyle,
                    }}
                  >
                    {renderBodyCell
                      ? renderBodyCell(bodyInput)
                      : formatCellValue(value)}
                  </div>
                );
              })}
```

Update the row container style call — change from `getRowStyle(templateColumns, top, height)` to `getRowStyle(top, height)`.

Update imports: add `getCellStyle`, `getHeaderCellStyle` to the styles import. Remove the old `getPinnedCellStyle` import and replace with the new one. Remove `getColumnWidth` from the rendering import if it was only used for `templateColumns`.

- [ ] **Step 3: Update the existing tests to account for absolute positioning**

In `packages/react/src/internal/__tests__/pretable-surface.test.tsx`, the test `"renders benchmark markers on the scrolling subtree, preserves viewport policy notes, and applies sticky pinned offsets"` checks for specific styles. Update the `scrollContent` height assertion and the pinned cell assertions to match the new absolute positioning model. The key change: pinned cells still have `position: sticky` but now also have absolute position styles.

Run the tests to see which assertions need updating:

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/pretable-surface.test.tsx --reporter verbose`

Fix any failing style assertions based on the new absolute positioning model.

- [ ] **Step 4: Run the full test suite to verify no regressions**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/internal/styles.ts packages/react/src/internal/pretable-surface.tsx packages/react/src/internal/__tests__/pretable-surface.test.tsx
git commit -m "refactor(react): switch cells from CSS grid to absolute positioning"
```

---

### Task 5: Wire up horizontal scroll tracking and column virtualization in the React surface

**Files:**

- Modify: `packages/react/src/use-pretable.ts`
- Modify: `packages/react/src/internal/pretable-surface.tsx`
- Test: `packages/react/src/internal/__tests__/pretable-surface.test.tsx`

- [ ] **Step 1: Write a failing test for column virtualization in PretableSurface**

Add to `packages/react/src/internal/__tests__/pretable-surface.test.tsx`:

```typescript
  it("renders fewer cells than total columns when column count exceeds viewport width", () => {
    const manyColumns = Array.from({ length: 50 }, (_, i) => ({
      id: `col_${i}`,
      header: `Column ${i}`,
      widthPx: 140,
    }));
    const manyRows = [
      {
        id: "row-0",
        ...Object.fromEntries(manyColumns.map((c) => [c.id, `val-${c.id}`])),
      },
    ] as DemoRow[];

    const view = render(
      <PretableSurface
        ariaLabel="Wide grid"
        columns={manyColumns}
        getRowId={(row) => row.id}
        overscan={2}
        rows={manyRows}
        viewportHeight={132}
      />,
    );

    const renderedCells = view.container.querySelectorAll("[data-pretable-cell]");

    // 50 columns at 140px = 7000px total. With a default viewport, far fewer should render.
    expect(renderedCells.length).toBeLessThan(50);
    expect(renderedCells.length).toBeGreaterThan(0);
  });

  it("always renders pinned column cells even with column virtualization", () => {
    const wideColumns = [
      { id: "pinned_ts", header: "Timestamp", pinned: "left" as const, widthPx: 188 },
      ...Array.from({ length: 49 }, (_, i) => ({
        id: `col_${i}`,
        header: `Column ${i}`,
        widthPx: 140,
      })),
    ];
    const wideRows = [
      {
        id: "row-0",
        ...Object.fromEntries(wideColumns.map((c) => [c.id, "val"])),
      },
    ] as DemoRow[];

    const view = render(
      <PretableSurface
        ariaLabel="Wide grid"
        columns={wideColumns}
        getRowId={(row) => row.id}
        overscan={2}
        rows={wideRows}
        viewportHeight={132}
      />,
    );

    const pinnedCells = view.container.querySelectorAll(
      '[data-column-id="pinned_ts"]',
    );

    // Should have at least 1 pinned cell (in the body) + 1 header
    expect(pinnedCells.length).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/pretable-surface.test.tsx --reporter verbose`
Expected: FAIL — currently all 50 columns render because `viewportWidth` is not being passed to the render snapshot

- [ ] **Step 3: Pass `scrollLeft` and `viewportWidth` through `usePretableModel`**

In `packages/react/src/use-pretable.ts`, update `UsePretableModelOptions` to include `viewportWidth`:

Add to the interface:

```typescript
export interface UsePretableModelOptions<
  TRow extends PretableRow = PretableRow,
> extends UsePretableOptions<TRow> {
  viewportHeight: number;
  viewportWidth?: number;
  overscan?: number;
  interactionOverrides?: PretableInteractionOverrides | null;
  measuredHeights?: Record<string, number>;
}
```

Update the `usePretableModel` function to destructure `viewportWidth` and pass it through:

```typescript
export function usePretableModel<TRow extends PretableRow = PretableRow>({
  columns,
  rows,
  getRowId,
  viewportHeight,
  viewportWidth,
  overscan = 6,
  interactionOverrides,
  measuredHeights,
}: UsePretableModelOptions<TRow>): PretableModel<TRow> {
```

Update the `createDomRenderSnapshot` call to include `scrollLeft` and `viewportWidth`:

```typescript
const renderSnapshot = useMemo<PretableRenderSnapshot<TRow>>(
  () =>
    createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot,
      scrollTop: snapshot.viewport.scrollTop,
      scrollLeft: snapshot.viewport.scrollLeft,
      viewportHeight,
      viewportWidth,
      overscan,
      measuredHeights,
    }),
  [
    grid.options.columns,
    measuredHeights,
    overscan,
    snapshot,
    viewportHeight,
    viewportWidth,
  ],
);
```

Update the `PretableRenderSnapshot` type to include `columns`:

```typescript
export interface PretableRenderSnapshot<
  TRow extends PretableRow = PretableRow,
> {
  rows: PretableRenderRow<TRow>[];
  columns: {
    index: number;
    id: string;
    left: number;
    width: number;
    pinned?: "left";
  }[];
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
}
```

- [ ] **Step 4: Update PretableSurface to pass `viewportWidth` and track `scrollLeft`**

In `packages/react/src/internal/pretable-surface.tsx`:

Add a `viewportWidth` state that reads from the scroll container's width. Use a ref callback or layout effect to measure the container width:

```typescript
const [viewportWidth, setViewportWidth] = useState(0);
const viewportRef = useRef<HTMLDivElement>(null);
```

Add a layout effect to measure initial width:

```typescript
useLayoutEffect(() => {
  const el = viewportRef.current;
  if (el && viewportWidth === 0) {
    setViewportWidth(el.clientWidth);
  }
});
```

Pass `viewportWidth` to `usePretableModel`:

```typescript
const { grid, snapshot, renderSnapshot, telemetry } = usePretableModel({
  columns,
  getRowId,
  interactionOverrides: interactionState ?? undefined,
  measuredHeights,
  overscan,
  rows,
  viewportHeight: bodyViewportHeight,
  viewportWidth: viewportWidth || undefined,
});
```

Update the `onScroll` handler to include `scrollLeft` and `width`:

```typescript
      onScroll={(event) => {
        const el = event.currentTarget;
        grid.setViewport({
          scrollTop: el.scrollTop,
          scrollLeft: el.scrollLeft,
          height: bodyViewportHeight,
          width: el.clientWidth,
        });
        if (el.clientWidth !== viewportWidth) {
          setViewportWidth(el.clientWidth);
        }
      }}
```

Also update the `useLayoutEffect` that syncs viewport height to include the new fields:

```typescript
useLayoutEffect(() => {
  if (
    snapshot.viewport.height === bodyViewportHeight &&
    snapshot.viewport.width === (viewportWidth || 0)
  ) {
    return;
  }

  grid.setViewport({
    scrollTop: snapshot.viewport.scrollTop,
    scrollLeft: snapshot.viewport.scrollLeft,
    height: bodyViewportHeight,
    width: viewportWidth || 0,
  });
}, [
  grid,
  snapshot.viewport.height,
  snapshot.viewport.width,
  snapshot.viewport.scrollTop,
  snapshot.viewport.scrollLeft,
  bodyViewportHeight,
  viewportWidth,
]);
```

Add `ref={viewportRef}` to the outer `<div>` (the scroll viewport).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/pretable-surface.test.tsx --reporter verbose`
Expected: All tests pass including the new column virtualization tests

- [ ] **Step 6: Run the full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/use-pretable.ts packages/react/src/internal/pretable-surface.tsx packages/react/src/internal/__tests__/pretable-surface.test.tsx
git commit -m "feat(react): wire up column virtualization with horizontal scroll tracking"
```

---

### Task 6: Make S3 runnable in the bench app

**Files:**

- Modify: `apps/bench/src/bench-types.ts`
- Modify: `apps/bench/src/query-state.ts`
- Modify: `packages/bench-runner/src/index.ts`
- Modify: `scripts/bench-matrix.mjs`
- Test: `apps/bench/src/__tests__/query-state.test.ts`
- Test: `packages/bench-runner/src/__tests__/bench-runner.test.ts`
- Test: `scripts/__tests__/bench-matrix.test.mjs`
- Test: `packages/scenario-data/src/__tests__/scenario-data.test.ts`

- [ ] **Step 1: Write the failing tests**

In `apps/bench/src/__tests__/query-state.test.ts`, add:

```typescript
test("accepts S3 many-columns scenario", () => {
  expect(parseBenchQuery("?scenario=S3&scale=dev&script=scroll")).toEqual({
    adapterId: "pretable",
    scenarioId: "S3",
    profile: "default",
    scale: "dev",
    scriptName: "scroll",
    autorun: false,
  });
});
```

In `packages/bench-runner/src/__tests__/bench-runner.test.ts`, add within the `"enforces the explicit P0a support matrix"` test:

```typescript
expect(
  validateSupportedP0aRequest({
    ...baseRequest,
    scenarioId: "S3",
    scriptName: "scroll",
  }),
).toEqual({ ok: true });

// S3 does NOT support interaction scripts
expect(
  validateSupportedP0aRequest({
    ...baseRequest,
    scenarioId: "S3",
    scriptName: "sort",
  }),
).toEqual({
  ok: false,
  reason: expect.stringContaining("scenario"),
});
```

In `packages/scenario-data/src/__tests__/scenario-data.test.ts`, add:

```typescript
test("models many-columns scenario S3 with 500 columns and 2 pinned", () => {
  const dataset = createScenarioDataset("S3");

  expect(getScenarioById("S3")).toMatchObject({
    id: "S3",
    name: "many-columns",
    cols: 500,
    row_height_mode: "fixed",
    wrapped_columns: 0,
    pinned_left: 2,
    update_stream: "none",
  });
  expect(dataset.columns).toHaveLength(500);
  expect(dataset.columns[0]).toMatchObject({ pinned: "left" });
  expect(dataset.columns[1]).toMatchObject({ pinned: "left" });
  expect(dataset.columns[2]).toMatchObject({ pinned: undefined });
  expect(dataset.seed).toBe(303);
  expect(dataset.scale).toBe("smoke");
  expect(dataset.rowCount).toBe(120);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @pretable/app-bench exec vitest run src/__tests__/query-state.test.ts --reporter verbose`
Expected: FAIL — S3 not recognized

Run: `pnpm --filter @pretable-internal/bench-runner exec vitest run --reporter verbose`
Expected: FAIL — S3 not in validation

Run: `pnpm --filter @pretable-internal/scenario-data exec vitest run --reporter verbose`
Expected: PASS (scenario data already defines S3; this test just proves the existing data)

- [ ] **Step 3: Update `apps/bench/src/bench-types.ts`**

Change the scenarioId type:

```typescript
scenarioId: "S1" | "S2" | "S3" | "S7";
```

- [ ] **Step 4: Update `apps/bench/src/query-state.ts`**

Add S3 to the scenario ternary chain. Change:

```typescript
    scenarioId:
      scenario === "S2"
        ? "S2"
        : scenario === "S7"
          ? "S7"
          : DEFAULT_QUERY_STATE.scenarioId,
```

to:

```typescript
    scenarioId:
      scenario === "S2"
        ? "S2"
        : scenario === "S3"
          ? "S3"
          : scenario === "S7"
            ? "S7"
            : DEFAULT_QUERY_STATE.scenarioId,
```

- [ ] **Step 5: Update `packages/bench-runner/src/index.ts`**

Change the scenario validation from `["S1", "S2", "S7"]` to `["S1", "S2", "S3", "S7"]`:

```typescript
  if (!["S1", "S2", "S3", "S7"].includes(request.scenarioId)) {
```

The interaction scripts check stays the same — S3 does NOT support interaction scripts (it uses `scroll` only). The existing check `!["S2", "S7"].includes(request.scenarioId)` correctly excludes S3 from interaction scripts.

- [ ] **Step 6: Update `scripts/bench-matrix.mjs`**

Change `DEFAULT_SCENARIOS` from `["S1", "S2", "S7"]` to `["S1", "S2", "S3", "S7"]`.

- [ ] **Step 7: Update `scripts/__tests__/bench-matrix.test.mjs`**

Find the test that checks `parseBenchMatrixArgs` default scenarios and update the expected array to include `"S3"`.

- [ ] **Step 8: Run all the tests to verify they pass**

Run: `pnpm test`
Run: `node --test scripts/__tests__/bench-matrix.test.mjs`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add apps/bench/src/bench-types.ts apps/bench/src/query-state.ts apps/bench/src/__tests__/query-state.test.ts packages/bench-runner/src/index.ts packages/bench-runner/src/__tests__/bench-runner.test.ts packages/scenario-data/src/__tests__/scenario-data.test.ts scripts/bench-matrix.mjs scripts/__tests__/bench-matrix.test.mjs
git commit -m "feat(bench): make S3 many-columns scenario runnable"
```

---

### Task 7: Verify S1/S2/S7 scroll regression and S3 smoke

**Files:**

- No planned code changes

- [ ] **Step 1: Run lint, typecheck, and full test suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Run: `node --test scripts/__tests__/bench-matrix.test.mjs`
Expected: All pass, no errors

- [ ] **Step 2: Run S1/S2/S7 scroll regression**

Run: `pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S1,S2,S7 --scripts=scroll --scale=dev --repeats=3`
Expected: All runs complete, H1 remains satisfied

- [ ] **Step 3: Run S3 smoke**

Run: `pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S3 --scripts=scroll --scale=dev --repeats=3`
Expected: S3 runs complete successfully. Node count should be much lower than 500 \* visible_rows (proving column virtualization is active).

- [ ] **Step 4: Report results**

Record:

- S1/S2/S7 H1 status
- S3 run status and key metrics (nodeCount, rendered cells, scroll quality)
- Any regressions or unexpected behavior

---

## Errata (2026-04-21)

The `getCellStyle`, `getHeaderCellStyle`, and `getPinnedCellStyle` examples in Task 4, Step 1 of this plan were missing `top: 0`. The `getHeaderRowStyle` and `getRowStyle` examples were also missing a layout context (`display: "flex"`) for in-flow sticky pinned children. Those omissions shipped to production and caused the inspection grid's header backdrop to cover the body grid — sticky pinned cells stacked vertically in block flow, inflating the header row and shifting the static position of absolute siblings.

Fix plan: [`2026-04-21-inspection-grid-layout-fix.md`](./2026-04-21-inspection-grid-layout-fix.md). The fix preserves `position: sticky` for pinned cells as the design spec requires (see [column-virtualization-design.md:106](../specs/2026-04-20-column-virtualization-design.md)).
