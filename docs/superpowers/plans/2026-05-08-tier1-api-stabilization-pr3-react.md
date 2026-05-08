# Tier 1 Sub-project A — PR 3 (`@pretable/react` audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Audit `@pretable/react`'s public surface — rename `usePretableModel` → `usePretable` (deleting the old low-level `usePretable`), demote three internal-leakage exports to `ɵ`-prefix, tag two experimental components `@beta`, fix one forgotten-export leak, retire one alias, write `public_api.ts` + TSDoc + per-package README.

**Architecture:** Mechanical rename ripple through hook source + one component file + 2 react tests + 8 website docs. Then add TSDoc + release tags on declarations across ~10 source files. Move public re-exports to a curated `public_api.ts`; collapse `index.ts` to one line. Regenerate `react.api.md` and audit the diff.

**Tech Stack:** TypeScript, React 18+, `@microsoft/api-extractor`, `@microsoft/tsdoc`, pnpm workspaces, vitest, fumadocs (the website's MDX).

**Source spec:** `docs/superpowers/specs/2026-05-08-tier1-api-stabilization-pr3-react-design.md`

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `packages/react/src/use-pretable.ts` | Hook(s) | Rewrite (delete old `usePretable`, rename `usePretableModel` → `usePretable`, rename options type) |
| `packages/react/src/pretable-surface.tsx` | Surface component | Modify (`usePretableModel` import + call site) + add TSDoc on `PretableSurface`, `PretableSurfaceProps`, `PretableSurfaceMessages`, `RowSelectionColumnConfig` |
| `packages/react/src/pretable.tsx` | Drop-in component | Modify (TSDoc on `Pretable`, `PretableProps`) |
| `packages/react/src/inspection-grid.tsx` | Inspection surface | Modify (`@beta` TSDoc on `InspectionGrid` + `InspectionGridProps`) |
| `packages/react/src/labeled-grid-surface.tsx` | Labeled surface | Modify (`@beta` TSDoc on `LabeledGridSurface`, `LabeledGridSurfaceProps`, `LabeledGridSurfaceFormatValueInput`); replace local `PretableSurfaceSortDirection` alias with `PretableSortDirection` import from core |
| `packages/react/src/types.ts` | React-extended column types | Modify (TSDoc on `PretableColumn`, `PretableCellRenderInput`, `PretableHeaderRenderInput`, re-export `PretableFormatInput` already there) |
| `packages/react/src/density.ts` | Density hook | Modify (`@internal` on `useResolvedHeights`; TSDoc on `DensityHeights`) |
| `packages/react/src/row-height.ts` | Measurement helper | Modify (`@internal` on `measureRenderedRowHeight`) |
| `packages/react/src/copy.ts` | Clipboard helpers | Modify (TSDoc on `defaultCoerceForCopy`, `serializeRangesAsTsv`, `CopyPayload`, `SerializeRangesArgs`) |
| `packages/react/src/constants.ts` | Constants | Modify (`@internal` on `ROW_SELECT_COLUMN_ID`) |
| `packages/react/src/public_api.ts` | **NEW** curated public re-exports | Create |
| `packages/react/src/index.ts` | Package entry | Collapse to `export * from './public_api';` |
| `packages/react/src/__tests__/pretable-surface.test.tsx` | Tests | Modify (rename `usePretableModel` → `usePretable`) |
| `packages/react/src/__tests__/pretable.test.tsx` | Tests | Modify (rename `usePretableModel` → `usePretable`) |
| `apps/website/content/docs/grid/*.mdx` (8 files) | Docs | Modify (rename hook + options type references) |
| `packages/react/react.api.md` | Generated baseline | Regenerate |
| `packages/react/README.md` | **NEW** per-package README | Create |

---

## Task 1: Hook rename — delete old `usePretable`, rename `usePretableModel` → `usePretable`

**Files:**
- Modify: `packages/react/src/use-pretable.ts`
- Modify: `packages/react/src/pretable-surface.tsx`
- Modify: `packages/react/src/__tests__/pretable-surface.test.tsx`
- Modify: `packages/react/src/__tests__/pretable.test.tsx`
- Modify: 8 website doc files under `apps/website/content/docs/grid/`

- [ ] **Step 1: Rewrite `packages/react/src/use-pretable.ts`**

The hook source has both old `usePretable` (returns `PretableGrid`) and `usePretableModel` (returns `PretableModel`). Delete the old one, rename the rich one, rename the options type. The body of the new `usePretable` is exactly today's `usePretableModel` body but with the inner `usePretable({...})` call replaced by an inlined `useMemo(() => createGrid(...))`.

Replace ALL contents with:

```ts
import {
  type AutosizeOptions,
  createGrid,
  type PretableFocusState,
  type PretableGrid,
  type PretableGridOptions,
  type PretableGridSnapshot,
  type PretableRow,
  type PretableSelectionState,
  type PretableSortState,
} from "@pretable/core";
import type { PretableColumn } from "./types";
import {
  createDomRenderSnapshot,
  type PlannedColumn,
} from "@pretable-internal/renderer-dom";
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from "react";

/**
 * One row of layout-derived render state for use during custom rendering.
 *
 * @public
 */
export interface PretableRenderRow<TRow extends PretableRow = PretableRow> {
  id: string;
  row: TRow;
  rowIndex: number;
  top: number;
  height: number;
}

/**
 * Layout-derived render snapshot returned by {@link usePretable}. Drives
 * positioned-cell rendering — every column has a left + width, every visible
 * row has a top + height.
 *
 * @public
 */
export interface PretableRenderSnapshot<
  TRow extends PretableRow = PretableRow,
> {
  columns: PlannedColumn[];
  rows: PretableRenderRow<TRow>[];
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
}

/**
 * Telemetry numbers about the current render — counts and ranges suitable
 * for status bars, dev panels, or virtualization debugging.
 *
 * @public
 */
export interface PretableTelemetry {
  focusedRowId: string | null;
  rowModelRowCount: number;
  renderedRowCount: number;
  selectedRowId: string | null;
  totalRowCount: number;
  totalHeight: number;
  visibleRowCount: number;
  visibleRowRange: {
    end: number;
    start: number;
  };
}

/**
 * **Input** shape for controlling a {@link PretableSurface} from the outside.
 * Pass the slices you want to control; omit slices you want the grid to own.
 *
 * @public
 */
export interface PretableSurfaceState {
  filters?: Record<string, string>;
  focus?: PretableFocusState;
  selection?: PretableSelectionState;
  sort?: PretableSortState | null;
  columnWidths?: Record<string, number>;
  columnOrder?: readonly string[];
  columnPinned?: Record<string, "left" | null>;
}

/**
 * Options for the {@link usePretable} hook.
 *
 * @public
 */
export interface UsePretableOptions<TRow extends PretableRow = PretableRow> {
  autosize?: boolean | AutosizeOptions;
  columns: PretableColumn<TRow>[];
  rows: TRow[];
  getRowId?: PretableGridOptions<TRow>["getRowId"];
  viewportHeight: number;
  viewportWidth?: number;
  overscan?: number;
  state?: PretableSurfaceState | null;
  measuredHeights?: Record<string, number>;
  onSelectionChange?: (next: PretableSelectionState) => void;
  onFocusChange?: (next: PretableFocusState) => void;
}

/**
 * Output of the {@link usePretable} hook — a stable handle plus the latest
 * snapshot, render layout, and telemetry.
 *
 * @public
 */
export interface PretableModel<TRow extends PretableRow = PretableRow> {
  grid: PretableGrid<TRow>;
  snapshot: PretableGridSnapshot<TRow>;
  renderSnapshot: PretableRenderSnapshot<TRow>;
  telemetry: PretableTelemetry;
}

/**
 * The primary React hook. Creates a grid, applies optional controlled state,
 * and returns the latest snapshot, layout-derived render snapshot, and
 * telemetry. Suitable for custom rendering — `<PretableSurface>` itself is
 * built on top of this hook.
 *
 * @example
 * ```tsx
 * const { grid, snapshot, renderSnapshot, telemetry } = usePretable({
 *   columns,
 *   rows,
 *   viewportHeight: 480,
 * });
 * ```
 *
 * @public
 */
export function usePretable<TRow extends PretableRow = PretableRow>({
  autosize,
  columns,
  rows,
  getRowId,
  viewportHeight,
  viewportWidth,
  overscan = 6,
  state,
  measuredHeights,
  onSelectionChange,
  onFocusChange,
}: UsePretableOptions<TRow>): PretableModel<TRow> {
  const grid = useMemo(
    () => createGrid({ columns, rows, getRowId, autosize }),
    [autosize, columns, getRowId, rows],
  );

  const lastColumnIdsRef = useRef<readonly string[] | null>(null);
  useLayoutEffect(() => {
    const currentIds = columns.map((c) => c.id);
    const prevIds = lastColumnIdsRef.current;
    if (
      prevIds === null ||
      prevIds.length !== currentIds.length ||
      prevIds.some((id, i) => id !== currentIds[i])
    ) {
      if (prevIds !== null) {
        grid.mergeColumnsFromProps(columns);
      }
      lastColumnIdsRef.current = currentIds;
    }
  }, [columns, grid]);

  // onSelectionChange / onFocusChange callbacks are wired in the surface's
  // event handlers (keyboard, click) directly. This keeps callbacks firing
  // for user-induced changes even when the corresponding slice is controlled
  // — diff-detection here would race the controlled-prop reapply below.
  void onSelectionChange;
  void onFocusChange;

  if (state) {
    if (state.sort !== undefined) {
      grid.setSort(state.sort?.columnId ?? null, state.sort?.direction ?? null);
    }

    if (state.filters !== undefined) {
      grid.replaceFilters(state.filters);
    }

    if (state.columnWidths !== undefined) {
      const widths = state.columnWidths;
      for (const column of grid.options.columns) {
        const next = widths[column.id];
        if (next !== undefined && next !== column.widthPx) {
          grid.setColumnWidth(column.id, next);
        }
      }
    }

    if (state.columnOrder !== undefined) {
      const targetOrder = state.columnOrder;
      const currentIds = grid.options.columns.map((c) => c.id);
      const targetIds = [
        ...targetOrder.filter((id) => currentIds.includes(id)),
        ...currentIds.filter((id) => !targetOrder.includes(id)),
      ];
      for (let i = 0; i < targetIds.length; i += 1) {
        const id = targetIds[i]!;
        const currentIdx = grid.options.columns.findIndex((c) => c.id === id);
        if (currentIdx !== i && id !== "__pretable_row_select__") {
          grid.moveColumn(id, i);
        }
      }
    }

    if (state.columnPinned !== undefined) {
      const pinned = state.columnPinned;
      for (const [id, value] of Object.entries(pinned)) {
        const column = grid.options.columns.find((c) => c.id === id);
        if (!column) continue;
        const targetPinned = value === "left" ? "left" : null;
        const currentPinned = column.pinned ?? null;
        if (currentPinned !== targetPinned) {
          grid.setColumnPinned(id, targetPinned);
        }
      }
    }

    if (state.selection !== undefined) {
      grid.setSelection(state.selection);
    }

    if (state.focus !== undefined) {
      const focus = state.focus;

      if (focus.rowId !== null && focus.columnId !== null) {
        grid.setFocus({ rowId: focus.rowId, columnId: focus.columnId });
      } else {
        grid.setFocus(null);
      }
    }
  }

  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot,
  );

  useLayoutEffect(() => {
    if (
      snapshot.viewport.height === viewportHeight &&
      snapshot.viewport.width === (viewportWidth ?? 0)
    ) {
      return;
    }

    grid.setViewport({
      scrollTop: snapshot.viewport.scrollTop,
      scrollLeft: snapshot.viewport.scrollLeft,
      height: viewportHeight,
      width: viewportWidth ?? 0,
    });
  }, [
    grid,
    snapshot.viewport.height,
    snapshot.viewport.width,
    snapshot.viewport.scrollTop,
    snapshot.viewport.scrollLeft,
    viewportHeight,
    viewportWidth,
  ]);

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
  const telemetry = useMemo<PretableTelemetry>(() => {
    const viewportBottom =
      snapshot.viewport.scrollTop +
      Math.max(snapshot.viewport.height, viewportHeight);
    const viewportRows = renderSnapshot.rows.filter((row) => {
      const rowBottom = row.top + row.height;

      return (
        row.top < viewportBottom && rowBottom > snapshot.viewport.scrollTop
      );
    });
    const firstVisibleRow = viewportRows[0];
    const lastVisibleRow = viewportRows[viewportRows.length - 1];

    return {
      focusedRowId: snapshot.focus.rowId,
      rowModelRowCount: snapshot.visibleRows.length,
      renderedRowCount: renderSnapshot.rows.length,
      selectedRowId: snapshot.selection.ranges[0]?.startRowId ?? null,
      totalRowCount: snapshot.totalRowCount,
      totalHeight: renderSnapshot.totalHeight,
      visibleRowCount: viewportRows.length,
      visibleRowRange:
        firstVisibleRow && lastVisibleRow
          ? {
              start: firstVisibleRow.rowIndex,
              end: lastVisibleRow.rowIndex + 1,
            }
          : {
              start: 0,
              end: 0,
            },
    };
  }, [
    renderSnapshot.rows,
    renderSnapshot.totalHeight,
    snapshot.focus.rowId,
    snapshot.visibleRows.length,
    snapshot.selection.ranges,
    snapshot.totalRowCount,
    snapshot.viewport.height,
    snapshot.viewport.scrollTop,
    viewportHeight,
  ]);

  return {
    grid,
    snapshot,
    renderSnapshot,
    telemetry,
  };
}
```

- [ ] **Step 2: Update `packages/react/src/pretable-surface.tsx`**

Find the import (around line 38):
```ts
  usePretableModel,
```
Rename to `usePretable`.

Find the call site (around line 510):
```ts
  const { grid, snapshot, renderSnapshot, telemetry } = usePretableModel({
```
Rename to `usePretable`.

- [ ] **Step 3: Update test files**

In `packages/react/src/__tests__/pretable-surface.test.tsx`, change every occurrence of `usePretableModel` to `usePretable`. Specifically:
- The import on line 21: `import { type PretableSurfaceState, usePretableModel } from "../use-pretable";` → `import { type PretableSurfaceState, usePretable } from "../use-pretable";`
- The describe-block label on line 84 (`"exposes renderer telemetry from usePretableModel..."`) → `"exposes renderer telemetry from usePretable..."`
- The call on line 86: `const model = usePretableModel({` → `const model = usePretable({`

In `packages/react/src/__tests__/pretable.test.tsx`, change every occurrence of `usePretableModel` to `usePretable`. The import on line 6 and two call sites at lines 293, 346.

- [ ] **Step 4: Update website docs**

Apply this rename across the 8 doc files. From the worktree root:

```bash
files=(
  apps/website/content/docs/grid/keyboard.mdx
  apps/website/content/docs/grid/selection.mdx
  apps/website/content/docs/grid/density-helpers.mdx
  apps/website/content/docs/grid/pretable-surface.mdx
  apps/website/content/docs/grid/custom-rendering.mdx
  apps/website/content/docs/grid/index.mdx
  apps/website/content/docs/grid/pretable-component.mdx
  apps/website/content/docs/grid/api-reference.mdx
)
for f in "${files[@]}"; do
  sed -i '' \
    -e 's/UsePretableModelOptions/UsePretableOptions/g' \
    -e 's/usePretableModel/usePretable/g' \
    "$f"
done
```

Then specifically `apps/website/content/docs/grid/index.mdx` line 32 has a Markdown heading that mentions both names: `### Path 2: \`usePretable\` / \`usePretableModel\` hooks (custom rendering)`. The sed run above turns it into `### Path 2: \`usePretable\` / \`usePretable\` hooks (custom rendering)` — duplicate. Open the file and reduce that heading to `### Path 2: \`usePretable\` hook (custom rendering)`.

Similarly line 90 reads "the `autosize` option on `usePretable` and `usePretableModel`" — after sed it becomes "the `autosize` option on `usePretable` and `usePretable`". Open and reduce to "the `autosize` option on `usePretable`".

Search for any other `usePretable.*usePretable` duplications in those 8 files with `grep -n "usePretable.*usePretable" apps/website/content/docs/grid/*.mdx` and clean each one — usually deleting the second mention.

- [ ] **Step 5: Verify typecheck + tests**

```bash
pnpm --filter @pretable/react typecheck && \
pnpm --filter @pretable/react test && \
pnpm --filter @pretable/app-website typecheck
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/use-pretable.ts \
        packages/react/src/pretable-surface.tsx \
        packages/react/src/__tests__/pretable-surface.test.tsx \
        packages/react/src/__tests__/pretable.test.tsx \
        apps/website/content/docs/grid
git commit -m "refactor(react): rename usePretableModel → usePretable; delete low-level usePretable

The simple-sounding name now points to the hook docs already use.
Old usePretable (returning just PretableGrid) was a one-line useMemo
wrapper around createGrid; deleted. UsePretableModelOptions is now
UsePretableOptions; the strict-subset old UsePretableOptions deleted.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Fix `PretableSurfaceSortDirection` forgotten-export leak

**Files:**
- Modify: `packages/react/src/labeled-grid-surface.tsx`

- [ ] **Step 1: Read the file's imports**

`packages/react/src/labeled-grid-surface.tsx` line 1 region currently imports from `@pretable/core`. Add `PretableSortDirection` to that import:

```ts
import type {
  PretableGridOptions,
  PretableRow,
  PretableSortDirection,
} from "@pretable/core";
```

(Adjust based on what's currently imported — preserve existing imports, add `PretableSortDirection` to the type-import list. If `@pretable/core` isn't already imported as `import type`, add a new line.)

- [ ] **Step 2: Replace the `sortDirection` field type**

Find line 28 (in interface `LabeledGridSurfaceFormatValueInput`):

```ts
  sortDirection: PretableSurfaceSortDirection;
```

Change to:

```ts
  sortDirection: PretableSortDirection;
```

- [ ] **Step 3: Delete the local alias**

Find lines 217 region:

```ts
type PretableSurfaceSortDirection = NonNullable<
  Parameters<NonNullable<PretableSurfaceProps["renderHeaderCell"]>>[0]["sortDirection"]
> | null;
```

Delete this declaration entirely.

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @pretable/react typecheck
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/labeled-grid-surface.tsx
git commit -m "refactor(react): replace local PretableSurfaceSortDirection with PretableSortDirection from core

Eliminates the ae-forgotten-export warning on react.api.md. The local
alias was just a more verbose way of saying 'asc | desc | null'.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Add TSDoc + release tags on declarations

**Files:**
- Modify: `packages/react/src/pretable.tsx`
- Modify: `packages/react/src/pretable-surface.tsx`
- Modify: `packages/react/src/inspection-grid.tsx`
- Modify: `packages/react/src/labeled-grid-surface.tsx`
- Modify: `packages/react/src/types.ts`
- Modify: `packages/react/src/density.ts`
- Modify: `packages/react/src/row-height.ts`
- Modify: `packages/react/src/copy.ts`
- Modify: `packages/react/src/constants.ts`

For each declaration listed below, prepend the indicated TSDoc comment block immediately above the declaration. Block format:

```ts
/**
 * <summary>
 *
 * @public  // or @beta or @internal
 */
export <kind> <name> ...
```

### `packages/react/src/pretable.tsx`

| Declaration | Summary | Tag |
|---|---|---|
| `export interface PretableProps<…>` | "Props for the {@link Pretable} drop-in component." | `@public` |
| `export function Pretable<…>` | "Drop-in pretable component. Wraps {@link PretableSurface} with internal state — pass `columns` and `rows` and you're done. Reach for `PretableSurface` when you need to control state from the outside." | `@public` |

### `packages/react/src/pretable-surface.tsx`

| Declaration | Summary | Tag |
|---|---|---|
| `export interface PretableSurfaceProps<…>` | "Props for {@link PretableSurface}." | `@public` |
| `export interface PretableSurfaceMessages` | "Localizable user-facing strings rendered by {@link PretableSurface}. Pass to override the English defaults." | `@public` |
| `export interface RowSelectionColumnConfig` | "Configuration for the synthetic row-select column rendered by {@link PretableSurface} when `rowSelectionColumn` is enabled." | `@public` |
| `export const ROW_SELECT_COLUMN_ID` | "Reserved column id for the synthetic row-select checkbox column. Internal use; surface authors shouldn't reference this directly." | `@internal` |
| `export function PretableSurface<…>` | "Controlled grid surface. The primary React component. Pass `state` to control any subset of sort/filter/selection/focus/column-layout from the outside; omit slices you want the grid to own." | `@public` |

### `packages/react/src/inspection-grid.tsx`

| Declaration | Summary | Tag |
|---|---|---|
| `export interface InspectionGridProps` | "Props for {@link InspectionGrid}." | `@beta` |
| `export function InspectionGrid` | "Special-purpose inspection surface that renders rows as labeled key/value pairs. Experimental — shape may change before 1.0." | `@beta` |

### `packages/react/src/labeled-grid-surface.tsx`

| Declaration | Summary | Tag |
|---|---|---|
| `export interface LabeledGridSurfaceFormatValueInput<…>` | "Input passed to a {@link LabeledGridSurface} format function." | `@beta` |
| `export interface LabeledGridSurfaceProps<…>` | "Props for {@link LabeledGridSurface}." | `@beta` |
| `export function LabeledGridSurface<…>` | "Special-purpose surface for label/value-style table layouts. Experimental — shape may change before 1.0." | `@beta` |

### `packages/react/src/types.ts`

| Declaration | Summary | Tag |
|---|---|---|
| `export interface PretableColumn<…>` | "React-extended column definition. Adds the `render` and `renderHeader` JSX-typed callbacks on top of `@pretable/core`'s base column." | `@public` |
| `export interface PretableCellRenderInput<…>` | "Input passed to a column's `render` function." | `@public` |
| `export interface PretableHeaderRenderInput<…>` | "Input passed to a column's `renderHeader` function." | `@public` |

The existing `export type { PretableFormatInput };` at the bottom is a re-export from core — its `@public` tag lives in core.

### `packages/react/src/density.ts`

| Declaration | Summary | Tag |
|---|---|---|
| `export interface DensityHeights` | "CSS-token-derived heights used by `<Pretable>` / `<PretableSurface>` to size header and rows. PR 4 may consolidate the source of truth between this package and `@pretable/ui`." | `@public` |
| `export function useResolvedHeights(…)` | "React hook returning the current density heights derived from the active CSS theme. Internal — `<Pretable>` and `<PretableSurface>` use this; external consumers should reach for `getDensityHeights` from `@pretable/ui` when PR 4 lands." | `@internal` |

### `packages/react/src/row-height.ts`

| Declaration | Summary | Tag |
|---|---|---|
| `export function measureRenderedRowHeight(…)` | "DOM measurement helper used internally by the surface's row-height accounting. Not part of the user-facing API." | `@internal` |

### `packages/react/src/copy.ts`

| Declaration | Summary | Tag |
|---|---|---|
| `export interface CopyPayload` | "Plain-text + HTML pair returned by clipboard serializers and consumed by `onCopy` / `copyToClipboard` props." | `@public` |
| `export interface SerializeRangesArgs<…>` | "Input for {@link serializeRangesAsTsv}." | `@public` |
| `export function defaultCoerceForCopy(…)` | "Default coerce-value-to-string used during clipboard serialization. Useful as a fallback inside custom serializers." | `@public` |
| `export function serializeRangesAsTsv(…)` | "Serialize one or more `PretableCellRange`s to a tab-separated text + HTML payload suitable for clipboard write." | `@public` |

### `packages/react/src/constants.ts`

The file is one line:

```ts
export const ROW_SELECT_COLUMN_ID = "__pretable_row_select__";
```

Add the `@internal` block above the export:

```ts
/**
 * Reserved column id for the synthetic row-select checkbox column.
 * Internal — surface authors shouldn't reference this directly.
 *
 * @internal
 */
export const ROW_SELECT_COLUMN_ID = "__pretable_row_select__";
```

Note: `pretable-surface.tsx` re-exports `ROW_SELECT_COLUMN_ID`. The TSDoc above attaches to the `constants.ts` declaration, which is what api-extractor reads.

- [ ] **Step 1: Apply the TSDoc + tag for every declaration above**

Do them one file at a time, working through the table. Each comment block must be immediately above the `export` keyword (no blank line between).

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @pretable/react typecheck
```

Expected: passes. (TSDoc is comments — typecheck doesn't validate, but it must not break.)

- [ ] **Step 3: Commit**

```bash
git add packages/react/src
git commit -m "feat(react): TSDoc + @public/@beta/@internal tags on declarations

Adds TSDoc summaries with release tags on every public, beta, and
internal symbol so api-extractor's report shows annotated API
instead of @public (undocumented). Tags InspectionGrid,
LabeledGridSurface, and their props @beta. Tags useResolvedHeights,
measureRenderedRowHeight, ROW_SELECT_COLUMN_ID @internal — public_api.ts
will re-export them with ɵ-prefix in the next task.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Write `public_api.ts`; collapse `index.ts`; remove `PretableCoreColumn`

**Files:**
- Create: `packages/react/src/public_api.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Create `packages/react/src/public_api.ts`**

```ts
/**
 * Public API of `@pretable/react`. Hand-curated re-exports — do not edit
 * `index.ts` directly. Internal symbols stay in their source files and are
 * re-exported here under the `ɵ`-prefix when other `@pretable/*` packages
 * (or future internal hooks) need them.
 *
 * @packageDocumentation
 */

// Components
export { Pretable } from "./pretable";
export { PretableSurface } from "./pretable-surface";
export { InspectionGrid } from "./inspection-grid";
export { LabeledGridSurface } from "./labeled-grid-surface";

// Hooks
export { usePretable } from "./use-pretable";

// Component prop / message / config types
export type { PretableProps } from "./pretable";
export type {
  PretableSurfaceMessages,
  PretableSurfaceProps,
  RowSelectionColumnConfig,
} from "./pretable-surface";
export type { InspectionGridProps } from "./inspection-grid";
export type {
  LabeledGridSurfaceFormatValueInput,
  LabeledGridSurfaceProps,
} from "./labeled-grid-surface";

// Hook input + output shapes
export type {
  PretableModel,
  PretableRenderRow,
  PretableRenderSnapshot,
  PretableSurfaceState,
  PretableTelemetry,
  UsePretableOptions,
} from "./use-pretable";

// React-extended column type + render-input shapes
export type {
  PretableCellRenderInput,
  PretableColumn,
  PretableFormatInput,
  PretableHeaderRenderInput,
} from "./types";

// Copy / clipboard
export { defaultCoerceForCopy, serializeRangesAsTsv } from "./copy";
export type { CopyPayload, SerializeRangesArgs } from "./copy";

// Density
export type { DensityHeights } from "./density";

// Re-exports from @pretable/core (the engine types react users typically
// touch — full headless surface lives in @pretable/core)
export type {
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableRow,
} from "@pretable/core";

// Internal-but-exported (ɵ-prefix marks these as not API-stable)
export { useResolvedHeights as ɵuseResolvedHeights } from "./density";
export { measureRenderedRowHeight as ɵmeasureRenderedRowHeight } from "./row-height";
export { ROW_SELECT_COLUMN_ID as ɵROW_SELECT_COLUMN_ID } from "./constants";
```

Note: `PretableCoreColumn` is **not** re-exported (deleted per the spec). The unprefixed `useResolvedHeights`, `measureRenderedRowHeight`, `ROW_SELECT_COLUMN_ID` are also gone — only the `ɵ`-prefixed versions ship.

- [ ] **Step 2: Replace `packages/react/src/index.ts` with one line**

```ts
export * from "./public_api";
```

- [ ] **Step 3: Verify typecheck — react and the website**

```bash
pnpm --filter @pretable/react typecheck && \
pnpm --filter @pretable/app-website typecheck && \
pnpm --filter @pretable/app-bench typecheck
```

Expected: all pass. The website's docs reference public symbols only; `apps/bench` uses `PretableSurface` and `PretableColumn` (both still exported).

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/public_api.ts packages/react/src/index.ts
git commit -m "feat(react): hand-curated public_api.ts; remove PretableCoreColumn

public_api.ts is the single source of truth for the package's public
surface. index.ts collapses to a one-line re-export. Three internal-use
exports demoted to ɵ-prefix at the public boundary:
ɵuseResolvedHeights, ɵmeasureRenderedRowHeight, ɵROW_SELECT_COLUMN_ID.
PretableCoreColumn alias deleted — use PretableColumn from @pretable/core
if the headless base type is what you need.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Regenerate `react.api.md` and audit the diff

**Files:**
- Modify: `packages/react/react.api.md`

- [ ] **Step 1: Regenerate**

```bash
pnpm --filter @pretable/react build && \
pnpm --filter @pretable/react api
```

Expected: `API Extractor completed successfully`. The regenerated `packages/react/react.api.md` should differ substantially from current.

- [ ] **Step 2: Audit the diff against the spec's success criteria**

```bash
git diff packages/react/react.api.md | head -150
```

Verify each of these checks holds:

- `usePretableModel` and `UsePretableModelOptions` are gone (search the new file with `grep -n "usePretableModel\|UsePretableModelOptions" packages/react/react.api.md` — expected: nothing).
- `usePretable` exists and returns `PretableModel<TRow>` (not `PretableGrid<TRow>`).
- `UsePretableOptions` exists with the merged shape: `autosize`, `columns`, `rows`, `getRowId`, `viewportHeight`, `viewportWidth`, `overscan`, `state`, `measuredHeights`, `onSelectionChange`, `onFocusChange`.
- `useResolvedHeights`, `measureRenderedRowHeight`, `ROW_SELECT_COLUMN_ID` are gone; `ɵuseResolvedHeights`, `ɵmeasureRenderedRowHeight`, `ɵROW_SELECT_COLUMN_ID` are present.
- `PretableCoreColumn` is gone.
- `PretableSurfaceSortDirection` is gone (and `LabeledGridSurfaceFormatValueInput.sortDirection: PretableSortDirection` instead).
- `// @beta` annotations on `InspectionGrid`, `InspectionGridProps`, `LabeledGridSurface`, `LabeledGridSurfaceProps`, `LabeledGridSurfaceFormatValueInput`.
- Most public symbols show `// @public` (not `// @public (undocumented)`).
- `ae-forgotten-export` warnings reduced from current count — ideally zero, but cross-package leaks from `@pretable-internal/grid-core` types may persist if api-extractor doesn't always inline through bundledPackages. Note any remaining warnings; acceptable if they're pre-existing.

If any of the named symbols don't behave as expected, STOP — there's a bug.

- [ ] **Step 3: Verify `api:check` passes for all 4 packages**

```bash
pnpm api:check
```

Expected: all 4 `API Extractor completed successfully`, exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/react/react.api.md
git commit -m "chore(api): regenerate react.api.md after audit

Hook rename (usePretableModel → usePretable), 3 demotions to ɵ-prefix,
4 @beta tags on Inspection/Labeled surfaces, deletion of
PretableCoreColumn alias and PretableSurfaceSortDirection leak,
@public TSDoc on every other public symbol.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Write `packages/react/README.md`

**Files:**
- Create: `packages/react/README.md`

- [ ] **Step 1: Write the README**

```markdown
# @pretable/react

The React surface for [pretable](https://pretable.dev/). Ships three components and one hook on top of `@pretable/core`'s headless engine.

## When to reach for what

- **`<Pretable>`** — drop-in. Pass `columns` and `rows` and you're done. Best for quick wins.
- **`<PretableSurface>`** — controlled. Pass `state` to drive sort, filter, selection, focus, or column layout from the outside. Best for production apps.
- **`usePretable`** — the hook. Returns `{ grid, snapshot, renderSnapshot, telemetry }` for custom rendering. Best when you need more control than `<PretableSurface>` provides — e.g., a non-default DOM layout or a different framework.

`<InspectionGrid>` and `<LabeledGridSurface>` are special-purpose surfaces tagged `@beta` — they work, but expect shape changes pre-1.0.

## Install

```sh
npm install @pretable/react @pretable/core @pretable/ui
# or pnpm add … / yarn add …
```

`@pretable/ui` ships the CSS theme; import the stylesheet once at the root of your app.

## Minimal example

```tsx
import { Pretable } from "@pretable/react";
import "@pretable/ui/grid.css";

function App() {
  return (
    <Pretable
      columns={[
        { id: "name", header: "Name" },
        { id: "age", header: "Age", sortable: true },
      ]}
      rows={[
        { id: "1", name: "Ada", age: 36 },
        { id: "2", name: "Grace", age: 85 },
      ]}
    />
  );
}
```

## Full public surface

See **[`react.api.md`](./react.api.md)** for every exported component, hook, type, and function with their full signatures. The file is generated by [API Extractor](https://api-extractor.com/) and committed to the repo; CI fails if it drifts.

## License

MIT — see [LICENSE](../../LICENSE).
```

- [ ] **Step 2: Commit**

```bash
git add packages/react/README.md
git commit -m "docs(react): add per-package README

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Final repo-wide gates and PR

**Files:** none (verification + push + PR creation)

- [ ] **Step 1: Run all repo-wide gates**

```bash
pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format && pnpm api:check
```

Expected: every command exits 0. If `pnpm format` complains about any markdown files (the website docs got modified by sed in Task 1), run `pnpm format:write` and amend the relevant commit (or add a small follow-up commit).

- [ ] **Step 2: Push**

```bash
git push -u origin api-stabilization-react
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "refactor(react): audit @pretable/react public surface; rename usePretableModel → usePretable" --body "$(cat <<'EOF'
## Summary

PR 3 of 5 for [Tier 1 Sub-project A — Public API Stabilization](docs/superpowers/specs/2026-05-07-tier1-public-api-stabilization-design.md). Audits \`@pretable/react\` per [PR 3's design spec](docs/superpowers/specs/2026-05-08-tier1-api-stabilization-pr3-react-design.md).

- **Hook brevity rename.** \`usePretableModel\` → \`usePretable\` (the simple-sounding name now points to the hook docs already use). The old low-level \`usePretable\` (just \`useMemo(() => createGrid(opts))\`) is deleted; consumers can inline that pattern if needed. \`UsePretableModelOptions\` → \`UsePretableOptions\`; the strict-subset old \`UsePretableOptions\` is deleted.
- **\`public_api.ts\` convention.** Hand-curated curated public surface; \`index.ts\` is one line.
- **Three demotions to \`ɵ\`-prefix.** \`useResolvedHeights\` → \`ɵuseResolvedHeights\`, \`measureRenderedRowHeight\` → \`ɵmeasureRenderedRowHeight\`, \`ROW_SELECT_COLUMN_ID\` → \`ɵROW_SELECT_COLUMN_ID\`. Tagged \`@internal\` at source.
- **Two \`@beta\` tags.** \`InspectionGrid\` and \`LabeledGridSurface\` (plus their props/format-input types). Special-purpose surfaces with no docs page; we anticipate shape change.
- **Two deletions.** \`PretableCoreColumn\` alias (use \`PretableColumn\` from \`@pretable/core\` if the headless base is needed); \`PretableSurfaceSortDirection\` leak (replaced with \`PretableSortDirection\` from core).
- **TSDoc + \`@public\` on every public symbol** so \`react.api.md\` shows annotated API.
- **Per-package \`README.md\`** with the "when to reach for what" table.
- **8 website docs updated** for the hook rename.
- **Clipboard symbols stay \`@public\`.** Per user feedback: clipboard is stable API. Docs alignment captured in \`project_clipboard_docs_followup.md\` memory.

## Test plan
- [x] \`pnpm -w typecheck\` clean
- [x] \`pnpm -w test\` clean
- [x] \`pnpm -w lint\` clean
- [x] \`pnpm format\` clean
- [x] \`pnpm api:check\` clean (all 4 packages)
- [x] \`react.api.md\` shows \`usePretable\` (returning \`PretableModel\`); no \`usePretableModel\`
- [x] \`react.api.md\` has \`ɵ\`-prefixed exports for the 3 demoted symbols
- [x] \`InspectionGrid\` / \`LabeledGridSurface\` annotated \`@beta\`
- [x] \`PretableCoreColumn\` and \`PretableSurfaceSortDirection\` gone

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Set auto-merge**

```bash
gh pr merge --auto --squash
```

---

## Self-review checklist

- **Spec coverage:** every audit decision in the spec table maps to a task. Hook rename = Task 1. PretableSurfaceSortDirection leak fix = Task 2. TSDoc + tags = Task 3. public_api.ts + index.ts collapse + PretableCoreColumn deletion = Task 4. react.api.md regen + diff audit = Task 5. README = Task 6. Gates + PR = Task 7.
- **Placeholder scan:** no `TBD`, `TODO`, "implement later", or "etc." in any task body.
- **Type/name consistency:** the hook name and options-type rename is consistent across Task 1 (rewrite), Task 4 (public_api.ts re-export), Task 5 (diff audit). The 3 ɵ-prefix renames are consistent across Task 3 (`@internal` tag) and Task 4 (re-export with rename).
