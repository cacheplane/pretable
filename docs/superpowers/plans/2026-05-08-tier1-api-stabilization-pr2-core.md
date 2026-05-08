# Tier 1 Sub-project A — PR 2 (`@pretable/core` audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename engine types at source so `@pretable/core`'s public surface uses natural `Pretable*` names instead of `GridCore*` aliases; replace `PretableGrid`'s `Omit<>` leak with an explicit interface; tag every public symbol with TSDoc + `@public`; ship a per-package README.

**Architecture:** Three rename waves (`@pretable-internal/layout-core`, then `@pretable-internal/grid-core`, then `@pretable/core` and its consumers in `@pretable/react`), one new file (`pretable-grid.ts`) holding the explicit `PretableGrid` interface, one new file (`public_api.ts`) holding the curated public re-exports with TSDoc, one config update to `api-extractor.base.json`, and one new README. After the rename, `core.api.md` regenerates with no `ae-forgotten-export` warnings and every symbol carries `@public`.

**Tech Stack:** TypeScript (workspace-wide rename), `@microsoft/api-extractor`, `@microsoft/tsdoc`, pnpm workspaces.

**Source spec:** `docs/superpowers/specs/2026-05-08-tier1-api-stabilization-pr2-core-design.md`

---

## File Structure

| Path | Responsibility | Action |
|---|---|---|
| `packages/layout-core/src/types.ts` | `LayoutSpan` interface | Modify (rename → `PretableRowRange`) |
| `packages/layout-core/src/index.ts` | Layout-core barrel | Modify (rename in re-export) |
| `packages/grid-core/src/types.ts` | All `GridCore*` types | Modify (rename → `Pretable*`) |
| `packages/grid-core/src/index.ts` | Grid-core barrel | Modify (rename in re-exports) |
| `packages/grid-core/src/create-grid-core.ts` | Engine factory | Modify (rename internal references) |
| `packages/grid-core/src/derived-rows.ts` | Internal helper | Modify (rename internal references) |
| `packages/grid-core/src/derived-selection.ts` | Internal helper | Modify (rename `RowSelectionTriState` → `PretableRowSelectionTriState`) |
| `packages/grid-core/src/__tests__/selection-state.test.ts` | Test file | Modify (rename imports) |
| `packages/renderer-dom/src/types.ts` | DOM render types | Modify (rename internal imports) |
| `packages/renderer-dom/src/create-renderer.ts` | DOM renderer | Modify (rename internal imports) |
| `packages/core/src/pretable-grid.ts` | **NEW** explicit `PretableGrid` interface | Create |
| `packages/core/src/types.ts` | Re-export shell | Modify (collapse from ~50 lines to ~25) |
| `packages/core/src/create-grid.ts` | `createGrid` factory | Modify (return type uses local `PretableGrid`) |
| `packages/core/src/public_api.ts` | **NEW** curated public surface with TSDoc | Create |
| `packages/core/src/index.ts` | Package entry | Modify (collapse to `export * from './public_api'`) |
| `packages/react/src/types.ts` | React's column/render types | Modify (rename import alias) |
| `packages/react/src/index.ts` | React barrel | Modify (rename one re-export) |
| `api-extractor.base.json` | api-extractor config | Modify (`bundledPackages` + `ae-missing-release-tag`) |
| `packages/core/core.api.md` | Generated baseline | Regenerate |
| `packages/react/react.api.md` | Generated baseline | Regenerate (rename-only diff expected) |
| `packages/core/README.md` | **NEW** per-package README | Create |

---

## Task 1: Rename `LayoutSpan` → `PretableRowRange` in `@pretable-internal/layout-core`

**Files:**
- Modify: `packages/layout-core/src/types.ts`
- Modify: `packages/layout-core/src/index.ts`
- Modify: `packages/grid-core/src/types.ts` (consumer)
- Modify: `packages/grid-core/src/derived-rows.ts` (consumer, if it imports `LayoutSpan`)

- [ ] **Step 1: Rename the interface in `packages/layout-core/src/types.ts`**

Change line 1-4 from:
```ts
export interface LayoutSpan {
  start: number;
  end: number;
}
```
to:
```ts
/**
 * Half-open row index range — `start` inclusive, `end` exclusive — used to
 * describe the visible row window in {@link PretableGridSnapshot.visibleRange}.
 *
 * @public
 */
export interface PretableRowRange {
  start: number;
  end: number;
}
```

Find every other occurrence of `LayoutSpan` in this file (line 42 references it inside `ViewportPlan`) and rename to `PretableRowRange`.

- [ ] **Step 2: Update the barrel in `packages/layout-core/src/index.ts`**

Find the line `LayoutSpan,` inside the `export type` list and rename to `PretableRowRange,`.

- [ ] **Step 3: Update grid-core consumers**

In `packages/grid-core/src/types.ts`, line 1-4 currently:
```ts
import type {
  AutosizeOptions,
  LayoutSpan,
} from "@pretable-internal/layout-core";
```
becomes:
```ts
import type {
  AutosizeOptions,
  PretableRowRange,
} from "@pretable-internal/layout-core";
```

