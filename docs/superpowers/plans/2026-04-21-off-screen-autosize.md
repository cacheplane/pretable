# Off-Screen Autosize (S4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automatic column width estimation to pretable so columns without explicit `widthPx` get content-fit widths computed from character-count heuristics.

**Architecture:** A pure `autosizeColumns()` function in layout-core estimates widths from text content (no DOM). grid-core integrates it via a declarative `autosize` option on `GridCoreOptions` and an imperative `autosizeColumns()` method on `GridCoreStore`. Columns with explicit `widthPx` are skipped. Widths are clamped to [60, 400] by default.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-04-21-off-screen-autosize-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/layout-core/src/autosize-columns.ts` | Pure `autosizeColumns()` function and types |
| Create | `packages/layout-core/src/__tests__/autosize-columns.test.ts` | Tests for the autosize function |
| Modify | `packages/layout-core/src/index.ts` | Export `autosizeColumns` and its types |
| Modify | `packages/layout-core/src/types.ts` | Add autosize-related type definitions |
| Modify | `packages/grid-core/src/types.ts` | Add `autosize` to `GridCoreOptions`, `autosizeColumns` to `GridCoreStore` |
| Modify | `packages/grid-core/src/create-grid-core.ts` | Call `autosizeColumns` on init and expose imperative method |
| Modify | `packages/grid-core/src/__tests__/grid-core.test.ts` | Tests for declarative and imperative autosize in grid-core |
| Modify | `packages/core/src/types.ts` | Re-export `AutosizeOptions` from grid-core |
| Modify | `packages/core/src/create-grid.ts` | Wire `autosizeColumns` method through |
| Modify | `packages/core/src/index.ts` | Export `AutosizeOptions` |
| Modify | `packages/scenario-data/src/index.ts` | Make `widthPx` optional on `ScenarioColumn`, omit for S4 |
| Modify | `apps/bench/src/pretable-adapter.tsx` | Pass `autosize: true` for S4 datasets |

---

### Task 1: Pure `autosizeColumns` function in layout-core

**Files:**
- Create: `packages/layout-core/src/autosize-columns.ts`
- Create: `packages/layout-core/src/__tests__/autosize-columns.test.ts`
- Modify: `packages/layout-core/src/types.ts`
- Modify: `packages/layout-core/src/index.ts`

- [ ] **Step 1: Add autosize types to layout-core types.ts**

Add the following types at the end of `packages/layout-core/src/types.ts`:

```typescript
export interface AutosizeColumnDef<
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  header?: string;
  widthPx?: number;
  wrap?: boolean;
  getValue?: (row: TRow) => unknown;
}

export interface AutosizeOptions {
  maxWidthPx?: number;
  minWidthPx?: number;
  averageCharWidth?: number;
  cellPaddingPx?: number;
}

export interface AutosizeColumnsInput<
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  columns: AutosizeColumnDef<TRow>[];
  rows: TRow[];
  options?: AutosizeOptions;
}

export interface AutosizeResult {
  widths: Map<string, number>;
}
```

- [ ] **Step 2: Write the failing test for basic autosize behavior**

Create `packages/layout-core/src/__tests__/autosize-columns.test.ts`:

```typescript
import { describe, expect, test } from "vitest";

import { autosizeColumns } from "../index";