Then find the `visibleRange: LayoutSpan;` field (line 93) and rename to `visibleRange: PretableRowRange;`.

Run `grep -n LayoutSpan packages/grid-core/src/derived-rows.ts` — if any matches appear, rename them similarly.

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @pretable-internal/layout-core typecheck && \
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: both pass with no errors.

- [ ] **Step 5: Verify no stale `LayoutSpan` references in source**

```bash
grep -rn "LayoutSpan" packages 2>/dev/null | grep -v ".api.md\|/dist/" || echo "clean"
```

Expected: prints `clean` (nothing matches).

- [ ] **Step 6: Commit**

```bash
git add packages/layout-core/src packages/grid-core/src/types.ts packages/grid-core/src/derived-rows.ts
git commit -m "refactor(layout-core): rename LayoutSpan → PretableRowRange

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Rename `GridCore*` → `Pretable*` at engine source

**Files:**
- Modify: `packages/grid-core/src/types.ts`
- Modify: `packages/grid-core/src/index.ts`
- Modify: `packages/grid-core/src/create-grid-core.ts`
- Modify: `packages/grid-core/src/derived-rows.ts`
- Modify: `packages/grid-core/src/derived-selection.ts`
- Modify: `packages/grid-core/src/__tests__/selection-state.test.ts`
- Modify: `packages/renderer-dom/src/types.ts`
- Modify: `packages/renderer-dom/src/create-renderer.ts`

- [ ] **Step 1: Rename interface/type declarations in `packages/grid-core/src/types.ts`**

Apply this exact rename map across the file (using `sed` or editor batch-replace, then re-read to verify):

```
GridCoreCellAddress      → PretableCellAddress
GridCoreCellRange        → PretableCellRange
GridCoreColumn           → PretableColumn
GridCoreFocusDirection   → PretableFocusDirection
GridCoreFocusState       → PretableFocusState
GridCoreFormatInput      → PretableFormatInput
GridCoreFrame            → PretableFrame
GridCoreMoveFocusOptions → PretableMoveFocusOptions
GridCoreOptions          → PretableGridOptions
GridCoreRow              → PretableRow
GridCoreRowModel         → PretableVisibleRow
GridCoreSelectionState   → PretableSelectionState
GridCoreSnapshot         → PretableGridSnapshot
GridCoreSortDirection    → PretableSortDirection
GridCoreSortState        → PretableSortState
GridCoreStore            → PretableEngine
GridCoreTransaction      → PretableTransaction
GridCoreViewportState    → PretableViewportState
```

A safe one-shot using `sed` (run from worktree root):

```bash
files=(
  packages/grid-core/src/types.ts
  packages/grid-core/src/index.ts
  packages/grid-core/src/create-grid-core.ts
  packages/grid-core/src/derived-rows.ts
  packages/grid-core/src/derived-selection.ts
  packages/grid-core/src/__tests__/selection-state.test.ts
  packages/renderer-dom/src/types.ts
  packages/renderer-dom/src/create-renderer.ts
)
for f in "${files[@]}"; do
  sed -i '' \
    -e 's/GridCoreCellAddress/PretableCellAddress/g' \
    -e 's/GridCoreCellRange/PretableCellRange/g' \
    -e 's/GridCoreFocusDirection/PretableFocusDirection/g' \
    -e 's/GridCoreFocusState/PretableFocusState/g' \
    -e 's/GridCoreFormatInput/PretableFormatInput/g' \
    -e 's/GridCoreFrame/PretableFrame/g' \
    -e 's/GridCoreMoveFocusOptions/PretableMoveFocusOptions/g' \
    -e 's/GridCoreOptions/PretableGridOptions/g' \
    -e 's/GridCoreRowModel/PretableVisibleRow/g' \
    -e 's/GridCoreSelectionState/PretableSelectionState/g' \
    -e 's/GridCoreSnapshot/PretableGridSnapshot/g' \
    -e 's/GridCoreSortDirection/PretableSortDirection/g' \
    -e 's/GridCoreSortState/PretableSortState/g' \
    -e 's/GridCoreStore/PretableEngine/g' \
    -e 's/GridCoreTransaction/PretableTransaction/g' \
    -e 's/GridCoreViewportState/PretableViewportState/g' \
    -e 's/GridCoreColumn/PretableColumn/g' \
    -e 's/GridCoreRow/PretableRow/g' \
    "$f"
done
```

Important: the order matters — `GridCoreColumn` must come **after** `GridCoreColumn`-prefix-disambiguating renames (none here), and `GridCoreRow` (substring of `GridCoreRowModel`) must come **after** `GridCoreRowModel`. The sed list above respects that.

- [ ] **Step 2: Rename `RowSelectionTriState` → `PretableRowSelectionTriState`**

In `packages/grid-core/src/derived-selection.ts`, find the export and the type usages:

```bash
sed -i '' 's/RowSelectionTriState/PretableRowSelectionTriState/g' packages/grid-core/src/derived-selection.ts packages/grid-core/src/index.ts
```

- [ ] **Step 3: Verify no stale `GridCore` references remain**

```bash
grep -rn "GridCore[A-Z]" packages 2>/dev/null | grep -v ".api.md\|/dist/\|node_modules" || echo "clean"
```

Expected: `clean`.

```bash
grep -rn "\bRowSelectionTriState\b" packages 2>/dev/null | grep -v ".api.md\|/dist/\|PretableRowSelectionTriState" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 4: Verify typecheck and tests in the affected packages**

```bash
pnpm --filter @pretable-internal/grid-core typecheck && \
pnpm --filter @pretable-internal/grid-core test && \
pnpm --filter @pretable-internal/renderer-dom typecheck
```

Expected: typechecks pass, grid-core tests still pass.

- [ ] **Step 5: Commit**

```bash
git add packages/grid-core/src packages/renderer-dom/src
git commit -m "refactor(grid-core): rename GridCore* → Pretable* at source

Engine-level types now use Pretable* names directly. Internal-only
GridCoreStore renamed to PretableEngine to distinguish from the public
PretableGrid interface (defined separately in @pretable/core).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Define explicit `PretableGrid` in `@pretable/core`; rewrite `create-grid.ts`; collapse `types.ts`

**Files:**
- Create: `packages/core/src/pretable-grid.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/create-grid.ts`

- [ ] **Step 1: Create `packages/core/src/pretable-grid.ts` with the explicit interface**

```ts
import type {
  AutosizeOptions,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableFocusDirection,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableMoveFocusOptions,
  PretableRow,
  PretableSelectionState,
  PretableSortDirection,
  PretableTransaction,
  PretableViewportState,
} from "@pretable-internal/grid-core";

/**
 * Public handle returned by {@link createGrid}. Exposes every action and
 * observation pretable promises to support; does not extend the internal
 * engine type, so private methods cannot leak through the public surface.
 *
 * @public
 */
export interface PretableGrid<TRow extends PretableRow = PretableRow> {
  /** Discriminator — distinguishes `PretableGrid` from arbitrary objects. */
  readonly kind: "pretable-grid";

  /** The options the grid was constructed with. */
  readonly options: PretableGridOptions<TRow>;

  /** Subscribe to grid mutations. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;

  /** Read the current snapshot. Stable reference until the next mutation. */
  getSnapshot(): PretableGridSnapshot<TRow>;

  // sort / filter
  setSort(columnId: string | null, direction: PretableSortDirection): void;
  setFilter(columnId: string, value: string): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, string>): void;

  // selection
  setSelection(state: PretableSelectionState): void;
  selectAll(): void;
  clearSelection(): void;
  addRange(range: PretableCellRange): void;
  extendRangeFromAnchor(addr: PretableCellAddress): void;
  toggleRowSelection(rowId: string): void;
  setSelectAllVisible(checked: boolean): void;

  // focus
  setFocus(addr: PretableCellAddress | null): void;
  moveFocus(
    direction: PretableFocusDirection,
    options?: PretableMoveFocusOptions,
  ): void;

  // viewport
  setViewport(viewport: PretableViewportState): void;

  // column layout
  autosizeColumns(options?: AutosizeOptions): void;
  setColumnWidth(columnId: string, width: number): void;
  moveColumn(columnId: string, toIndex: number): void;
  setColumnPinned(columnId: string, pinned: "left" | null): void;
  autosizeColumn(columnId: string, options?: AutosizeOptions): void;
  resetColumnLayout(): void;
  mergeColumnsFromProps(nextColumns: PretableColumn<TRow>[]): void;

  // streaming
  applyTransaction(transaction: PretableTransaction<TRow>): void;
}
```

- [ ] **Step 2: Replace `packages/core/src/types.ts` with a clean re-export shell**

Overwrite the file with this content (collapses ~50 lines of aliases down to direct re-exports — the engine package now uses these names natively):

```ts
export type {
  AutosizeOptions,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableFocusDirection,
  PretableFocusState,
  PretableFormatInput,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableMoveFocusOptions,
  PretableRow,
  PretableRowSelectionTriState,
  PretableSelectionState,
  PretableSortDirection,
  PretableSortState,
  PretableTransaction,
  PretableViewportState,
  PretableVisibleRow,
} from "@pretable-internal/grid-core";

export type { PretableRowRange } from "@pretable-internal/layout-core";
```

Note: `PretableGrid` is not re-exported from here — it is defined in `pretable-grid.ts`. `PretableEngine` is intentionally not re-exported either — it's an internal engine type.

- [ ] **Step 3: Rewrite `packages/core/src/create-grid.ts`**

Overwrite with:

```ts
import { createGridCore } from "@pretable-internal/grid-core";

import type { PretableGrid } from "./pretable-grid";
import type { PretableGridOptions, PretableRow } from "./types";