describe("autosizeColumns", () => {
  const rows = [
    { id: "1", name: "Alice", status: "ok", description: "A longer description that should make the column wider" },
    { id: "2", name: "Bob", status: "pending", description: "Short" },
    { id: "3", name: "Charlie Brown", status: "ok", description: "Medium length text" },
  ];

  test("computes widths based on content length", () => {
    const result = autosizeColumns({
      columns: [
        { id: "name", header: "Name" },
        { id: "status", header: "Status" },
        { id: "description", header: "Description" },
      ],
      rows,
    });

    const nameWidth = result.widths.get("name")!;
    const statusWidth = result.widths.get("status")!;
    const descriptionWidth = result.widths.get("description")!;

    // "Charlie Brown" (13 chars) is the widest name content
    // "pending" (7 chars) is the widest status content
    // The long description is the widest description content
    expect(nameWidth).toBeGreaterThan(statusWidth);
    expect(descriptionWidth).toBeGreaterThan(nameWidth);
    expect(result.widths.size).toBe(3);
  });

  test("skips columns with explicit widthPx", () => {
    const result = autosizeColumns({
      columns: [
        { id: "name", header: "Name", widthPx: 200 },
        { id: "status", header: "Status" },
      ],
      rows,
    });

    expect(result.widths.has("name")).toBe(false);
    expect(result.widths.has("status")).toBe(true);
  });

  test("respects maxWidthPx cap", () => {
    const result = autosizeColumns({
      columns: [{ id: "description", header: "Description" }],
      rows,
      options: { maxWidthPx: 100 },
    });

    expect(result.widths.get("description")!).toBeLessThanOrEqual(100);
  });

  test("respects minWidthPx floor", () => {
    const result = autosizeColumns({
      columns: [{ id: "status", header: "S" }],
      rows: [{ id: "1", status: "" }],
      options: { minWidthPx: 80 },
    });

    expect(result.widths.get("status")!).toBeGreaterThanOrEqual(80);
  });

  test("includes header text width in calculation", () => {
    const result = autosizeColumns({
      columns: [{ id: "status", header: "A Very Long Header Name" }],
      rows: [{ id: "1", status: "ok" }],
    });

    // Header is 23 chars, content is 2 chars — header should win
    // At 7px/char + 16px padding, header width ≈ 177px
    expect(result.widths.get("status")!).toBeGreaterThan(100);
  });

  test("uses default options when none provided", () => {
    const result = autosizeColumns({
      columns: [{ id: "name", header: "Name" }],
      rows,
    });

    const width = result.widths.get("name")!;

    // Default min is 60, default max is 400
    expect(width).toBeGreaterThanOrEqual(60);
    expect(width).toBeLessThanOrEqual(400);
  });

  test("uses getValue when provided", () => {
    const result = autosizeColumns({
      columns: [
        {
          id: "computed",
          header: "Computed",
          getValue: (row: Record<string, unknown>) =>
            `${row.name}-${row.status}`,
        },
      ],
      rows,
    });

    // "Charlie Brown-ok" (16 chars) is the widest computed value
    // At 7px/char + 16px padding = 128px
    expect(result.widths.get("computed")!).toBeGreaterThan(100);
  });

  test("handles empty rows", () => {
    const result = autosizeColumns({
      columns: [{ id: "name", header: "Name" }],
      rows: [],
    });

    // Only header contributes — "Name" is 4 chars at 7px + 16px = 44px → clamped to minWidthPx 60
    expect(result.widths.get("name")!).toBe(60);
  });

  test("handles null and undefined cell values", () => {
    const result = autosizeColumns({
      columns: [{ id: "missing", header: "Missing" }],
      rows: [{ id: "1" }, { id: "2", missing: null }, { id: "3", missing: undefined }],
    });

    // All values coerce to "" — header "Missing" (7 chars) at 7px + 16px = 65px
    expect(result.widths.get("missing")!).toBeGreaterThanOrEqual(60);
  });

  test("handles emoji and multi-byte characters correctly", () => {
    const result = autosizeColumns({
      columns: [{ id: "emoji", header: "Emoji" }],
      rows: [{ id: "1", emoji: "Hello 👋🌍" }],
    });

    // "Hello 👋🌍" has 9 graphemes via Array.from()
    // 9 * 7 + 16 = 79px
    expect(result.widths.get("emoji")!).toBeGreaterThanOrEqual(60);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @pretable-internal/layout-core test -- --run`
Expected: FAIL — `autosizeColumns` is not exported from `../index`

- [ ] **Step 4: Implement the `autosizeColumns` function**

Create `packages/layout-core/src/autosize-columns.ts`:

```typescript
import type {
  AutosizeColumnsInput,
  AutosizeResult,
} from "./types";

const DEFAULT_MAX_WIDTH_PX = 400;
const DEFAULT_MIN_WIDTH_PX = 60;
const DEFAULT_AVERAGE_CHAR_WIDTH = 7;
const DEFAULT_CELL_PADDING_PX = 16;

export function autosizeColumns<
  TRow extends Record<string, unknown> = Record<string, unknown>,
>(input: AutosizeColumnsInput<TRow>): AutosizeResult {
  const maxWidthPx = input.options?.maxWidthPx ?? DEFAULT_MAX_WIDTH_PX;
  const minWidthPx = input.options?.minWidthPx ?? DEFAULT_MIN_WIDTH_PX;
  const averageCharWidth =
    input.options?.averageCharWidth ?? DEFAULT_AVERAGE_CHAR_WIDTH;
  const cellPaddingPx = input.options?.cellPaddingPx ?? DEFAULT_CELL_PADDING_PX;
  const widths = new Map<string, number>();

  for (const column of input.columns) {
    if (column.widthPx !== undefined) {
      continue;
    }

    let maxContentWidth = 0;

    // Include header text width
    if (column.header) {
      const headerWidth =
        Array.from(column.header).length * averageCharWidth + cellPaddingPx;
      maxContentWidth = Math.max(maxContentWidth, headerWidth);
    }

    // Scan all rows for widest content
    for (const row of input.rows) {
      const rawValue = column.getValue
        ? column.getValue(row)
        : row[column.id];
      const text = String(rawValue ?? "");

      if (text.length === 0) {
        continue;
      }

      const contentWidth =
        Array.from(text).length * averageCharWidth + cellPaddingPx;
      maxContentWidth = Math.max(maxContentWidth, contentWidth);
    }

    const clampedWidth = Math.max(
      minWidthPx,
      Math.min(maxWidthPx, maxContentWidth),
    );
    widths.set(column.id, clampedWidth);
  }

  return { widths };
}
```

- [ ] **Step 5: Export from layout-core index**

In `packages/layout-core/src/index.ts`, add the export:

```typescript
export { autosizeColumns } from "./autosize-columns";
```

And add the type exports:

```typescript
export type {
  AutosizeColumnDef,
  AutosizeColumnsInput,
  AutosizeOptions,
  AutosizeResult,
  // ...existing exports...
} from "./types";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/layout-core test -- --run`
Expected: PASS — all autosize tests green

- [ ] **Step 7: Run workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS — no type errors across workspace

- [ ] **Step 8: Commit**

```bash
git add packages/layout-core/src/autosize-columns.ts packages/layout-core/src/__tests__/autosize-columns.test.ts packages/layout-core/src/types.ts packages/layout-core/src/index.ts
git commit -m "feat(layout-core): add autosizeColumns pure function

Estimates column widths from content using character-count heuristics.
Skips columns with explicit widthPx. Clamps to [minWidthPx, maxWidthPx].
Includes header text in width calculation."
```

---

### Task 2: Grid-core store integration — declarative and imperative autosize

**Files:**
- Modify: `packages/grid-core/src/types.ts:6-21,17-21,62-74`
- Modify: `packages/grid-core/src/create-grid-core.ts:1-17,15-162`
- Modify: `packages/grid-core/src/__tests__/grid-core.test.ts`

- [ ] **Step 1: Add `autosize` to `GridCoreOptions` and `autosizeColumns` to `GridCoreStore`**

In `packages/grid-core/src/types.ts`, add the import at the top:

```typescript
import type { AutosizeOptions, LayoutSpan } from "@pretable-internal/layout-core";
```

Replace the existing `import type { LayoutSpan }` line.

Add `autosize` to `GridCoreOptions`:

```typescript
export interface GridCoreOptions<TRow extends GridCoreRow = GridCoreRow> {
  columns: GridCoreColumn<TRow>[];
  rows: TRow[];
  getRowId?: (row: TRow, index: number) => string;
  autosize?: boolean | AutosizeOptions;
}
```

Add `autosizeColumns` to `GridCoreStore`:

```typescript
export interface GridCoreStore<TRow extends GridCoreRow = GridCoreRow> {
  options: GridCoreOptions<TRow>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): GridCoreSnapshot<TRow>;
  setSort(columnId: string | null, direction: GridCoreSortDirection): void;
  setFilter(columnId: string, value: string): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, string>): void;
  selectRow(rowId: string | null): void;
  setFocus(rowId: string | null, columnId: string | null): void;
  moveFocus(delta: number): void;
  setViewport(viewport: GridCoreViewportState): void;
  autosizeColumns(autosizeOptions?: AutosizeOptions): void;
}
```

- [ ] **Step 2: Write the failing test for declarative autosize**

Add to `packages/grid-core/src/__tests__/grid-core.test.ts`:

```typescript
test("declarative autosize computes widthPx for columns without explicit widths", () => {
  const grid = createGridCore({
    columns: [
      { id: "short", header: "ID" },
      { id: "long", header: "Description" },
      { id: "fixed", header: "Fixed", widthPx: 200 },
    ],
    rows: [
      { id: "1", short: "A", long: "A much longer text value that should produce a wider column", fixed: "x" },
      { id: "2", short: "B", long: "Short", fixed: "y" },
    ],
    getRowId: (row) => String(row.id),
    autosize: true,
  });

  const snapshot = grid.getSnapshot();
  const shortCol = grid.options.columns.find((c) => c.id === "short")!;
  const longCol = grid.options.columns.find((c) => c.id === "long")!;
  const fixedCol = grid.options.columns.find((c) => c.id === "fixed")!;

  // Short column should have a computed width
  expect(shortCol.widthPx).toBeDefined();
  expect(shortCol.widthPx).toBeGreaterThanOrEqual(60);
  expect(shortCol.widthPx).toBeLessThanOrEqual(400);

  // Long column should be wider than short column
  expect(longCol.widthPx).toBeDefined();
  expect(longCol.widthPx!).toBeGreaterThan(shortCol.widthPx!);

  // Fixed column keeps its explicit width
  expect(fixedCol.widthPx).toBe(200);

  // Snapshot should still be valid
  expect(snapshot.totalRowCount).toBe(2);
});

test("declarative autosize accepts custom options", () => {
  const grid = createGridCore({
    columns: [
      { id: "name", header: "Name" },
    ],
    rows: [
      { id: "1", name: "A very long name that would exceed a low max width" },
    ],
    getRowId: (row) => String(row.id),
    autosize: { maxWidthPx: 100 },
  });

  const nameCol = grid.options.columns.find((c) => c.id === "name")!;

  expect(nameCol.widthPx).toBeDefined();
  expect(nameCol.widthPx!).toBeLessThanOrEqual(100);
});

test("imperative autosizeColumns recomputes widths and notifies subscribers", () => {
  const grid = createGridCore({
    columns: [
      { id: "name", header: "Name" },
    ],
    rows: [
      { id: "1", name: "Short" },
    ],
    getRowId: (row) => String(row.id),
  });

  let notifications = 0;
  grid.subscribe(() => {
    notifications += 1;
  });

  grid.autosizeColumns();

  expect(notifications).toBe(1);

  const nameCol = grid.options.columns.find((c) => c.id === "name")!;

  expect(nameCol.widthPx).toBeDefined();
  expect(nameCol.widthPx).toBeGreaterThanOrEqual(60);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @pretable-internal/grid-core test -- --run`
Expected: FAIL — `autosize` not recognized on options, `autosizeColumns` method doesn't exist

- [ ] **Step 4: Implement autosize integration in create-grid-core.ts**

In `packages/grid-core/src/create-grid-core.ts`, add the import:

```typescript
import { autosizeColumns } from "@pretable-internal/layout-core";
import type { AutosizeOptions } from "@pretable-internal/layout-core";
```

Add a helper function before the `createGridCore` function:

```typescript
function applyAutosize<TRow extends GridCoreRow>(
  options: GridCoreOptions<TRow>,
  autosizeOptions?: AutosizeOptions,
): GridCoreOptions<TRow> {
  const result = autosizeColumns({
    columns: options.columns,
    rows: options.rows,
    options: autosizeOptions,
  });

  if (result.widths.size === 0) {
    return options;
  }

  const nextColumns = options.columns.map((column) => {
    const computedWidth = result.widths.get(column.id);

    if (computedWidth === undefined) {
      return column;
    }

    return { ...column, widthPx: computedWidth };
  });

  return { ...options, columns: nextColumns };
}
```

In the `createGridCore` function body, right after the `options` parameter, apply autosize before using the options:

Replace the start of the function:

```typescript
export function createGridCore<TRow extends GridCoreRow>(
  inputOptions: GridCoreOptions<TRow>,
): GridCoreStore<TRow> {
  const listeners = new Set<() => void>();
  let options = inputOptions.autosize
    ? applyAutosize(
        inputOptions,
        typeof inputOptions.autosize === "object"
          ? inputOptions.autosize
          : undefined,
      )
    : inputOptions;
  const sourceRows = createSourceRows(options);
```

Change `options` from `const` throughout the file — replace `options` references in the return object. Since `options` was previously a parameter, we need to make sure it's declared with `let` (done above).

Add the `autosizeColumns` method to the returned store object (inside the `return { ... }` block):

```typescript
autosizeColumns(autosizeOptions?: AutosizeOptions) {
  const nextOptions = applyAutosize(options, autosizeOptions);

  if (nextOptions === options) {
    return;
  }

  options = nextOptions;
  emit();
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @pretable-internal/grid-core test -- --run`
Expected: PASS — all existing tests still pass, new autosize tests pass

- [ ] **Step 6: Run workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/grid-core/src/types.ts packages/grid-core/src/create-grid-core.ts packages/grid-core/src/__tests__/grid-core.test.ts
git commit -m "feat(grid-core): add declarative and imperative autosize support

GridCoreOptions gains autosize?: boolean | AutosizeOptions.
GridCoreStore gains autosizeColumns() imperative method.
Autosize runs on store creation when enabled, applying computed
widths as new column objects (no mutation of originals)."
```

---

### Task 3: Public API surface — core package re-exports

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/create-grid.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/grid-core/src/index.ts`

- [ ] **Step 1: Export `AutosizeOptions` from grid-core index**

In `packages/grid-core/src/index.ts`, add the re-export:

```typescript
export type {
  AutosizeOptions,
  // ...existing type exports...
} from "@pretable-internal/layout-core";
```

Wait — grid-core's types.ts imports `AutosizeOptions` from layout-core. The cleanest approach is to re-export from grid-core's index so core can pick it up. Actually, `AutosizeOptions` is already defined in layout-core's types. grid-core re-exports it.

In `packages/grid-core/src/index.ts`, the current file exports types from `./types`. Add `AutosizeOptions` to the re-exports from layout-core:

Replace the file:

```typescript
export { createGridCore } from "./create-grid-core";
export type {
  GridCoreColumn,
  GridCoreFocusState,
  GridCoreFrame,
  GridCoreOptions,
  GridCoreRow,
  GridCoreRowModel,
  GridCoreSelectionState,
  GridCoreSnapshot,
  GridCoreSortDirection,
  GridCoreSortState,
  GridCoreStore,
  GridCoreViewportState,
} from "./types";
export type { AutosizeOptions } from "@pretable-internal/layout-core";
```

- [ ] **Step 2: Wire `autosizeColumns` through the public `PretableGrid` interface**

In `packages/core/src/types.ts`, add the import and update the interface:

```typescript
import type {
  GridCoreColumn,
  GridCoreOptions,
  GridCoreSnapshot,
  GridCoreSortDirection,
  GridCoreStore,
  AutosizeOptions,
} from "@pretable-internal/grid-core";
```

Update `PretableGrid` to include `autosizeColumns`:

```typescript
export interface PretableGrid<
  TRow extends PretableRow = PretableRow,
> extends Omit<GridCoreStore<TRow>, "options"> {
  kind: "pretable-grid";
  options: PretableGridOptions<TRow>;
  getSnapshot(): GridCoreSnapshot<TRow>;
  setSort(columnId: string | null, direction: GridCoreSortDirection): void;
  autosizeColumns(options?: AutosizeOptions): void;
}
```

- [ ] **Step 3: Wire `autosizeColumns` in create-grid.ts**

In `packages/core/src/create-grid.ts`, add the method:

```typescript
export function createGrid<TRow extends Record<string, unknown>>(
  options: PretableGridOptions<TRow>,
): PretableGrid<TRow> {
  const gridCore = createGridCore(options);

  return {
    kind: "pretable-grid",
    options,
    subscribe: gridCore.subscribe,
    getSnapshot: gridCore.getSnapshot,
    setSort: gridCore.setSort,
    setFilter: gridCore.setFilter,
    clearFilters: gridCore.clearFilters,
    replaceFilters: gridCore.replaceFilters,
    selectRow: gridCore.selectRow,
    setFocus: gridCore.setFocus,
    moveFocus: gridCore.moveFocus,
    setViewport: gridCore.setViewport,
    autosizeColumns: gridCore.autosizeColumns,
  };
}
```

- [ ] **Step 4: Export `AutosizeOptions` from core index**

In `packages/core/src/index.ts`, add:

```typescript
export type { AutosizeOptions } from "@pretable-internal/grid-core";
```

- [ ] **Step 5: Run workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Run all tests**

Run: `pnpm test`
Expected: PASS — no regressions

- [ ] **Step 7: Commit**

```bash
git add packages/grid-core/src/index.ts packages/core/src/types.ts packages/core/src/create-grid.ts packages/core/src/index.ts
git commit -m "feat(core): expose autosize on public PretableGrid API

AutosizeOptions type and autosizeColumns() method are now
available through @pretable/core."
```

---

### Task 4: Scenario-data — make S4 columns omit `widthPx` for autosize

**Files:**
- Modify: `packages/scenario-data/src/index.ts:43-49,261-269`

- [ ] **Step 1: Make `widthPx` optional on `ScenarioColumn`**

In `packages/scenario-data/src/index.ts`, change the `ScenarioColumn` interface (line 43-49):

```typescript
export interface ScenarioColumn {
  id: string;
  header: string;
  wrap: boolean;
  widthPx?: number;
  pinned?: "left";
}
```

Note: `widthPx` changes from required to optional. This is a non-breaking change for existing consumers that read the field (they already need to handle `undefined` when used with `GridCoreColumn`).

- [ ] **Step 2: Update `buildColumns` to omit `widthPx` for autosize scenarios**

In `packages/scenario-data/src/index.ts`, update the `buildColumns` function (line 261-269):

```typescript
function buildColumns(scenario: ScenarioDefinition): readonly ScenarioColumn[] {
  return Array.from({ length: scenario.cols }, (_, index) => {
    const column: ScenarioColumn = {
      id: `col_${index}`,
      header: createColumnHeader(index),
      wrap: index < scenario.wrapped_columns,
      pinned: index < scenario.pinned_left ? "left" : undefined,
    };

    if (!scenario.autosize_all_columns) {
      column.widthPx =
        index < scenario.wrapped_columns ? 220 : index % 4 === 3 ? 96 : 140;
    }

    return column;
  });
}
```

- [ ] **Step 3: Run workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS — any consumers that read `widthPx` should already handle `undefined` since `GridCoreColumn.widthPx` has always been optional

- [ ] **Step 4: Run all tests**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/scenario-data/src/index.ts
git commit -m "feat(scenario-data): omit widthPx for autosize scenarios

S4 columns no longer set widthPx, allowing autosize to compute
widths from content. Other scenarios keep explicit widths."
```

---

### Task 5: Bench adapter — enable autosize for S4 datasets

**Files:**
- Modify: `apps/bench/src/pretable-adapter.tsx`
- Modify: `packages/react/src/internal/pretable-surface.tsx`
- Modify: `packages/react/src/use-pretable.ts`

- [ ] **Step 1: Add `autosize` prop to `PretableSurface`**

In `packages/react/src/internal/pretable-surface.tsx`, add to `PretableSurfaceProps`:

```typescript
export interface PretableSurfaceProps<TRow extends PretableRow = PretableRow> {
  // ...existing props...
  autosize?: boolean | import("@pretable/core").AutosizeOptions;
}
```

Actually, to avoid inline import, import `AutosizeOptions` at the top of the file:

```typescript
import type {
  AutosizeOptions,
  PretableColumn,
  PretableGridOptions,
  PretableRow,
} from "@pretable/core";
```

Then update the prop:

```typescript
autosize?: boolean | AutosizeOptions;
```

Destructure it in the component function signature and pass it through to `usePretableModel`:

In the destructuring, add `autosize`:

```typescript
export function PretableSurface<TRow extends PretableRow = PretableRow>({
  ariaLabel,
  autosize,
  columns,
  // ...rest of props
```

In the `usePretableModel` call, add `autosize`:

```typescript
const { grid, snapshot, renderSnapshot, telemetry } = usePretableModel({
  autosize,
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

- [ ] **Step 2: Add `autosize` to `UsePretableModelOptions` and `usePretable`**

In `packages/react/src/use-pretable.ts`, add the import:

```typescript
import {
  type AutosizeOptions,
  createGrid,
  // ...existing imports
} from "@pretable/core";
```

Add `autosize` to `UsePretableOptions`:

```typescript
export interface UsePretableOptions<TRow extends PretableRow = PretableRow> {
  autosize?: boolean | AutosizeOptions;
  columns: PretableColumn<TRow>[];
  rows: TRow[];
  getRowId?: PretableGridOptions<TRow>["getRowId"];
}
```

Add `autosize` to `UsePretableModelOptions` (it extends `UsePretableOptions` so it inherits).

Pass `autosize` through in `usePretable`:

```typescript
export function usePretable<TRow extends PretableRow = PretableRow>({
  autosize,
  columns,
  rows,
  getRowId,
}: UsePretableOptions<TRow>) {
  return useMemo(
    () => createGrid({ columns, rows, getRowId, autosize }),
    [autosize, columns, getRowId, rows],
  );
}
```

- [ ] **Step 3: Pass `autosize` in PretableAdapter for S4**

In `apps/bench/src/pretable-adapter.tsx`, add autosize detection:

```typescript
export function PretableAdapter({
  dataset,
  interactionPlan,
  onTelemetryChange,
  runKey,
}: PretableAdapterProps) {
  const adapterRef = useRef<HTMLElement>(null);
  const surfaceColumns = useMemo(() => [...dataset.columns], [dataset.columns]);
  const surfaceRows = useMemo(() => [...dataset.rows], [dataset.rows]);
  const autosize = dataset.scenario.autosize_all_columns === true;
```

Then pass it to `PretableSurface`:

```typescript
<PretableSurface
  ariaLabel="Pretable React adapter"
  autosize={autosize}
  columns={surfaceColumns}
  // ...rest of props
```

- [ ] **Step 4: Run workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `pnpm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/internal/pretable-surface.tsx packages/react/src/use-pretable.ts apps/bench/src/pretable-adapter.tsx
git commit -m "feat(react): wire autosize through PretableSurface and bench adapter

PretableSurface accepts autosize prop, passes through usePretableModel
to createGrid. Bench adapter enables autosize for S4 datasets."
```

---

### Task 6: Playground — enable autosize for S4 scenario

**Files:**
- Explore: `apps/playground/src/**/*` to find where the scenario/dataset is configured
- Modify: the playground component that creates the grid, passing `autosize` when the active scenario has `autosize_all_columns`

- [ ] **Step 1: Find the playground entry point**

Read the playground source to identify where `PretableSurface` is used and where the dataset is constructed.

- [ ] **Step 2: Enable autosize for autosize scenarios**

Following the same pattern as the bench adapter: check `dataset.scenario.autosize_all_columns` and pass `autosize={true}` to `PretableSurface`.

- [ ] **Step 3: Run workspace typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Start playground and verify S4 visually**

Run: `pnpm dev:playground`

Verify:
- Switch to S4 scenario
- Columns should have varying widths (not all 140px)
- Narrow-data columns (scores, statuses) should be visibly narrower
- Wide-data columns should cap at ~400px
- Scrolling should work smoothly with column virtualization

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/
git commit -m "feat(playground): enable autosize for S4 scenario

Playground passes autosize: true to PretableSurface when the
active scenario has autosize_all_columns enabled."
```

---

### Task 7: Verification and benchmark proof

**Files:**
- No new files — this task runs benchmarks and verifies the implementation

- [ ] **Step 1: Run full workspace verification**

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

Run these sequentially. All must pass.

- [ ] **Step 2: Run S4 scroll benchmark**

```bash
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S4 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=scroll pnpm bench:e2e -- --project=chromium
```

Verify:
- Benchmark completes without errors
- Scroll quality metrics in the summary show reasonable behavior
- Column widths in the rendered grid vary (not uniform)

- [ ] **Step 3: Run S2 scroll regression check**

```bash
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=scroll pnpm bench:e2e -- --project=chromium
```

Verify: S2 scroll quality is unchanged — autosize changes should not affect S2 (which has explicit widths).

- [ ] **Step 4: Run S3 scroll regression check**

```bash
PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S3 PRETABLE_BENCH_SCALE=dev PRETABLE_BENCH_SCRIPT=scroll pnpm bench:e2e -- --project=chromium
```

Verify: S3 column virtualization scroll quality is unchanged.

- [ ] **Step 5: Run interaction regression check**

```bash
pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --repeats=3
```

Verify: H6, H7, H8 still satisfied.

- [ ] **Step 6: Format check**

```bash
pnpm format --check
```

If formatting issues: run `pnpm format --write`, then commit.

- [ ] **Step 7: Commit any fixes**

If Step 6 required formatting:

```bash
git add -A
git commit -m "style: format autosize implementation"
```