/**
 * Create a pretable grid instance. Returns a {@link PretableGrid} handle
 * that exposes every action and observation pretable supports.
 *
 * @example
 * ```ts
 * const grid = createGrid({
 *   columns: [{ id: "name" }, { id: "age" }],
 *   rows: [{ id: "1", name: "Ada", age: 36 }],
 * });
 * grid.setSort("age", "desc");
 * const snapshot = grid.getSnapshot();
 * ```
 *
 * @public
 */
export function createGrid<TRow extends PretableRow = PretableRow>(
  options: PretableGridOptions<TRow>,
): PretableGrid<TRow> {
  const engine = createGridCore(options);

  return {
    kind: "pretable-grid",
    get options() {
      return engine.options;
    },
    subscribe: engine.subscribe,
    getSnapshot: engine.getSnapshot,
    setSort: engine.setSort,
    setFilter: engine.setFilter,
    clearFilters: engine.clearFilters,
    replaceFilters: engine.replaceFilters,
    setSelection: engine.setSelection,
    selectAll: engine.selectAll,
    clearSelection: engine.clearSelection,
    addRange: engine.addRange,
    extendRangeFromAnchor: engine.extendRangeFromAnchor,
    toggleRowSelection: engine.toggleRowSelection,
    setSelectAllVisible: engine.setSelectAllVisible,
    setFocus: engine.setFocus,
    moveFocus: engine.moveFocus,
    setViewport: engine.setViewport,
    autosizeColumns: engine.autosizeColumns,
    setColumnWidth: engine.setColumnWidth,
    moveColumn: engine.moveColumn,
    setColumnPinned: engine.setColumnPinned,
    autosizeColumn: engine.autosizeColumn,
    resetColumnLayout: engine.resetColumnLayout,
    mergeColumnsFromProps: engine.mergeColumnsFromProps,
    applyTransaction: engine.applyTransaction,
  };
}
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @pretable/core typecheck
```

Expected: passes. (At this point `@pretable/react` is broken because it imports `PretableCoreColumn`, fixed in Task 4.)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pretable-grid.ts packages/core/src/types.ts packages/core/src/create-grid.ts
git commit -m "refactor(core): explicit PretableGrid interface; collapse types.ts

Replaces extends Omit<GridCoreStore<TRow>, 'options'> with an explicit
interface listing every method/property pretable promises. types.ts
becomes a re-export shell from the renamed engine types.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Update `@pretable/react` import alias and re-export

**Files:**
- Modify: `packages/react/src/types.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Update import in `packages/react/src/types.ts`**

Change lines 1-7 from:
```ts
import type { ReactNode } from "react";
import type {
  PretableCoreColumn,
  PretableFormatInput,
  PretableRow,
} from "@pretable/core";
```
to:
```ts
import type { ReactNode } from "react";
import type {
  PretableColumn as PretableBaseColumn,
  PretableFormatInput,
  PretableRow,
} from "@pretable/core";
```

Then update the `extends` clause — find:
```ts
export interface PretableColumn<
  TRow extends PretableRow = PretableRow,
> extends PretableCoreColumn<TRow> {
```
and change `extends PretableCoreColumn<TRow>` to `extends PretableBaseColumn<TRow>`.

- [ ] **Step 2: Update re-export in `packages/react/src/index.ts`**

Find the block (around lines 47-53):
```ts
// Re-exports from @pretable/core
export type {
  PretableCoreColumn,
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableRow,
} from "@pretable/core";
```
and change `PretableCoreColumn,` to `PretableColumn as PretableCoreColumn,`. The line becomes:

```ts
// Re-exports from @pretable/core
export type {
  PretableColumn as PretableCoreColumn,
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableRow,
} from "@pretable/core";
```

This keeps react's public surface stable (`PretableCoreColumn` still importable from `@pretable/react`); PR 3's audit will replace this alias with whatever shape react settles on.

- [ ] **Step 3: Verify typecheck across react and consumers**

```bash
pnpm --filter @pretable/react typecheck && \
pnpm --filter @pretable/app-website typecheck && \
pnpm --filter @pretable/app-bench typecheck
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/types.ts packages/react/src/index.ts
git commit -m "refactor(react): rename import aliases for renamed core types

types.ts imports core's PretableColumn as PretableBaseColumn to
disambiguate from react's own PretableColumn. index.ts re-exports
PretableColumn as PretableCoreColumn so react's public surface is
unchanged — PR 3 will revisit the surface during the react audit.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Write `@pretable/core/src/public_api.ts` with TSDoc; collapse `index.ts`

**Files:**
- Create: `packages/core/src/public_api.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/src/public_api.ts`**

Write the full curated public surface. Each symbol has TSDoc + `@public`. Use this content:

```ts
/**
 * Public API of `@pretable/core`. Hand-curated re-exports — do not edit
 * `index.ts` directly. Internal symbols stay in their source files and
 * are not re-exported here.
 *
 * @packageDocumentation
 */

export { createGrid } from "./create-grid";
export type { PretableGrid } from "./pretable-grid";

export type {
  /** Tuning knobs for column autosize calculations. @public */
  AutosizeOptions,
  /** Cell address — the (rowId, columnId) pair that uniquely identifies a cell. @public */
  PretableCellAddress,
  /** Inclusive cell range — both bounds (start and end) are inside the selection. @public */
  PretableCellRange,
  /** Engine-level column definition. `@pretable/react` extends this with React-specific render fields. @public */
  PretableColumn,
  /** Direction passed to {@link PretableGrid.moveFocus}. @public */
  PretableFocusDirection,
  /** Currently focused cell — both fields are null when nothing is focused. @public */
  PretableFocusState,
  /** Input passed to a column's `format` function. @public */
  PretableFormatInput,
  /** Options accepted by {@link createGrid}. @public */
  PretableGridOptions,
  /** Read-only state observed via {@link PretableGrid.getSnapshot}. @public */
  PretableGridSnapshot,
  /** Optional behavior modifiers for {@link PretableGrid.moveFocus}. @public */
  PretableMoveFocusOptions,
  /** Base row constraint — every row is at minimum a string-keyed record. @public */
  PretableRow,
  /** Per-row selection state — "selected" means fully, "indeterminate" means partial. @public */
  PretableRowSelectionTriState,
  /** Cell-range selection state including the optional anchor for shift-extension. @public */
  PretableSelectionState,
  /** Sort direction — `null` means unsorted. @public */
  PretableSortDirection,
  /** Active sort. `columnId` is null when no column is sorted. @public */
  PretableSortState,
  /** Streaming transaction — incremental row mutations applied via {@link PretableGrid.applyTransaction}. @public */
  PretableTransaction,
  /** Viewport-level scroll + size state. @public */
  PretableViewportState,
  /** A row currently in the visible window — includes its source-array index for stable identity. @public */
  PretableVisibleRow,
} from "./types";

export type {
  /** Half-open row index range exposed via {@link PretableGridSnapshot.visibleRange}. @public */
  PretableRowRange,
} from "./types";
```

Note: api-extractor reads the `@public` from TSDoc; the `/** ... */` block must directly precede the symbol. Inline-comment `@public` placement (as written here) works because each symbol is on its own line with the comment directly above. If api-extractor flags any as missing, hoist the TSDoc to a separate `/** ... @public */` block above the symbol.

Wait — TSDoc release tags must be on a doc comment attached to a *declaration*, not on a re-export line. Re-exports cannot carry release tags this way. Instead, the release tags must live on the original declarations in `@pretable-internal/grid-core/src/types.ts` and `@pretable-internal/layout-core/src/types.ts`. This step is updated below.

- [ ] **Step 2: Replace `public_api.ts` with the simpler re-export shell**

Overwrite `packages/core/src/public_api.ts` with:

```ts
/**
 * Public API of `@pretable/core`. Hand-curated re-exports — do not edit
 * `index.ts` directly. Internal symbols stay in their source files and
 * are not re-exported here.
 *
 * @packageDocumentation
 */

export { createGrid } from "./create-grid";
export type { PretableGrid } from "./pretable-grid";

export type {
  AutosizeOptions,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableFocusDirection,
  PretableFocusState,
  PretableFormatInput,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableMoveFocusOptions,
  PretableRow,
  PretableRowRange,
  PretableRowSelectionTriState,
  PretableSelectionState,
  PretableSortDirection,
  PretableSortState,
  PretableTransaction,
  PretableViewportState,
  PretableVisibleRow,
} from "./types";
```

- [ ] **Step 3: Add `@public` + TSDoc to `@pretable-internal/grid-core/src/types.ts`**

This is where the tags actually attach. Apply this TSDoc above each exported symbol. Open `packages/grid-core/src/types.ts` and add the comment blocks:

```ts
/**
 * Tuning knobs for column autosize calculations.
 * @public
 */
// (Above the existing `export type GridCoreSortDirection` block)
```

The full set of additions follows. For each interface/type below, prepend the indicated TSDoc comment immediately above the declaration:

| Symbol | TSDoc summary |
|---|---|
| `PretableRow` | "Base row constraint — every row is at minimum a string-keyed record." |
| `PretableSortDirection` | "Sort direction — \`null\` means unsorted." |
| `PretableColumn` | "Engine-level column definition. \`@pretable/react\` extends this with React-specific render fields." |
| `PretableFormatInput` | "Input passed to a column's \`format\` function." |
| `PretableGridOptions` | "Options accepted by \`createGrid\`." |
| `PretableSortState` | "Active sort. \`columnId\` is null when no column is sorted." |
| `PretableCellAddress` | "Cell address — the (rowId, columnId) pair that uniquely identifies a cell." |
| `PretableCellRange` | "Inclusive cell range — both bounds (start and end) are inside the selection." |
| `PretableSelectionState` | "Cell-range selection state including the optional anchor for shift-extension." |
| `PretableFocusState` | "Currently focused cell — both fields are null when nothing is focused." |
| `PretableViewportState` | "Viewport-level scroll + size state." |
| `PretableTransaction` | "Streaming transaction — incremental row mutations applied via \`PretableGrid.applyTransaction\`." |
| `PretableVisibleRow` | "A row currently in the visible window — includes its source-array index for stable identity." |
| `PretableGridSnapshot` | "Read-only state observed via \`PretableGrid.getSnapshot\`." |
| `PretableEngine` | "@internal" (this is intentionally not public — keeps it out of the report) |
| `PretableFocusDirection` | "Direction passed to \`PretableGrid.moveFocus\`." |
| `PretableMoveFocusOptions` | "Optional behavior modifiers for \`PretableGrid.moveFocus\`." |
| `PretableFrame` | "@internal" (not public) |

The format for each comment block:

```ts
/**
 * <summary text>
 *
 * @public
 */
export interface PretableColumn<TRow extends PretableRow = PretableRow> {
  ...
}
```

For the two `@internal` symbols (`PretableEngine`, `PretableFrame`), use:

```ts
/**
 * @internal
 */
export interface PretableEngine<TRow extends PretableRow = PretableRow> {
  ...
}
```

- [ ] **Step 4: Add `@public` + TSDoc to `PretableRowSelectionTriState` in `derived-selection.ts`**

In `packages/grid-core/src/derived-selection.ts`, find:
```ts
export type PretableRowSelectionTriState = "selected" | "indeterminate";
```

Prepend:
```ts
/**
 * Per-row selection state — "selected" means fully, "indeterminate" means partial.
 *
 * @public
 */
export type PretableRowSelectionTriState = "selected" | "indeterminate";
```

The other two exports from this file (`deriveSelectedRows`, `rangeContainsCell`) are not in `@pretable/core`'s public surface but are exported from `@pretable-internal/grid-core` for cross-package use. Tag them `@internal`:

```ts
/**
 * @internal
 */
export function deriveSelectedRows(...) { ... }

/**
 * @internal
 */
export function rangeContainsCell(...) { ... }
```

- [ ] **Step 5: Add `@public` to `PretableRowRange` in `layout-core/src/types.ts`**

It already received the TSDoc in Task 1 — verify by reading the file. If the `@public` tag is present in the comment block above `PretableRowRange`, no action. Otherwise add it.

- [ ] **Step 6: Tag remaining `layout-core` exports as `@internal`**

`@pretable-internal/layout-core` exports many symbols (`AutosizeColumnDef`, `ColumnPlan`, `PinnedColumnInput`, `PlanColumnsColumnInput`, `PlanColumnsInput`, `PlannedColumn`, `PlannedPinnedColumn`, `PlannedRow`, `PlanViewportInput`, `RowMetricsIndex`, `ViewportPlan`, `createRowMetricsIndex`, `planColumns`, `planViewport`, `autosizeColumns`, `AutosizeColumnsInput`, `AutosizeResult`). None are public. `AutosizeOptions` is public (re-exported from `@pretable/core`).

Open `packages/layout-core/src/types.ts` and prepend `/** @public */` to `AutosizeOptions` and `/** @internal */` to every other exported symbol.

In `packages/layout-core/src/index.ts` — only the re-exports happen; no declarations to tag.

- [ ] **Step 7: Collapse `packages/core/src/index.ts`**

Overwrite with one line:

```ts
export * from "./public_api";
```

- [ ] **Step 8: Verify typecheck**

```bash
pnpm --filter @pretable/core typecheck && \
pnpm --filter @pretable-internal/grid-core typecheck && \
pnpm --filter @pretable-internal/layout-core typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src packages/grid-core/src packages/layout-core/src
git commit -m "feat(core): hand-curated public_api.ts with @public TSDoc tags

Adds @public TSDoc tags to every symbol exported through
@pretable/core's public surface, plus @internal tags on engine-only
symbols (PretableEngine, PretableFrame, deriveSelectedRows,
rangeContainsCell, layout-core's planning types). index.ts collapses to
a single re-export from public_api.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Update `api-extractor.base.json`

**Files:**
- Modify: `api-extractor.base.json`

- [ ] **Step 1: Add internal packages to `bundledPackages`**

Open `api-extractor.base.json`. Find the `bundledPackages` array and append the two internal packages so the report inlines their types:

```json
"bundledPackages": [
  "@pretable/core",
  "@pretable/react",
  "@pretable/ui",
  "@pretable/stream-adapter",
  "@pretable-internal/grid-core",
  "@pretable-internal/layout-core"
]
```

- [ ] **Step 2: Flip `ae-missing-release-tag` to `warning`**

In the same file, the `extractorMessageReporting` block currently reads:

```json
"ae-missing-release-tag": {
  "logLevel": "none"
}
```

(or similar — PR 1's actual setting). Change to:

```json
"ae-missing-release-tag": {
  "logLevel": "warning"
}
```

This surfaces tag-coverage gaps in subsequent PRs without failing CI in non-local mode (warnings are non-fatal).

- [ ] **Step 3: Build everything so api-extractor sees the new types**

```bash
pnpm -r --filter '@pretable/core' --filter '@pretable/react' --filter '@pretable/stream-adapter' --filter '@pretable/ui' build
```

Expected: every package builds, including the underlying `@pretable-internal/*` builds chained from the `@pretable/*` build scripts.

- [ ] **Step 4: Smoke-test api-extractor with the new config (just core)**

```bash
pnpm --filter @pretable/core api
```

Expected: `API Extractor completed successfully`. The regenerated `core.api.md` should now show:
- Zero `ae-forgotten-export` warnings.
- Every public symbol annotated `// @public` (not `@public (undocumented)`).
- `PretableGrid` rendered as a flat interface (not `extends Omit<...>`).

If any of those don't hold, debug before continuing.

- [ ] **Step 5: Commit**

```bash
git add api-extractor.base.json
git commit -m "chore(api): bundle internal packages; flip missing-release-tag to warning

bundledPackages now inlines @pretable-internal/grid-core and
@pretable-internal/layout-core into each report so renamed types appear
self-contained. ae-missing-release-tag was 'none' for the PR 1 baseline;
flips to 'warning' now that core is fully tagged — provides coverage
visibility for PRs 3-5 without failing CI.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Regenerate `.api.md` files

**Files:**
- Modify: `packages/core/core.api.md`
- Modify: `packages/react/react.api.md`

- [ ] **Step 1: Regenerate all four reports**

```bash
pnpm api
```

Expected: all four `API Extractor completed successfully`. May take 30-60 seconds (full build first).

- [ ] **Step 2: Inspect `core.api.md` for shape**

```bash
head -30 packages/core/core.api.md
```

Expected first lines:
```
## API Report File for "@pretable/core"

> Do not edit this file. It is a report generated by [API Extractor](https://api-extractor.com/).

```ts

// @public
export interface AutosizeOptions {
  ...
}
```

`AutosizeOptions`, `createGrid`, and every type should appear with `// @public` (not `@public (undocumented)`). Search for `(undocumented)` in the file:

```bash
grep -n "(undocumented)" packages/core/core.api.md || echo "fully documented"
```

Expected: `fully documented` (every member-level fields may still show `(undocumented)` since we only TSDoc'd the top-level types — that's acceptable for this PR).

Actually fields and members WILL still show `(undocumented)` because we only added TSDoc on the type/interface declarations, not on individual members. That's expected and acceptable; cleaning up member-level documentation is out of scope for this PR.

- [ ] **Step 3: Verify `react.api.md` diff is rename-only**

```bash
git diff packages/react/react.api.md | head -80
```

Expected: line-level diff shows `GridCore*` → `Pretable*` renames; types like `PretableColumn` (extending core's renamed type) re-exported under same names. NO new symbols, NO removed symbols, NO shape changes (no added/removed fields, no method signature changes).

If the diff includes shape changes (e.g., a method signature is different, a field appeared or disappeared), STOP — investigate. PR 2's spec says react's diff must be mechanical rename only.

- [ ] **Step 4: Verify all four `api:check` pass**

```bash
pnpm api:check
```

Expected: all four packages report `API Extractor completed successfully`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/core.api.md packages/react/react.api.md packages/ui/ui.api.md packages/stream-adapter/stream-adapter.api.md
git commit -m "chore(api): regenerate .api.md after engine type rename

core.api.md: zero ae-forgotten-export warnings; every public symbol
annotated @public; PretableGrid is a flat interface.
react.api.md: mechanical rename diff only — no shape changes.
ui.api.md, stream-adapter.api.md: no expected change but regenerated for
consistency.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Write `packages/core/README.md`

**Files:**
- Create: `packages/core/README.md`

- [ ] **Step 1: Write the README**

Create `packages/core/README.md` with this content:

```markdown
# @pretable/core

The headless engine for [pretable](https://pretable.dev/). Drives sort, filter, selection, focus, viewport, and streaming-transaction state for any table-shaped UI.

## When to reach for this

Most users want **[`@pretable/react`](../react)** instead. It bundles `@pretable/core` with a React surface that handles rendering, layout, and keyboard interaction.

`@pretable/core` is for users building their own UI from scratch — for example, plain DOM, a non-React framework, or a custom canvas/webgl renderer. Headless usage is supported (the `createGrid` factory returns a fully-typed `PretableGrid` handle), but **dedicated docs, examples, and demos for headless mode are forthcoming**. If headless is what you're after, the type definitions and [`core.api.md`](./core.api.md) are the source of truth today.

## Install

```sh
npm install @pretable/core
# or pnpm add @pretable/core, yarn add @pretable/core
```

## Minimal example

```ts
import { createGrid } from "@pretable/core";

const grid = createGrid({
  columns: [
    { id: "name", header: "Name" },
    { id: "age", header: "Age", sortable: true },
  ],
  rows: [
    { id: "1", name: "Ada", age: 36 },
    { id: "2", name: "Grace", age: 85 },
  ],
});

grid.subscribe(() => {
  const { visibleRows, sort } = grid.getSnapshot();
  console.log("rows:", visibleRows.length, "sort:", sort);
});

grid.setSort("age", "desc");
```

## Full public surface

See **[`core.api.md`](./core.api.md)** for every exported type, interface, and function with their full signatures. The file is generated by [API Extractor](https://api-extractor.com/) and committed to the repo; CI fails if it drifts.

## License

MIT — see [LICENSE](../../LICENSE).
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/README.md
git commit -m "docs(core): add per-package README

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Final repo-wide gates and PR

**Files:** none (verification + push + PR creation)

- [ ] **Step 1: Run all repo-wide gates**

```bash
pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format && pnpm api:check
```

Expected: every command exits 0.

- [ ] **Step 2: Sanity check the diff stays inside PR 2's scope**

```bash
git diff main..HEAD --stat | tail -5
```

Expect: file changes inside `packages/core`, `packages/grid-core`, `packages/layout-core`, `packages/renderer-dom`, `packages/react/src/{types.ts,index.ts}`, `api-extractor.base.json`, `packages/react/react.api.md`. No website changes. No bench changes. No engine-behavior code changes (only type renames).

- [ ] **Step 3: Push**

```bash
git push -u origin api-stabilization-core
```

- [ ] **Step 4: Open the PR**

```bash
gh pr create --title "refactor(core): audit @pretable/core public surface; rename GridCore* → Pretable* at engine source" --body "$(cat <<'EOF'
## Summary

PR 2 of 5 for [Tier 1 Sub-project A — Public API Stabilization](docs/superpowers/specs/2026-05-07-tier1-public-api-stabilization-design.md). Audits \`@pretable/core\`'s public surface per [PR 2's design spec](docs/superpowers/specs/2026-05-08-tier1-api-stabilization-pr2-core-design.md).

- Renames every \`GridCore*\` type at engine source to its natural \`Pretable*\` name. Internal-only \`GridCoreStore\` becomes \`PretableEngine\` (kept private); a brand-new explicit \`PretableGrid\` interface in \`@pretable/core\` replaces the old \`extends Omit<GridCoreStore<TRow>, "options">\` leak.
- \`@pretable/core/types.ts\` collapses from ~50 lines of aliases to a clean re-export shell.
- \`@pretable/core/public_api.ts\` is the new hand-curated public surface; \`index.ts\` is one line.
- Every public symbol carries TSDoc + \`@public\`. \`@internal\` tags on engine-only symbols (PretableEngine, PretableFrame, deriveSelectedRows, rangeContainsCell, layout-core's planning types).
- \`api-extractor.base.json\` adds \`@pretable-internal/grid-core\` and \`@pretable-internal/layout-core\` to \`bundledPackages\` so the renamed types appear inlined in \`core.api.md\`. \`ae-missing-release-tag\` flips from \`none\` (PR 1 baseline) to \`warning\` (visible coverage signal for PRs 3-5).
- \`packages/core/README.md\` ships a prose intro mentioning headless usage as a forthcoming story.

## react.api.md changes

The rename ripples mechanically into \`@pretable/react\`'s import alias (\`PretableColumn as PretableBaseColumn\` in \`types.ts\`) and one re-export rename (\`PretableColumn as PretableCoreColumn\` in \`index.ts\`). \`react.api.md\` regenerates with **rename-only** diff — no shape change. PR 3's audit will fully resolve react's surface (likely retiring the \`PretableCoreColumn\` alias).

## Headless docs deferral

Per memory, full headless docs/examples/demos are deferred. README mentions headless support; \`core.api.md\` is the source of truth.

## Test plan
- [x] \`pnpm -w typecheck\` clean
- [x] \`pnpm -w test\` clean
- [x] \`pnpm -w lint\` clean
- [x] \`pnpm format\` clean
- [x] \`pnpm api:check\` clean (all 4 packages)
- [x] \`core.api.md\` has zero \`ae-forgotten-export\` warnings
- [x] \`react.api.md\` diff is rename-only (no shape changes)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Set auto-merge**

```bash
gh pr merge --auto --squash
```

---

## Self-review checklist

- **Spec coverage:** every requirement in the spec maps to a task. Rename map (§Components) → Tasks 1-2. Explicit `PretableGrid` (§Architecture) → Task 3. Release tags (§TSDoc style) → Task 5. `bundledPackages` + tag flip (§ae-missing-release-tag config) → Task 6. README (§Per-package README) → Task 8. Success criteria all map: zero forgotten-export = Task 7 step 2; @public coverage = Task 5; explicit PretableGrid = Task 3; rename-only react diff = Task 7 step 3; README = Task 8; gates = Task 9.
- **Placeholder scan:** no \`TBD\`, \`TODO\`, "implement later", or "etc." in any task body.
- **Type/name consistency:** the rename map in Task 2 matches what Tasks 3, 4, 5, and 7 reference. `PretableEngine` is consistently used for the internal handle; `PretableGrid` is consistently used for the public interface. `PretableRowRange` (Task 1) is referenced in Tasks 5 and 7.
- **Important note on Task 5 Step 1:** the first attempt at the file (with TSDoc tags inline on re-export lines) is included as a documented failure mode. Step 2 corrects it. Implementers can skip Step 1 and go straight to Step 2 if they understand TSDoc release tags must attach to declarations, not re-exports — but the inline failure is documented so the implementer doesn't have to rediscover it.
