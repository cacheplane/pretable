# Selection + Keyboard Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land sub-project B from the Tier 1 roadmap — Excel-style cell-range selection, ARIA grid keyboard navigation, built-in checkbox column with three-state derivation, TSV copy with override hooks, hero-demo update, pretable-internal Slab 1 bench claim, and full documentation surface — across eight independently-mergeable PRs.

**Architecture:** Cell-range is the canonical selection state stored in `@pretable-internal/grid-core` as `{ ranges: GridCoreCellRange[], anchor: GridCoreCellAddress | null }` keyed by stable row/column IDs. All click and keyboard gestures mutate this state; row-selection (and the checkbox column's three-state visual) derives from it as a pure function. The React adapter (`@pretable/react`) translates DOM events into engine actions, applies ARIA attributes per the grid pattern (single tab stop), wires Cmd+C through a TSV serializer with per-column / grid-level overrides, and announces selection changes through an off-screen `aria-live` region.

**Tech Stack:** TypeScript, React 19, Vitest (jsdom), Playwright (smoke), pnpm workspaces. Touched packages: `@pretable-internal/grid-core`, `@pretable/core`, `@pretable/react`, `apps/bench`, `apps/website` (hero demo + docs MDX).

**Spec:** [`docs/superpowers/specs/2026-05-05-selection-keyboard-nav-design.md`](../specs/2026-05-05-selection-keyboard-nav-design.md)

**Working directory:** All paths in this plan are relative to the repo root `/Users/blove/repos/pretable/`. Each PHASE ships from its own worktree (see "Worktree per phase" below).

---

## Phase Roadmap

Each phase below ships as one PR, merged on green before the next starts. Detail is filled in just-in-time: Phase 1 is fully task-decomposed in this document; subsequent phases have structured outlines and become fully detailed (appended to this same plan file) when their predecessor merges.

| #   | Phase                                                                   | Branch / worktree      | Mergeable test surface                                                                                            |
| --- | ----------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Engine state foundation                                                 | `b1-engine-state`      | grid-core unit tests, all in-repo callsites compile and existing tests still pass                                 |
| 2   | React adapter — keyboard nav (2D + page/home/end) + `state` prop rename | `b2-keyboard-nav`      | jsdom component tests for every key in the keyboard contract; controlled & uncontrolled modes                     |
| 3   | React adapter — click + cell-range selection (incl. marquee drag)       | `b3-cell-range-clicks` | jsdom component tests for click, shift+click, cmd+click, drag-marquee; visual selection styling renders           |
| 4   | Built-in checkbox column + select-all                                   | `b4-checkbox-column`   | jsdom component tests for column injection, three-state derivation, header checkbox semantics; hero demo wired    |
| 5   | Copy contract — TSV + overrides                                         | `b5-copy`              | jsdom tests for TSV serialization (single + multi-range, headers opt-in, `formatForCopy`, `onCopy`, no-paste-yet) |
| 6   | ARIA live region + announcements                                        | `b6-aria-live`         | jsdom tests assert the live-region's textContent after Cmd+A and Cmd+C; `messages` prop overrides                 |
| 7   | Bench Slab 1 — H13/H14/H15                                              | `b7-bench-slab1`       | repeated Chromium S2/hypothesis runs satisfy H13, H14, H15 with evidence in `status/runsets/`                     |
| 8   | Documentation surface                                                   | `b8-docs`              | new pages render; existing MDX example pipeline still typechecks                                                  |

**Worktree per phase:** Implementation for each phase happens in `~/.worktrees/pretable-<branch>` (created via `superpowers:using-git-worktrees`). The plan file itself lives on `plan/selection-keyboard-nav` (the branch this is being written on); subsequent updates to this plan also commit there.

**Just-in-time planning:** When a phase merges, the next phase gets fully detailed by appending a "## Phase N — Detailed Tasks" section to this file, then its worktree is created and execution begins. The outlines in this document are explicit enough to size and sequence; they are not yet task-decomposed because the predecessor phase will surface details (CSS token names, fixture shapes, real test names) that change them.

---

## Architectural Notes (shared across phases)

### Naming conventions

- Engine types are named `GridCore<Thing>` in `@pretable-internal/grid-core`; the public `@pretable/core` package re-exports them as `Pretable<Thing>`. New types follow the same pattern: `GridCoreCellAddress`, `GridCoreCellRange`, plus `GridCoreSelectionState` updated in place.
- Engine actions live on `GridCoreStore`; the public `PretableGrid` interface in `@pretable/core` exposes the same actions verbatim (no façade wrapping).
- React props use camelCase aligned with existing patterns: `state`, `onSelectionChange`, `onFocusChange`, `rowSelectionColumn`, `tabBehavior`, `copyWithHeaders`, `onCopy`, `messages`.

### Range invariants (referenced by every phase that touches selection)

- Ranges store stable IDs (row IDs and column IDs), never indices.
- A range with a `startRowId` or `endRowId` not currently visible (filtered out) is **kept** in state but contributes zero cells to copy / "selected rows" derivation until the row reappears.
- Selection is always at least the focused cell. Internally, "no selection beyond focus" = `ranges: [{ start === end on both axes }]` with `anchor` at the same address.
- `ranges` is ordered by selection order (oldest first). The **active range** for shift+arrow extension is always `ranges[ranges.length - 1]`.
- `addRange(range)` appends; `extendRangeFromAnchor(addr)` replaces the active range with `[anchor…addr]` (anchor unchanged).

### Selected-row derivation

Pure function `deriveSelectedRows(snapshot)` returns a `Map<rowId, "selected" | "indeterminate">` over currently-visible rows. A row is `selected` if every visible cell in the row is inside at least one range; `indeterminate` if some-but-not-all are; absent from the map if none are. This function is consumed by the checkbox column's three-state visual and the `aria-selected` row attribute.

### Controlled vs uncontrolled

The existing `interactionState` prop is **renamed to `state`** in Phase 2 across all surfaces. New slices for `selection` and `focus` mirror the existing `sort` slice. Omitting a slice = uncontrolled (engine owns it); providing a slice = controlled (engine reads, fires `on…Change`, consumer decides whether to commit).

### No backwards compatibility

Per the standing project preference (memory: `feedback_no_backcompat.md`), there are no deprecation aliases. `selectRow`, the 1D `moveFocus(delta)`, and the `interactionState` prop are removed in Phase 1 / Phase 2 respectively. All in-repo callsites update in the same PR. Docs that reference removed symbols (e.g. `apps/website/app/docs/grid/api-reference/page.mdx`) are updated in their containing phase's PR (Phase 8 owns the consolidated doc rewrite, but each phase fixes any docs it directly invalidates so docs never lag the code on `main`).

### Test layering

- **Engine tests** (`packages/grid-core/src/__tests__/*.test.ts`) — pure logic over `createGridCore`. No DOM. Vitest in `node` mode.
- **Adapter tests** (`packages/react/src/__tests__/*.test.tsx`) — `render` from `@testing-library/react`, `userEvent` for interactions, jsdom. Assert engine state via `grid.getSnapshot()` AND DOM via `screen`.
- **App-level smoke** (`apps/website/e2e/smoke.spec.ts`) — Playwright. Asserts the hero demo loads and the checkbox column is visible+clickable. Phase 4 adds the smoke step.

---

## File Structure (Phase 1 scope only)

```
packages/grid-core/src/
├── types.ts                                          (MODIFY: replace selection types, generalize moveFocus)
├── create-grid-core.ts                               (MODIFY: replace selection state + actions, generalize moveFocus impl)
├── derived-rows.ts                                   (no change)
├── derived-selection.ts                              (CREATE: deriveSelectedRows pure helper)
├── index.ts                                          (MODIFY: export new types)
└── __tests__/
    ├── grid-core.test.ts                             (MODIFY: existing tests use new selection API)
    ├── selection-state.test.ts                       (CREATE: range invariants, derivation, action semantics)
    └── move-focus.test.ts                            (CREATE: 2D focus moves, jump-to-edge, page moves)

packages/core/src/
├── types.ts                                          (MODIFY: re-export new types, update PretableGrid signature)
└── create-grid.ts                                    (MODIFY: forward new actions, drop selectRow / 1D moveFocus)

packages/react/src/
├── pretable-surface.tsx                              (MODIFY: callsite updates ONLY in Phase 1 — preserve existing
│                                                       single-row select behavior by mapping to new actions)
├── use-pretable.ts                                   (MODIFY: callsite updates ONLY in Phase 1)
└── (other files unchanged in Phase 1)

apps/website/app/components/heroGrid/
├── HeroGrid.tsx                                      (MODIFY: callsite updates ONLY)
└── (no checkbox column wiring yet — that lands in Phase 4)

apps/bench/src/
├── pretable-adapter.tsx                              (MODIFY: callsite updates if any selection wiring exists)
└── bench-runtime.ts                                  (no API change — its `interactionState` variable is unrelated to the React prop)
```

---

## Phase 1 — Engine State Foundation (FULLY DETAILED)

**Branch:** `b1-engine-state`. **Worktree:** `~/.worktrees/pretable-b1-engine-state`.

**Phase exit criteria:**

- New types exported from `@pretable-internal/grid-core` and re-exported from `@pretable/core` as documented in Architectural Notes.
- New actions implemented on `GridCoreStore`. Old `selectRow` and 1D `moveFocus(delta)` are **removed** (not aliased).
- All in-repo callsites compile against the new API. Existing behavior is preserved (single-row click still selects via `toggleRowSelection`; ArrowUp/Down still moves focus via `moveFocus("up" | "down")`).
- New unit tests cover range invariants under sort/filter, derivation, and 2D focus moves. Existing `grid-core.test.ts` tests still pass after migration.
- `pnpm -w typecheck` and `pnpm -w test` pass at repo root.
- One PR opened, CI green, merged.

### Worktree setup

- [ ] **Step 1.0.1: Create the worktree**

```bash
git worktree add -b b1-engine-state ~/.worktrees/pretable-b1-engine-state main
cd ~/.worktrees/pretable-b1-engine-state
```

Expected: a new directory at `~/.worktrees/pretable-b1-engine-state` checked out at `main`, on branch `b1-engine-state`.

- [ ] **Step 1.0.2: Verify clean state and install**

```bash
git status
pnpm install --frozen-lockfile
```

Expected: clean working tree; pnpm install completes with no errors.

### Task 1: Replace selection state types in `grid-core/types.ts`

**Files:**

- Modify: `packages/grid-core/src/types.ts`

- [ ] **Step 1.1.1: Add new cell-address and cell-range types; replace `GridCoreSelectionState`**

Open `packages/grid-core/src/types.ts`. Replace the existing `GridCoreSelectionState` interface (lines 32–35) with the address/range/selection trio:

```ts
export interface GridCoreCellAddress {
  rowId: string;
  columnId: string;
}

export interface GridCoreCellRange {
  startRowId: string;
  endRowId: string;
  startColumnId: string;
  endColumnId: string;
}

export interface GridCoreSelectionState {
  ranges: GridCoreCellRange[];
  anchor: GridCoreCellAddress | null;
}
```

The existing `GridCoreFocusState` interface stays as-is (already shaped `{ rowId, columnId }`).

- [ ] **Step 1.1.2: Add the focus-move direction enum and replace the `moveFocus` signature**

In the same file, append a `GridCoreFocusDirection` type and a `GridCoreMoveFocusOptions` interface, then update `GridCoreStore`'s `moveFocus` and `selectRow`/new selection actions:

```ts
export type GridCoreFocusDirection = "up" | "down" | "left" | "right";

export interface GridCoreMoveFocusOptions {
  extend?: boolean; // shift+arrow
  jumpToEdge?: boolean; // cmd/ctrl+arrow
  byPage?: boolean; // page up/down (only "up" or "down" direction)
}
```

Update the `GridCoreStore` interface to remove `selectRow` and the 1D `moveFocus`, and add the new selection/focus actions. Replace lines 80–82 (and the surrounding `selectRow` line) with:

```ts
  // selection actions
  setSelection(state: GridCoreSelectionState): void;
  selectAll(): void;
  clearSelection(): void;
  addRange(range: GridCoreCellRange): void;
  extendRangeFromAnchor(addr: GridCoreCellAddress): void;
  toggleRowSelection(rowId: string): void;
  setSelectAllVisible(checked: boolean): void;

  // focus actions
  setFocus(addr: GridCoreCellAddress | null): void;
  moveFocus(
    direction: GridCoreFocusDirection,
    options?: GridCoreMoveFocusOptions,
  ): void;
```

`setFocus` now takes a single `GridCoreCellAddress | null` instead of two arguments. This is a callsite-touching change handled in Tasks 6–8.

- [ ] **Step 1.1.3: Run typecheck — expect failures**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: errors in `create-grid-core.ts` because the implementation hasn't caught up with the type changes yet. This is the desired state before Task 2.

### Task 2: Implement new selection state + actions in `create-grid-core.ts`

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts`
- Create: `packages/grid-core/src/derived-selection.ts`

- [ ] **Step 1.2.1: Create `derived-selection.ts` with the row-derivation helper**

Create `packages/grid-core/src/derived-selection.ts`:

```ts
import type {
  GridCoreCellRange,
  GridCoreColumn,
  GridCoreRow,
  GridCoreRowModel,
  GridCoreSelectionState,
} from "./types";

export type RowSelectionTriState = "selected" | "indeterminate";

export function rangeContainsCell(
  range: GridCoreCellRange,
  rowId: string,
  columnId: string,
  rowOrder: ReadonlyMap<string, number>,
  columnOrder: ReadonlyMap<string, number>,
): boolean {
  const rowIdx = rowOrder.get(rowId);
  const startRowIdx = rowOrder.get(range.startRowId);
  const endRowIdx = rowOrder.get(range.endRowId);
  const colIdx = columnOrder.get(columnId);
  const startColIdx = columnOrder.get(range.startColumnId);
  const endColIdx = columnOrder.get(range.endColumnId);

  if (
    rowIdx === undefined ||
    startRowIdx === undefined ||
    endRowIdx === undefined ||
    colIdx === undefined ||
    startColIdx === undefined ||
    endColIdx === undefined
  ) {
    return false;
  }

  const [rowLo, rowHi] =
    startRowIdx <= endRowIdx
      ? [startRowIdx, endRowIdx]
      : [endRowIdx, startRowIdx];
  const [colLo, colHi] =
    startColIdx <= endColIdx
      ? [startColIdx, endColIdx]
      : [endColIdx, startColIdx];

  return (
    rowIdx >= rowLo && rowIdx <= rowHi && colIdx >= colLo && colIdx <= colHi
  );
}

export function deriveSelectedRows<TRow extends GridCoreRow>(args: {
  visibleRows: GridCoreRowModel<TRow>[];
  columns: GridCoreColumn<TRow>[];
  selection: GridCoreSelectionState;
}): Map<string, RowSelectionTriState> {
  const { visibleRows, columns, selection } = args;
  const result = new Map<string, RowSelectionTriState>();

  if (selection.ranges.length === 0 || columns.length === 0) {
    return result;
  }

  const rowOrder = new Map(visibleRows.map((r, i) => [r.id, i]));
  const columnOrder = new Map(columns.map((c, i) => [c.id, i]));

  for (const row of visibleRows) {
    let coveredCount = 0;

    for (const column of columns) {
      const inSome = selection.ranges.some((range) =>
        rangeContainsCell(range, row.id, column.id, rowOrder, columnOrder),
      );

      if (inSome) {
        coveredCount += 1;
      }
    }

    if (coveredCount === columns.length) {
      result.set(row.id, "selected");
    } else if (coveredCount > 0) {
      result.set(row.id, "indeterminate");
    }
  }

  return result;
}
```

- [ ] **Step 1.2.2: Replace selection state initialization and remove `selectRow`**

Open `packages/grid-core/src/create-grid-core.ts`. At line 71, replace the selection initializer:

```ts
let selection: GridCoreSelectionState = { ranges: [], anchor: null };
```

Delete the entire `selectRow` method (lines 149–160).

- [ ] **Step 1.2.3: Add the new selection actions**

In the same `store` object literal, add the following methods (placement: alphabetical-ish near the other selection-adjacent actions, before `setFocus`):

```ts
    setSelection(next: GridCoreSelectionState) {
      if (selectionsEqual(selection, next)) {
        return;
      }

      selection = {
        ranges: next.ranges.map((r) => ({ ...r })),
        anchor: next.anchor ? { ...next.anchor } : null,
      };
      emit();
    },
    selectAll() {
      const snapshot = getSnapshot();
      const firstRow = snapshot.visibleRows[0];
      const lastRow = snapshot.visibleRows[snapshot.visibleRows.length - 1];
      const firstColumn = options.columns[0];
      const lastColumn = options.columns[options.columns.length - 1];

      if (!firstRow || !lastRow || !firstColumn || !lastColumn) {
        return;
      }

      const range: GridCoreCellRange = {
        startRowId: firstRow.id,
        endRowId: lastRow.id,
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      };
      const anchor: GridCoreCellAddress = {
        rowId: firstRow.id,
        columnId: firstColumn.id,
      };

      const next: GridCoreSelectionState = { ranges: [range], anchor };

      if (selectionsEqual(selection, next)) {
        return;
      }

      selection = next;
      emit();
    },
    clearSelection() {
      const focusAddr = focus.rowId && focus.columnId
        ? { rowId: focus.rowId, columnId: focus.columnId }
        : null;
      const next: GridCoreSelectionState = focusAddr
        ? {
            ranges: [
              {
                startRowId: focusAddr.rowId,
                endRowId: focusAddr.rowId,
                startColumnId: focusAddr.columnId,
                endColumnId: focusAddr.columnId,
              },
            ],
            anchor: focusAddr,
          }
        : { ranges: [], anchor: null };

      if (selectionsEqual(selection, next)) {
        return;
      }

      selection = next;
      emit();
    },
    addRange(range: GridCoreCellRange) {
      selection = {
        ranges: [...selection.ranges, { ...range }],
        anchor: { rowId: range.startRowId, columnId: range.startColumnId },
      };
      emit();
    },
    extendRangeFromAnchor(addr: GridCoreCellAddress) {
      if (!selection.anchor) {
        return;
      }

      const newActive: GridCoreCellRange = {
        startRowId: selection.anchor.rowId,
        endRowId: addr.rowId,
        startColumnId: selection.anchor.columnId,
        endColumnId: addr.columnId,
      };

      const ranges =
        selection.ranges.length === 0
          ? [newActive]
          : [...selection.ranges.slice(0, -1), newActive];

      selection = { ranges, anchor: selection.anchor };
      emit();
    },
    toggleRowSelection(rowId: string) {
      const firstColumn = options.columns[0];
      const lastColumn = options.columns[options.columns.length - 1];

      if (!firstColumn || !lastColumn) {
        return;
      }

      const fullRowRange: GridCoreCellRange = {
        startRowId: rowId,
        endRowId: rowId,
        startColumnId: firstColumn.id,
        endColumnId: lastColumn.id,
      };

      const matchIndex = selection.ranges.findIndex((r) =>
        isFullRowRange(r, rowId, firstColumn.id, lastColumn.id),
      );

      if (matchIndex >= 0) {
        const ranges = selection.ranges.filter((_, i) => i !== matchIndex);
        selection = { ranges, anchor: selection.anchor };
      } else {
        selection = {
          ranges: [...selection.ranges, fullRowRange],
          anchor: { rowId, columnId: firstColumn.id },
        };
      }

      emit();
    },
    setSelectAllVisible(checked: boolean) {
      const snapshot = getSnapshot();
      const firstColumn = options.columns[0];
      const lastColumn = options.columns[options.columns.length - 1];

      if (!firstColumn || !lastColumn) {
        return;
      }

      const visibleIds = new Set(snapshot.visibleRows.map((r) => r.id));
      const nonRowRanges = selection.ranges.filter(
        (r) =>
          !isFullRowRange(r, r.startRowId, firstColumn.id, lastColumn.id) ||
          !visibleIds.has(r.startRowId),
      );

      if (checked) {
        const newRanges = snapshot.visibleRows.map<GridCoreCellRange>((row) => ({
          startRowId: row.id,
          endRowId: row.id,
          startColumnId: firstColumn.id,
          endColumnId: lastColumn.id,
        }));

        selection = {
          ranges: [...nonRowRanges, ...newRanges],
          anchor:
            snapshot.visibleRows[0]
              ? { rowId: snapshot.visibleRows[0].id, columnId: firstColumn.id }
              : selection.anchor,
        };
      } else {
        selection = { ranges: nonRowRanges, anchor: selection.anchor };
      }

      emit();
    },
```

Helpers at the bottom of the file (alongside `clamp` and `filtersEqual`):

```ts
function isFullRowRange(
  range: GridCoreCellRange,
  rowId: string,
  firstColumnId: string,
  lastColumnId: string,
): boolean {
  return (
    range.startRowId === rowId &&
    range.endRowId === rowId &&
    range.startColumnId === firstColumnId &&
    range.endColumnId === lastColumnId
  );
}

function selectionsEqual(
  a: GridCoreSelectionState,
  b: GridCoreSelectionState,
): boolean {
  if (a.ranges.length !== b.ranges.length) {
    return false;
  }

  for (let i = 0; i < a.ranges.length; i += 1) {
    const ar = a.ranges[i]!;
    const br = b.ranges[i]!;

    if (
      ar.startRowId !== br.startRowId ||
      ar.endRowId !== br.endRowId ||
      ar.startColumnId !== br.startColumnId ||
      ar.endColumnId !== br.endColumnId
    ) {
      return false;
    }
  }

  if (a.anchor === null && b.anchor === null) {
    return true;
  }

  if (a.anchor === null || b.anchor === null) {
    return false;
  }

  return (
    a.anchor.rowId === b.anchor.rowId && a.anchor.columnId === b.anchor.columnId
  );
}
```

- [ ] **Step 1.2.4: Replace `setFocus` to take a single address**

Replace the existing `setFocus` (lines 161–168) with:

```ts
    setFocus(addr: GridCoreCellAddress | null) {
      const nextRowId = addr?.rowId ?? null;
      const nextColumnId = addr?.columnId ?? null;

      if (focus.rowId === nextRowId && focus.columnId === nextColumnId) {
        return;
      }

      focus = { rowId: nextRowId, columnId: nextColumnId };
      emit();
    },
```

- [ ] **Step 1.2.5: Replace `moveFocus` with the 2D version**

Replace the existing `moveFocus` (lines 169–195) with:

```ts
    moveFocus(
      direction: GridCoreFocusDirection,
      moveOptions: GridCoreMoveFocusOptions = {},
    ) {
      const snapshot = getSnapshot();
      const visibleRows = snapshot.visibleRows;
      const columnList = options.columns;

      if (visibleRows.length === 0 || columnList.length === 0) {
        focus = { rowId: null, columnId: null };
        emit();
        return;
      }

      const currentRowIndex = focus.rowId
        ? visibleRows.findIndex((r) => r.id === focus.rowId)
        : -1;
      const currentColumnIndex = focus.columnId
        ? columnList.findIndex((c) => c.id === focus.columnId)
        : -1;

      const baseRowIndex = currentRowIndex === -1 ? 0 : currentRowIndex;
      const baseColumnIndex = currentColumnIndex === -1 ? 0 : currentColumnIndex;

      let nextRowIndex = baseRowIndex;
      let nextColumnIndex = baseColumnIndex;

      const pageStep = computePageStep(viewport, visibleRows);

      switch (direction) {
        case "up":
          if (moveOptions.jumpToEdge) {
            nextRowIndex = 0;
          } else if (moveOptions.byPage) {
            nextRowIndex = clamp(baseRowIndex - pageStep, 0, visibleRows.length - 1);
          } else {
            nextRowIndex = clamp(baseRowIndex - 1, 0, visibleRows.length - 1);
          }
          break;
        case "down":
          if (moveOptions.jumpToEdge) {
            nextRowIndex = visibleRows.length - 1;
          } else if (moveOptions.byPage) {
            nextRowIndex = clamp(baseRowIndex + pageStep, 0, visibleRows.length - 1);
          } else {
            nextRowIndex = clamp(baseRowIndex + 1, 0, visibleRows.length - 1);
          }
          break;
        case "left":
          nextColumnIndex = moveOptions.jumpToEdge
            ? 0
            : clamp(baseColumnIndex - 1, 0, columnList.length - 1);
          break;
        case "right":
          nextColumnIndex = moveOptions.jumpToEdge
            ? columnList.length - 1
            : clamp(baseColumnIndex + 1, 0, columnList.length - 1);
          break;
      }

      const nextRow = visibleRows[nextRowIndex];
      const nextColumn = columnList[nextColumnIndex];

      if (!nextRow || !nextColumn) {
        return;
      }

      const nextAddr: GridCoreCellAddress = {
        rowId: nextRow.id,
        columnId: nextColumn.id,
      };

      focus = nextAddr;

      if (moveOptions.extend) {
        if (!selection.anchor) {
          selection = {
            ranges: [
              {
                startRowId: nextAddr.rowId,
                endRowId: nextAddr.rowId,
                startColumnId: nextAddr.columnId,
                endColumnId: nextAddr.columnId,
              },
            ],
            anchor: nextAddr,
          };
        } else {
          const newActive: GridCoreCellRange = {
            startRowId: selection.anchor.rowId,
            endRowId: nextAddr.rowId,
            startColumnId: selection.anchor.columnId,
            endColumnId: nextAddr.columnId,
          };
          const ranges =
            selection.ranges.length === 0
              ? [newActive]
              : [...selection.ranges.slice(0, -1), newActive];
          selection = { ranges, anchor: selection.anchor };
        }
      } else {
        selection = {
          ranges: [
            {
              startRowId: nextAddr.rowId,
              endRowId: nextAddr.rowId,
              startColumnId: nextAddr.columnId,
              endColumnId: nextAddr.columnId,
            },
          ],
          anchor: nextAddr,
        };
      }

      emit();
    },
```

Add the page-step helper at the bottom of the file:

```ts
function computePageStep<TRow extends GridCoreRow>(
  viewport: { height: number },
  visibleRows: GridCoreRowModel<TRow>[],
): number {
  if (viewport.height <= 0 || visibleRows.length === 0) {
    return 1;
  }

  // Approximate: assume rows averaging the viewport height / 20 pages
  // is too generous; use 80% of viewport height divided by an estimate
  // of 32px per row. The React surface will replace this with a more
  // accurate row-height estimate in Phase 2.
  const estimatedRowsPerPage = Math.max(
    1,
    Math.floor((viewport.height * 0.8) / 32),
  );

  return Math.min(estimatedRowsPerPage, visibleRows.length);
}
```

- [ ] **Step 1.2.6: Update the snapshot's selection clone**

Inside `getSnapshot()` (around line 308), replace the selection clone:

```ts
      selection: {
        ranges: selection.ranges.map((r) => ({ ...r })),
        anchor: selection.anchor ? { ...selection.anchor } : null,
      },
```

- [ ] **Step 1.2.7: Run typecheck — expect grid-core to pass, callers to fail**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: passes. The callers in `@pretable/core`, `@pretable/react`, and apps will still fail typecheck — Tasks 5–8 fix those.

- [ ] **Step 1.2.8: Commit**

```bash
git add packages/grid-core/src/types.ts packages/grid-core/src/create-grid-core.ts packages/grid-core/src/derived-selection.ts
git commit -m "feat(grid-core): replace selection state with cell-range model

Replaces { rowIds, anchorRowId } with { ranges: GridCoreCellRange[],
anchor: GridCoreCellAddress | null }. Adds setSelection, selectAll,
clearSelection, addRange, extendRangeFromAnchor, toggleRowSelection,
setSelectAllVisible. Generalizes moveFocus to 2D with extend/jumpToEdge/
byPage options. Removes selectRow and the 1D moveFocus.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 3: Export new types from `grid-core/index.ts`

**Files:**

- Modify: `packages/grid-core/src/index.ts`

- [ ] **Step 1.3.1: Add new type exports**

Replace `packages/grid-core/src/index.ts` with:

```ts
export { createGridCore } from "./create-grid-core";
export {
  deriveSelectedRows,
  rangeContainsCell,
  type RowSelectionTriState,
} from "./derived-selection";
export type {
  GridCoreCellAddress,
  GridCoreCellRange,
  GridCoreColumn,
  GridCoreFocusDirection,
  GridCoreFocusState,
  GridCoreFrame,
  GridCoreMoveFocusOptions,
  GridCoreOptions,
  GridCoreRow,
  GridCoreRowModel,
  GridCoreSelectionState,
  GridCoreSnapshot,
  GridCoreSortDirection,
  GridCoreSortState,
  GridCoreStore,
  GridCoreTransaction,
  GridCoreViewportState,
} from "./types";
export type { AutosizeOptions } from "@pretable-internal/layout-core";
```

- [ ] **Step 1.3.2: Run typecheck**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: passes.

- [ ] **Step 1.3.3: Commit**

```bash
git add packages/grid-core/src/index.ts
git commit -m "feat(grid-core): export new selection + focus types

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4: Migrate existing `grid-core.test.ts` and add new test files

**Files:**

- Modify: `packages/grid-core/src/__tests__/grid-core.test.ts`
- Create: `packages/grid-core/src/__tests__/selection-state.test.ts`
- Create: `packages/grid-core/src/__tests__/move-focus.test.ts`

- [ ] **Step 1.4.1: Migrate the two existing tests that call `selectRow`**

In `packages/grid-core/src/__tests__/grid-core.test.ts`, replace `grid.selectRow("b")` with `grid.toggleRowSelection("b")` and replace the assertion `expect(snapshot.selection.rowIds).toEqual(["b"])` with the new shape:

```ts
expect(snapshot.selection.ranges).toEqual([
  {
    startRowId: "b",
    endRowId: "b",
    startColumnId: "name",
    endColumnId: "message",
  },
]);
```

Apply the same change at line ~49 (`grid.selectRow("c")`) and update its assertion analogously (`startRowId: "c"`, `endRowId: "c"`, etc.).

- [ ] **Step 1.4.2: Run the existing test file**

```bash
pnpm --filter @pretable-internal/grid-core test grid-core.test
```

Expected: passes.

- [ ] **Step 1.4.3: Create `selection-state.test.ts` with the failing tests first**

```ts
// packages/grid-core/src/__tests__/selection-state.test.ts
import { describe, expect, test } from "vitest";

import {
  createGridCore,
  deriveSelectedRows,
  type GridCoreCellRange,
} from "../index";

interface DemoRow {
  id: string;
  name: string;
  status: string;
  message: string;
}

const columns = [
  { id: "name", header: "Name" },
  { id: "status", header: "Status" },
  { id: "message", header: "Message" },
] as const;

const rows: DemoRow[] = [
  { id: "a", name: "Apple", status: "open", message: "alpha" },
  { id: "b", name: "Bravo", status: "open", message: "beta" },
  { id: "c", name: "Cargo", status: "closed", message: "gamma" },
];

function makeGrid() {
  return createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
  });
}

describe("selection state", () => {
  test("default state is empty ranges and null anchor", () => {
    const grid = makeGrid();
    const snapshot = grid.getSnapshot();

    expect(snapshot.selection.ranges).toEqual([]);
    expect(snapshot.selection.anchor).toBeNull();
  });

  test("setSelection replaces ranges and anchor", () => {
    const grid = makeGrid();
    const range: GridCoreCellRange = {
      startRowId: "a",
      endRowId: "b",
      startColumnId: "name",
      endColumnId: "status",
    };

    grid.setSelection({
      ranges: [range],
      anchor: { rowId: "a", columnId: "name" },
    });

    expect(grid.getSnapshot().selection.ranges).toEqual([range]);
    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "a",
      columnId: "name",
    });
  });

  test("selectAll spans every row and every column", () => {
    const grid = makeGrid();

    grid.selectAll();

    const { ranges, anchor } = grid.getSnapshot().selection;
    expect(ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "c",
        startColumnId: "name",
        endColumnId: "message",
      },
    ]);
    expect(anchor).toEqual({ rowId: "a", columnId: "name" });
  });

  test("clearSelection collapses to focused cell", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "b", columnId: "status" });
    grid.selectAll();

    grid.clearSelection();

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "status",
        endColumnId: "status",
      },
    ]);
    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "b",
      columnId: "status",
    });
  });

  test("addRange appends and updates anchor to range start", () => {
    const grid = makeGrid();
    const r1: GridCoreCellRange = {
      startRowId: "a",
      endRowId: "a",
      startColumnId: "name",
      endColumnId: "name",
    };
    const r2: GridCoreCellRange = {
      startRowId: "c",
      endRowId: "c",
      startColumnId: "message",
      endColumnId: "message",
    };

    grid.addRange(r1);
    grid.addRange(r2);

    expect(grid.getSnapshot().selection.ranges).toEqual([r1, r2]);
    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "c",
      columnId: "message",
    });
  });

  test("extendRangeFromAnchor replaces the active range", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "a",
          endRowId: "a",
          startColumnId: "name",
          endColumnId: "name",
        },
      ],
      anchor: { rowId: "a", columnId: "name" },
    });

    grid.extendRangeFromAnchor({ rowId: "c", columnId: "status" });

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "c",
        startColumnId: "name",
        endColumnId: "status",
      },
    ]);
    expect(grid.getSnapshot().selection.anchor).toEqual({
      rowId: "a",
      columnId: "name",
    });
  });

  test("toggleRowSelection adds and removes a full-row range", () => {
    const grid = makeGrid();

    grid.toggleRowSelection("b");
    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "name",
        endColumnId: "message",
      },
    ]);

    grid.toggleRowSelection("b");
    expect(grid.getSnapshot().selection.ranges).toEqual([]);
  });

  test("setSelectAllVisible(true) creates one full-row range per visible row", () => {
    const grid = makeGrid();
    grid.setFilter("status", "open");

    grid.setSelectAllVisible(true);

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "a",
        startColumnId: "name",
        endColumnId: "message",
      },
      {
        startRowId: "b",
        endRowId: "b",
        startColumnId: "name",
        endColumnId: "message",
      },
    ]);
  });

  test("ranges survive sort: stored IDs do not move", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "a",
          endRowId: "b",
          startColumnId: "name",
          endColumnId: "status",
        },
      ],
      anchor: { rowId: "a", columnId: "name" },
    });

    grid.setSort("name", "desc");

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "a",
        endRowId: "b",
        startColumnId: "name",
        endColumnId: "status",
      },
    ]);
  });

  test("filtered-out row in range stays in state but contributes no derived selection", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "c",
          endRowId: "c",
          startColumnId: "name",
          endColumnId: "message",
        },
      ],
      anchor: { rowId: "c", columnId: "name" },
    });

    grid.setFilter("status", "open");

    expect(grid.getSnapshot().selection.ranges).toEqual([
      {
        startRowId: "c",
        endRowId: "c",
        startColumnId: "name",
        endColumnId: "message",
      },
    ]);

    const derived = deriveSelectedRows({
      visibleRows: grid.getSnapshot().visibleRows,
      columns: [...columns],
      selection: grid.getSnapshot().selection,
    });

    expect(derived.size).toBe(0);
  });

  test("derived rows: full-row range yields 'selected'", () => {
    const grid = makeGrid();
    grid.toggleRowSelection("b");

    const derived = deriveSelectedRows({
      visibleRows: grid.getSnapshot().visibleRows,
      columns: [...columns],
      selection: grid.getSnapshot().selection,
    });

    expect(derived.get("b")).toBe("selected");
    expect(derived.size).toBe(1);
  });

  test("derived rows: partial-row range yields 'indeterminate'", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "b",
          endRowId: "b",
          startColumnId: "name",
          endColumnId: "status",
        },
      ],
      anchor: { rowId: "b", columnId: "name" },
    });

    const derived = deriveSelectedRows({
      visibleRows: grid.getSnapshot().visibleRows,
      columns: [...columns],
      selection: grid.getSnapshot().selection,
    });

    expect(derived.get("b")).toBe("indeterminate");
  });
});
```

- [ ] **Step 1.4.4: Run the new selection-state tests**

```bash
pnpm --filter @pretable-internal/grid-core test selection-state.test
```

Expected: all tests PASS.

- [ ] **Step 1.4.5: Create `move-focus.test.ts`**

```ts
// packages/grid-core/src/__tests__/move-focus.test.ts
import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

const columns = [
  { id: "c1", header: "C1" },
  { id: "c2", header: "C2" },
  { id: "c3", header: "C3" },
] as const;

const rows = [{ id: "r1" }, { id: "r2" }, { id: "r3" }, { id: "r4" }];

function makeGrid() {
  return createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id,
  });
}

describe("moveFocus", () => {
  test("from null focus, 'down' lands on first cell", () => {
    const grid = makeGrid();

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r1", columnId: "c1" });
  });

  test("'right' moves focus one column right", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r1", columnId: "c1" });

    grid.moveFocus("right");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r1", columnId: "c2" });
  });

  test("'left' at first column does not move", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r2", columnId: "c1" });

    grid.moveFocus("left");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r2", columnId: "c1" });
  });

  test("'down' at last row does not move", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r4", columnId: "c2" });

    grid.moveFocus("down");

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r4", columnId: "c2" });
  });

  test("jumpToEdge 'down' goes to last row", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r1", columnId: "c2" });

    grid.moveFocus("down", { jumpToEdge: true });

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r4", columnId: "c2" });
  });

  test("jumpToEdge 'right' goes to last column", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r1", columnId: "c1" });

    grid.moveFocus("right", { jumpToEdge: true });

    expect(grid.getSnapshot().focus).toEqual({ rowId: "r1", columnId: "c3" });
  });

  test("extend collapses to focus when no anchor exists", () => {
    const grid = makeGrid();
    grid.setFocus({ rowId: "r1", columnId: "c1" });

    grid.moveFocus("down", { extend: true });

    const { ranges, anchor } = grid.getSnapshot().selection;
    expect(ranges).toEqual([
      {
        startRowId: "r2",
        endRowId: "r2",
        startColumnId: "c1",
        endColumnId: "c1",
      },
    ]);
    expect(anchor).toEqual({ rowId: "r2", columnId: "c1" });
  });

  test("extend with existing anchor extends active range", () => {
    const grid = makeGrid();
    grid.setSelection({
      ranges: [
        {
          startRowId: "r1",
          endRowId: "r1",
          startColumnId: "c1",
          endColumnId: "c1",
        },
      ],
      anchor: { rowId: "r1", columnId: "c1" },
    });
    grid.setFocus({ rowId: "r1", columnId: "c1" });

    grid.moveFocus("down", { extend: true });
    grid.moveFocus("right", { extend: true });

    const { ranges, anchor } = grid.getSnapshot().selection;
    expect(ranges).toEqual([
      {
        startRowId: "r1",
        endRowId: "r2",
        startColumnId: "c1",
        endColumnId: "c2",
      },
    ]);
    expect(anchor).toEqual({ rowId: "r1", columnId: "c1" });
  });

  test("non-extend movement collapses ranges to single focused cell", () => {
    const grid = makeGrid();
    grid.selectAll();

    grid.moveFocus("right");

    const { ranges } = grid.getSnapshot().selection;
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({
      startRowId: "r1",
      endRowId: "r1",
      startColumnId: "c2",
      endColumnId: "c2",
    });
  });
});
```

- [ ] **Step 1.4.6: Run move-focus tests**

```bash
pnpm --filter @pretable-internal/grid-core test move-focus.test
```

Expected: all tests PASS.

- [ ] **Step 1.4.7: Run the full grid-core test suite**

```bash
pnpm --filter @pretable-internal/grid-core test
```

Expected: all three test files pass (`grid-core.test.ts`, `selection-state.test.ts`, `move-focus.test.ts`).

- [ ] **Step 1.4.8: Commit**

```bash
git add packages/grid-core/src/__tests__/grid-core.test.ts packages/grid-core/src/__tests__/selection-state.test.ts packages/grid-core/src/__tests__/move-focus.test.ts
git commit -m "test(grid-core): selection state + 2D moveFocus coverage

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 5: Update `@pretable/core` facade and re-exports

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/create-grid.ts`

- [ ] **Step 1.5.1: Update `packages/core/src/types.ts` to re-export new types**

Open `packages/core/src/types.ts`. Update the type re-export block at lines 1–10 to include the new types and keep the public-name aliasing:

```ts
export type {
  GridCoreCellAddress as PretableCellAddress,
  GridCoreCellRange as PretableCellRange,
  GridCoreFocusDirection as PretableFocusDirection,
  GridCoreFocusState as PretableFocusState,
  GridCoreMoveFocusOptions as PretableMoveFocusOptions,
  GridCoreRowModel as PretableVisibleRow,
  GridCoreSelectionState as PretableSelectionState,
  GridCoreSnapshot as PretableGridSnapshot,
  GridCoreSortDirection as PretableSortDirection,
  GridCoreSortState as PretableSortState,
  GridCoreViewportState as PretableViewportState,
} from "@pretable-internal/grid-core";
```

- [ ] **Step 1.5.2: Update `PretableGrid` interface to expose new actions and drop `selectRow`**

In the same file, update the `PretableGrid` interface to forward the new actions. Replace the body of the interface (around lines 30–39) with:

```ts
export interface PretableGrid<
  TRow extends PretableRow = PretableRow,
> extends Omit<GridCoreStore<TRow>, "options"> {
  kind: "pretable-grid";
  options: PretableGridOptions<TRow>;
  getSnapshot(): GridCoreSnapshot<TRow>;
  setSort(columnId: string | null, direction: GridCoreSortDirection): void;
  autosizeColumns(options?: AutosizeOptions): void;
  applyTransaction(transaction: PretableTransaction<TRow>): void;
}
```

`Omit<GridCoreStore<TRow>, "options">` already inherits all the new selection/focus actions from `GridCoreStore`. The explicit re-declarations of `getSnapshot`, `setSort`, etc. are kept for documentation and for the existing public type signature. No additional explicit forwards are needed because `Omit` carries them through.

- [ ] **Step 1.5.3: Update `packages/core/src/create-grid.ts` to drop the explicit `selectRow` / `moveFocus` forwards if mismatched**

Open `packages/core/src/create-grid.ts`. The current explicit forwards at lines 21–23 are:

```ts
    selectRow: gridCore.selectRow,
    setFocus: gridCore.setFocus,
    moveFocus: gridCore.moveFocus,
```

Replace those three lines with explicit forwards for the new action set:

```ts
    setSelection: gridCore.setSelection,
    selectAll: gridCore.selectAll,
    clearSelection: gridCore.clearSelection,
    addRange: gridCore.addRange,
    extendRangeFromAnchor: gridCore.extendRangeFromAnchor,
    toggleRowSelection: gridCore.toggleRowSelection,
    setSelectAllVisible: gridCore.setSelectAllVisible,
    setFocus: gridCore.setFocus,
    moveFocus: gridCore.moveFocus,
```

- [ ] **Step 1.5.4: Typecheck `@pretable/core`**

```bash
pnpm --filter @pretable/core typecheck
```

Expected: passes.

- [ ] **Step 1.5.5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/create-grid.ts
git commit -m "feat(core): re-export new selection types and forward new actions

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 6: Update `@pretable/react` callsites (preserve existing behavior)

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx`
- Modify: `packages/react/src/use-pretable.ts`

This task does **not** add new features. It updates existing callers to compile against the new API while preserving the current single-row click + ArrowUp/Down behavior. New keyboard nav and click semantics ship in Phases 2 and 3.

- [ ] **Step 1.6.1: Update `pretable-surface.tsx` keyboard handler**

In `packages/react/src/pretable-surface.tsx`, locate the keyboard handler around lines 304–335. Replace the existing logic with:

```tsx
// Phase 1: preserve current behavior — ArrowUp/Down moves focus, Enter toggles row select.
// Phase 2 will replace this with the full keyboard contract.
if (event.key === "ArrowDown" || event.key === "ArrowUp") {
  event.preventDefault();
  grid.moveFocus(event.key === "ArrowDown" ? "down" : "up");
} else if (event.key === "Home" || event.key === "End") {
  // existing Home/End logic kept; update to new setFocus signature
  const nextFocus = grid.getSnapshot().focus;
  if (columns[0] && nextFocus.rowId) {
    grid.setFocus({ rowId: nextFocus.rowId, columnId: columns[0].id });
  }
} else if (event.key === "Enter" || event.key === " ") {
  event.preventDefault();
  const focusedRowId = grid.getSnapshot().focus.rowId;
  if (focusedRowId) {
    grid.toggleRowSelection(focusedRowId);
  }
}
```

(Where the existing logic differs from the snippet above, prefer the snippet — the goal is to compile with the new API while keeping ArrowUp/Down and Enter doing the same user-visible thing.)

- [ ] **Step 1.6.2: Update the click-to-select callsite (around lines 480–485)**

Find the row-click handler that currently calls `grid.setFocus(id, columns[0]?.id ?? null); grid.selectRow(id);`. Replace with:

```tsx
grid.setFocus({ rowId: id, columnId: columns[0]?.id ?? null });
grid.toggleRowSelection(id);
```

`toggleRowSelection` differs from `selectRow(id)` in that clicking a selected row deselects it. For Phase 1 we keep the existing user-visible behavior by only calling `toggleRowSelection` when the row is **not** already selected. Wrap the call:

```tsx
grid.setFocus({ rowId: id, columnId: columns[0]?.id ?? null });
const snapshot = grid.getSnapshot();
const alreadySelected = snapshot.selection.ranges.some(
  (r) =>
    r.startRowId === id &&
    r.endRowId === id &&
    r.startColumnId === columns[0]?.id &&
    r.endColumnId === columns[columns.length - 1]?.id,
);
if (!alreadySelected) {
  // Replace any existing selection with this row.
  if (columns[0] && columns[columns.length - 1]) {
    grid.setSelection({
      ranges: [
        {
          startRowId: id,
          endRowId: id,
          startColumnId: columns[0].id,
          endColumnId: columns[columns.length - 1].id,
        },
      ],
      anchor: { rowId: id, columnId: columns[0].id },
    });
  }
}
```

This faithfully reproduces the old `selectRow` behavior (single-row replace; clicking the same row again is a no-op).

- [ ] **Step 1.6.3: Update `use-pretable.ts` interactionOverrides**

In `packages/react/src/use-pretable.ts`, locate `interactionOverrides` (around lines 110–125). Find the call sites that use `grid.setFocus(rowId, columnId)` and `grid.selectRow(...)`.

Update the `setFocus` call:

```ts
grid.setFocus(
  interactionOverrides.focusedRowId !== undefined
    ? {
        rowId: interactionOverrides.focusedRowId,
        columnId: grid.getSnapshot().focus.columnId,
      }
    : null,
);
```

Replace the `selectRow` call:

```ts
const selectedRowId = interactionOverrides.selectedRowId;
if (selectedRowId === null) {
  grid.setSelection({ ranges: [], anchor: null });
} else if (selectedRowId !== undefined) {
  const cols = grid.options.columns;
  if (cols[0] && cols[cols.length - 1]) {
    grid.setSelection({
      ranges: [
        {
          startRowId: selectedRowId,
          endRowId: selectedRowId,
          startColumnId: cols[0].id,
          endColumnId: cols[cols.length - 1].id,
        },
      ],
      anchor: { rowId: selectedRowId, columnId: cols[0].id },
    });
  }
}
```

- [ ] **Step 1.6.4: Typecheck and run react tests**

```bash
pnpm --filter @pretable/react typecheck
pnpm --filter @pretable/react test
```

Expected: typecheck passes; existing tests pass (no behavior change for single-row select / ArrowUp-Down).

- [ ] **Step 1.6.5: Commit**

```bash
git add packages/react/src/pretable-surface.tsx packages/react/src/use-pretable.ts
git commit -m "refactor(react): adopt new selection API while preserving Phase 1 behavior

Replaces selectRow / 1D moveFocus call sites with toggleRowSelection /
2D moveFocus equivalents. User-visible behavior is unchanged in this
phase — full keyboard contract and cell-range click semantics land in
Phases 2 and 3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 7: Update bench adapter (if it touches selection)

**Files:**

- Inspect: `apps/bench/src/pretable-adapter.tsx`

- [ ] **Step 1.7.1: Search for any selection/focus calls in bench**

```bash
grep -n "selectRow\|moveFocus\|setFocus" apps/bench/src/*.tsx apps/bench/src/*.ts 2>/dev/null
```

Expected: no matches **other than** the comparator adapter wiring (TanStack/AG Grid/MUI handlers, which use their own per-grid APIs and do not touch `@pretable/*`). If matches appear in `pretable-adapter.tsx`, update them as in Task 6.

- [ ] **Step 1.7.2: Run bench typecheck**

```bash
pnpm --filter @pretable-internal/app-bench typecheck
```

Expected: passes.

- [ ] **Step 1.7.3: Commit (only if changes were needed)**

If Step 1.7.1 produced no matches in pretable-adapter.tsx, there is nothing to commit for this task.

### Task 8: Update website hero demo callsites

**Files:**

- Inspect: `apps/website/app/components/heroGrid/HeroGrid.tsx`
- Modify (if needed): the same file

- [ ] **Step 1.8.1: Search for selection/focus calls in the hero demo**

```bash
grep -rn "selectRow\|moveFocus\|setFocus\|interactionState" apps/website/app/components/heroGrid 2>/dev/null
```

If matches exist, update each one following the patterns in Task 6 (toggleRowSelection / 2D moveFocus / setFocus with address). Be especially careful with `interactionState` — Phase 2 renames the prop to `state`; for Phase 1 leave the prop name alone if it appears (the rename happens in Phase 2 across the whole repo).

- [ ] **Step 1.8.2: Typecheck the website**

```bash
pnpm --filter @pretable/app-website typecheck
```

Expected: passes.

- [ ] **Step 1.8.3: Run website tests**

```bash
pnpm --filter @pretable/app-website test
```

Expected: passes (no behavior change in the hero demo).

- [ ] **Step 1.8.4: Commit (only if changes were needed)**

```bash
git add apps/website/app/components/heroGrid/
git commit -m "refactor(website): adopt new selection API in hero demo

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 9: Repo-wide checks before opening PR

- [ ] **Step 1.9.1: Run the full repo typecheck**

```bash
pnpm -w typecheck
```

Expected: passes.

- [ ] **Step 1.9.2: Run the full repo test suite**

```bash
pnpm -w test
```

Expected: passes.

- [ ] **Step 1.9.3: Run lint**

```bash
pnpm -w lint
```

Expected: passes.

- [ ] **Step 1.9.4: Push the branch and open PR**

```bash
git push -u origin b1-engine-state
gh pr create --title "feat(grid-core): cell-range selection state foundation (Phase 1 of B)" --body "$(cat <<'EOF'
## Summary

Phase 1 of sub-project B (selection + keyboard navigation) per the spec:
docs/superpowers/specs/2026-05-05-selection-keyboard-nav-design.md

Replaces the row-id-based selection state with a cell-range model
keyed by stable IDs. Generalizes \`moveFocus\` to 2D with
extend/jumpToEdge/byPage options. Removes the old \`selectRow\` and
1D \`moveFocus\` APIs.

User-visible behavior is unchanged in this phase. Phase 2 wires the
full keyboard contract and renames the \`interactionState\` prop to
\`state\`. Phase 3 wires cell-range click semantics.

## Test plan

- [x] grid-core unit tests: selection-state.test.ts, move-focus.test.ts
- [x] existing grid-core.test.ts migrated and passing
- [x] @pretable/core typechecks
- [x] @pretable/react typechecks; existing tests pass
- [x] bench / website typechecks
- [x] repo-wide pnpm -w typecheck / test / lint pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens; CI starts.

- [ ] **Step 1.9.5: Wait for CI green, then notify the user (do NOT merge)**

Per the standing workflow preference, the user merges the PR. Notify with the PR URL once CI is green.

---

## Phase 2 — React adapter: keyboard nav + `state` prop rename (DETAILED)

**Branch:** `b2-keyboard-nav`. **Worktree:** `.worktrees/b2-keyboard-nav` (project-local convention).

**Phase exit criteria:**

- The `interactionState` prop is renamed to `state` on every public surface (`usePretable`, `usePretableModel`, `Pretable`, `PretableSurface`, `InspectionGrid`, `LabeledGridSurface`). The shape is the slice-based form `{ sort?, filters?, selection?, focus? }`. All in-repo callsites (bench adapter, hero demo, tests) updated. No alias.
- `onSelectionChange` and `onFocusChange` callbacks fire on engine-driven mutations (keyboard, click) when in controlled mode AND in uncontrolled mode (the existing `onSortChange` pattern).
- `<PretableSurface>`'s keyboard handler implements the full keyboard contract from the spec, with `tabBehavior` configurable.
- ARIA: single tab stop, `role="grid"`/`aria-multiselectable="true"`/`aria-rowcount`/`aria-colcount` on root, `role="row"` + `aria-rowindex` on rows, `role="gridcell"` + `aria-colindex` + `tabIndex={isFocused ? 0 : -1}` + `aria-selected` on cells.
- jsdom tests cover every key in the contract, plus controlled-mode round-trips for selection and focus.
- `pnpm -w typecheck` / `pnpm -w test` / `pnpm -w lint` clean.
- One PR opened, CI green, merged on green by user.

### Bench plan compatibility

The bench's `apps/bench/src/interaction-plan.ts` uses `{ focusedRowId, selectedRowId }` shape internally for plan replay (and stores them in JSONL plans). To avoid regenerating bench plan files, the **bench adapter** (`apps/bench/src/pretable-adapter.tsx`) translates its plan format to the new `state` prop shape at injection time. The bench plan format itself is unchanged.

### Resolved open questions (from the outline)

- **PageUp/Down step accuracy:** the React surface measures the actual rendered row count in the body viewport (count of currently-rendered `<div data-pretable-row>` elements that fit in `bodyViewportHeight`) and passes that as `byPage` is now interpreted as "the surface owns the step." We pass the surface's measured page-step value to a new `moveFocus` invocation pattern: the surface calls `grid.setFocus({...})` directly with the computed target rather than relying on `byPage`. This keeps the engine's `computePageStep` heuristic as a fallback for non-React consumers.
- **Tab when `tabBehavior: "exit"`:** the surface does not call `event.preventDefault()`. The browser's default Tab behavior advances focus to the next tabbable element on the page.
- **Programmatic focus follow:** when the focused cell address changes (either by user action or by controlled-mode prop change), the surface calls `cellElement.focus()` on the matching cell DOM node inside a `useLayoutEffect`. No `requestAnimationFrame` — `useLayoutEffect` already runs synchronously after DOM updates, before paint.

### Worktree setup

- [ ] **Step 2.0.1: Create the worktree** (already done at `.worktrees/b2-keyboard-nav`)
- [ ] **Step 2.0.2: Verify clean baseline** — `pnpm --filter @pretable/react test` shows 51 passing tests on Phase 1 main.

### Task 1 — Rename `interactionState` → `state` and restructure to slice-based shape

**Files modified:**

- `packages/react/src/use-pretable.ts` — rename `interactionOverrides` → `state` on `UsePretableModelOptions`. Restructure `PretableInteractionOverrides` to the new `{ sort?, filters?, selection?, focus? }` shape. The `selectedRowId` / `focusedRowId` row-id-based fields are **removed** from the public API; consumers who need that shape map it themselves.
- `packages/react/src/pretable-surface.tsx` — rename the `interactionState` prop to `state`. Restructure `PretableSurfaceInteractionState` to the new shape. Update the controlled-mode read in the `usePretableModel` call: `state: state ?? undefined`.
- `packages/react/src/inspection-grid.tsx` — propagate the rename.
- `packages/react/src/labeled-grid-surface.tsx` — propagate the rename if the prop is forwarded there.
- `packages/react/src/pretable.tsx` — propagate the rename if relevant.

**Engine state injection rules (in `usePretableModel`):**

When `state` is provided, for each slice that is non-`undefined`:

- `state.sort` → `grid.setSort(slice.columnId, slice.direction)`
- `state.filters` → `grid.replaceFilters(slice)`
- `state.selection` → `grid.setSelection(slice)`
- `state.focus` → `grid.setFocus(slice.rowId && slice.columnId ? slice : null)` (handle the partial-null case as null per existing semantics)

A slice that is `undefined` means "uncontrolled, engine owns it" — do not touch the engine.

**Bench adapter (`apps/bench/src/pretable-adapter.tsx`):**

Replace the existing translation:

```tsx
interactionState={
  interactionPlan ? {
    sort: ...,
    filters: ...,
    focusedRowId: interactionPlan.focusedRowId,
    selectedRowId: interactionPlan.selectedRowId,
  } : undefined
}
```

With a translation that converts `selectedRowId`/`focusedRowId` to the new shape using the columns array. Use a small helper in `apps/bench/src/pretable-adapter.tsx`:

```tsx
function planToState(
  plan: InteractionPlan,
  columns: BenchColumn[],
): PretableSurfaceState | undefined {
  // Translate plan.selectedRowId → state.selection (full-row range)
  // Translate plan.focusedRowId → state.focus (with first column id)
  // Pass through plan.sort and plan.filters as-is
}
```

**Hero demo (`apps/website/app/components/HeroGrid.tsx` and `heroGrid/`):** Update any callsite passing `interactionState` to `<PretableSurface>` to pass `state` with the new shape.

**Tests in `packages/react/src/__tests__/`:** Update any test that passes `interactionState` to use `state`. Tests asserting against `selectedRowId` / `focusedRowId` snapshot fields should read from `snapshot.selection.ranges[0]?.startRowId` and `snapshot.focus.rowId`.

**Exit:** `pnpm -w typecheck` clean. Single commit. Message:

> `refactor(react): rename interactionState → state with slice-based shape`

### Task 2 — Add `onSelectionChange` / `onFocusChange` callbacks

**Files modified:**

- `packages/react/src/use-pretable.ts` — add `onSelectionChange?: (state: PretableSelectionState) => void` and `onFocusChange?: (state: PretableFocusState) => void` to `UsePretableModelOptions`. Subscribe to the grid; on subscription emit, if `selection` or `focus` slice has changed since the last emit, call the corresponding callback. Use refs to track the last-emitted values.
- `packages/react/src/pretable-surface.tsx` — accept and forward the new callbacks.
- `packages/react/src/inspection-grid.tsx`, `labeled-grid-surface.tsx`, `pretable.tsx` — propagate.

**Important behavior:** callbacks fire on **any** state change (not gated on whether the slice is controlled). This matches how `onSortChange` already works: it always fires; if you've also passed `state.sort`, you decide whether to commit the change to your own state.

**Exit:** Tests pass. Single commit. Message:

> `feat(react): onSelectionChange / onFocusChange callbacks`

### Task 3 — Replace minimal keyboard handler with the full contract

**File modified:** `packages/react/src/pretable-surface.tsx`.

The current keyboard handler (Phase 1) handles ArrowUp/ArrowDown and Enter/Space. Replace with the full contract from the spec's "Keyboard Contract" section. Implementation pattern:

1. **Extract a `handleKeyDown(event, grid, columns, snapshot, opts)` helper** at the bottom of the file or a new module `packages/react/src/keyboard.ts`. The helper returns `{ handled: boolean }`. Surface's `onKeyDown` calls it; if `handled`, calls `event.preventDefault()`.
2. **Modifier detection:** use `event.metaKey || event.ctrlKey` for the "Cmd/Ctrl" modifier (cross-platform). `event.shiftKey` for shift.
3. **Mapping:**

| Key (with modifiers)                                 | Action                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ArrowUp` / `ArrowDown` / `ArrowLeft` / `ArrowRight` | `grid.moveFocus(direction)`                                                               |
| `Shift + Arrow`                                      | `grid.moveFocus(direction, { extend: true })`                                             |
| `Cmd/Ctrl + Arrow`                                   | `grid.moveFocus(direction, { jumpToEdge: true })`                                         |
| `Cmd/Ctrl + Shift + Arrow`                           | `grid.moveFocus(direction, { jumpToEdge: true, extend: true })`                           |
| `Home`                                               | `grid.setFocus({ rowId: focus.rowId, columnId: columns[0].id })` (collapses selection)    |
| `End`                                                | `grid.setFocus({ rowId: focus.rowId, columnId: columns[last].id })` (collapses selection) |
| `Cmd/Ctrl + Home`                                    | `grid.setFocus({ rowId: visibleRows[0].id, columnId: columns[0].id })`                    |
| `Cmd/Ctrl + End`                                     | `grid.setFocus({ rowId: visibleRows[last].id, columnId: columns[last].id })`              |
| `PageUp` / `PageDown`                                | Compute page step from rendered rows; `grid.setFocus({...new addr...})`                   |
| `Shift + PageUp/Down`                                | Like above but call `grid.extendRangeFromAnchor` after computing the new addr             |
| `Tab` (when `tabBehavior === "wrap-rows"`)           | Move focus right, wrap to next row at end. `event.preventDefault()`.                      |
| `Shift + Tab` (wrap-rows)                            | Move focus left, wrap to prev row at start. `event.preventDefault()`.                     |
| `Tab` (when `tabBehavior === "exit"`)                | Don't preventDefault — browser handles.                                                   |
| `Cmd/Ctrl + A`                                       | `grid.selectAll()`                                                                        |
| `Esc`                                                | `grid.clearSelection()`                                                                   |
| `Enter` / `Space`                                    | (Phase 1 behavior preserved: toggle row selection on focused row.)                        |

**The Cmd+C handler is NOT wired in this phase** — Phase 5 adds it.

**`tabBehavior` prop:**

```tsx
interface PretableSurfaceProps<TRow> {
  // existing
  tabBehavior?: "wrap-rows" | "exit"; // default "wrap-rows"
}
```

Forward through `Pretable`, `InspectionGrid`, `LabeledGridSurface` if applicable.

**Page step computation:** `const pageRowCount = Math.max(1, Math.floor(bodyViewportHeight / averageRowHeight));` where `averageRowHeight` is `bodyViewportHeight / Math.max(1, snapshot.visibleRows.filter(visible-in-viewport).length)`. Bound by `visibleRows.length`. If this is fragile, fall back to `Math.floor(bodyViewportHeight / 32)`.

**Exit:** All keys handled per contract. Single commit. Message:

> `feat(react): full keyboard contract on PretableSurface`

### Task 4 — ARIA attributes

**File modified:** `packages/react/src/pretable-surface.tsx`.

**Root viewport `<div>`** (currently has `role="grid"` and `tabIndex={0}`):

- Keep `role="grid"`.
- Add `aria-multiselectable="true"`.
- Add `aria-rowcount={snapshot.totalRowCount + 1}` (the +1 is for the header row).
- Add `aria-colcount={columns.length}`.
- Change `tabIndex={0}` to `tabIndex={-1}` — the cell-level tab stop owns focus now. The viewport gets focus only via programmatic focus on cell mount.

**Header row `<div>`:**

- Add `role="row"`.
- Add `aria-rowindex={1}`.

**Header cells `<button>`:**

- Add `role="columnheader"`.
- Add `aria-colindex={i + 1}` (1-based).
- Add `aria-sort={sortDirection === "asc" ? "ascending" : sortDirection === "desc" ? "descending" : "none"}` when sortable.

**Body rows `<div>`:**

- Add `role="row"`.
- Add `aria-rowindex={rowIndex + 2}` (+2: 1-based, plus 1 for header).
- Add `aria-selected={derivedFullySelected ? "true" : undefined}` (use `deriveSelectedRows` for the per-row state).

**Body cells `<div>`:**

- Add `role="gridcell"`.
- Add `aria-colindex={colIndex + 1}` (1-based).
- Add `aria-selected={cellInAnyRange ? "true" : undefined}`.
- Add `tabIndex={isFocused ? 0 : -1}` — single tab stop pattern.
- Use the `data-row-id` + `data-column-id` attributes (or compute from row/column ids) to find the focused cell DOM node for programmatic focus.

**Programmatic focus follow:** in a `useLayoutEffect` keyed on `snapshot.focus.rowId, snapshot.focus.columnId`, find the cell DOM node and call `.focus()` on it if it isn't already the active element.

**Performance note:** `aria-selected` per cell requires checking range membership. Use a `useMemo` that builds a `Set<string>` of selected cell keys (`${rowId}::${columnId}`) once per render; cells look up their key in the set in O(1).

**Exit:** ARIA attributes appear on rendered DOM. Single commit. Message:

> `feat(react): ARIA grid attributes + single-tab-stop focus`

### Task 5 — jsdom component tests

**Files created/modified:**

- `packages/react/src/__tests__/pretable-surface.test.tsx` — extend with new test cases.
- Possibly new file `packages/react/src/__tests__/keyboard.test.tsx` — keyboard-specific tests if grouping helps readability.

**Test coverage required:**

For each keyboard binding in the contract, one test:

- ArrowUp/Down/Left/Right (4 tests) — focus moves one cell.
- Shift+Arrow (4 tests) — range extends.
- Cmd+Arrow (4 tests) — focus jumps to grid edge.
- Cmd+Shift+Arrow (4 tests) — range extends to grid edge.
- Home / End (2 tests) — focus moves within row.
- Cmd+Home / Cmd+End (2 tests) — focus moves to grid corner.
- PageUp / PageDown (2 tests) — focus moves by page.
- Shift+PageUp / Shift+PageDown (2 tests) — range extends by page.
- Tab in `wrap-rows` mode (2 tests: middle of row → next cell; end of row → wrap to next row's first cell).
- Shift+Tab in `wrap-rows` mode (2 tests).
- Tab in `exit` mode (1 test) — assert event.defaultPrevented is false.
- Cmd+A (1 test) — selection becomes full-grid range.
- Esc (1 test) — collapses selection to focused cell.

**Plus controlled-mode round-trips:**

- Pass `state.selection`; press an arrow; assert `onSelectionChange` is called with the next state; do NOT update the prop; assert the rendered selection has not visually changed (because consumer didn't commit).
- Pass `state.selection` and update it from the consumer's setState in `onSelectionChange`; assert the rendered selection follows.
- Same pattern for `state.focus`.

**ARIA assertions:**

- `screen.getByRole("grid")` exists with `aria-rowcount`, `aria-colcount`.
- Cells have correct `aria-colindex` and `tabIndex`.
- Currently-focused cell has `tabIndex={0}`; others have `tabIndex={-1}`.
- After Cmd+A, multiple cells have `aria-selected="true"`.

Use `userEvent` from `@testing-library/user-event` for keyboard interactions. Use `screen.getByRole` and `within` for ARIA-friendly queries.

**Exit:** Test count should grow from current 51 to ~85+. Single commit. Message:

> `test(react): keyboard contract + controlled-mode round-trips + ARIA`

### Task 6 — Documentation updates

**Files modified:**

- `apps/website/content/docs/grid/api-reference.mdx` — document the renamed `state` prop with its slice-based shape, the new `onSelectionChange` / `onFocusChange` callbacks, the new `tabBehavior` prop. Add a Keyboard Contract section listing every key (or a forward link to the to-be-built `/docs/grid/keyboard` page in Phase 8).
- `apps/website/content/docs/grid/pretable-component.mdx` — update API references.
- `apps/website/content/docs/grid/pretable-surface.mdx` — update API references for `state`, `onSelectionChange`, `onFocusChange`, `tabBehavior`.
- `apps/website/content/docs/grid/custom-rendering.mdx` — update keyboard nav notes.

These are minimal renames + additions, not the holistic rewrite (Phase 8). Keep API names truthful and add the new props' existence.

**Exit:** No build or typecheck regressions. Single commit. Message:

> `docs(website): document state prop + keyboard contract`

### Task 7 — Repo-wide verification + PR

- [ ] **Step 2.7.1:** `pnpm -w typecheck` — clean.
- [ ] **Step 2.7.2:** `pnpm -w test` — all passing, including new keyboard/ARIA tests.
- [ ] **Step 2.7.3:** `pnpm -w lint` — 0 errors.
- [ ] **Step 2.7.4:** `pnpm format` — clean (run `pnpm prettier --write .` if needed).
- [ ] **Step 2.7.5:** Push `b2-keyboard-nav` and open PR titled `feat(react): keyboard nav contract + state prop rename (Phase 2 of B)`. PR body explains the slice-based shape, the keyboard contract, the bench-plan compatibility approach. Wait for CI green; user merges.

---

## Phase 3 — React adapter: click + cell-range selection (DETAILED)

**Branch:** `b3-cell-range-clicks`. **Worktree:** `.worktrees/b3-cell-range-clicks`.

**Phase exit criteria:**

- Click semantics on body cells follow Excel-style: plain click collapses to focused cell; shift+click extends; cmd/ctrl+click adds a discontiguous single-cell range.
- Pointer-drag from one cell to another produces a marquee selection (a range from the drag-start cell to the cell under the pointer at drag-end). Esc during drag cancels.
- The previous row-level click that replaced selection with a full-row range is **removed**. Row-select UX is left to the checkbox column in Phase 4. The hero demo's row-click UX is intentionally regressed for one phase.
- Selection visuals use new CSS tokens in `@pretable/ui/tokens.css` (range fill, range border, focus ring).
- ARIA `aria-selected` already wired in Phase 2; verify it still reflects the new range shapes correctly. No new ARIA work in this phase.
- jsdom tests cover click variants, drag-marquee, and Esc cancellation. Test count grows from 92 to ~110+.
- `pnpm -w typecheck` / `pnpm -w test` / `pnpm -w lint` / `pnpm format` clean.
- One PR opened, CI green, user merges.

### Resolved open questions

- **Auto-scroll during drag**: out of scope for this phase. AG Grid does it but it interacts with the engine's viewport handling in non-obvious ways. Defer to a follow-up. Drag that crosses the viewport boundary stops at the last visible cell; the user can release, scroll, and shift+click to extend.
- **Hit-testing during drag**: use `onPointerMove` on each cell (simple, jsdom-friendly). The drag-start cell sets `pointerCapture` so events keep flowing even if the pointer leaves the cell, and per-cell `onPointerEnter` is what we listen to for hit-detection while dragging.
- **Mobile/touch**: Pointer Events handle this natively; the same handlers fire for mouse, pen, and touch. No special casing.

### Tasks

#### Task 1 — Replace row-level click with cell-level click semantics

**Files:** `packages/react/src/pretable-surface.tsx`.

The current row `<div>` has an `onClick` that sets focus and replaces selection with a full-row range (the Phase 1 `replaceSelectionWithFullRow` helper). Remove that. Move the click handler to the cell `<div>`.

Cell click behavior:

- **Plain click**: `grid.setFocus({ rowId, columnId })` + `grid.setSelection({ ranges: [singleCellRange], anchor: { rowId, columnId } })`. Replaces all ranges (collapses).
- **Shift+click**: if no anchor, behaves as plain click. Otherwise `grid.extendRangeFromAnchor({ rowId, columnId })`. Focus moves to the clicked cell.
- **Cmd/Ctrl+click**: `grid.addRange(singleCellRange)` + `grid.setFocus({ rowId, columnId })`. Anchor updates to the clicked cell.

Wrap the click handler in the same before/after snapshot-diff pattern from Phase 2 to fire `onSelectionChange` and `onFocusChange`.

`onSelectedRowIdChange` (Phase 1 compatibility helper) still fires when the resulting selection has a single full-row range; otherwise fires with `null`. This keeps the Phase 1 helper truthful even in the cell-range world.

The `replaceSelectionWithFullRow` helper in `pretable-surface.tsx` is no longer used by the click path. Keep it exported only if keyboard handlers (Enter/Space row-toggle) still need it; otherwise remove.

**Commit:** `refactor(react): cell-level click semantics (plain / shift / cmd-click)`

#### Task 2 — Pointer-drag marquee selection

**Files:** `packages/react/src/pretable-surface.tsx`.

State: a `dragAnchorRef = useRef<PretableCellAddress | null>(null)`. When non-null, the surface is in drag mode.

Cell handlers:

- **`onPointerDown`** (mouse button 0 only, no shift/cmd): set `dragAnchorRef.current = { rowId, columnId }`. Call `setFocus(addr) + setSelection({ ranges: [singleCellRange], anchor: addr })`. Call `event.currentTarget.setPointerCapture(event.pointerId)`. Do NOT preventDefault — we want focus to land naturally.
- **`onPointerEnter`** (only when `dragAnchorRef.current !== null`): call `grid.extendRangeFromAnchor({ rowId, columnId })` and `grid.setFocus({ rowId, columnId })`.
- **`onPointerUp`** / **`onPointerCancel`**: `dragAnchorRef.current = null`. Release pointer capture.

Esc key handler additions: if `dragAnchorRef.current !== null`, set it to null and revert selection to the drag-start single-cell range. This is more intricate than just calling `clearSelection` — we want Esc-during-drag to undo the marquee, not collapse to the focused cell. Use `dragStartSelectionRef = useRef<PretableSelectionState | null>(null)` to capture the pre-drag selection on `onPointerDown`, and restore it on Esc.

If shift/cmd is held on `onPointerDown`, do NOT enter drag mode — let the click handler handle it normally (shift+click extends, cmd+click adds). Drag is for plain-click drags only in v1.

**Commit:** `feat(react): marquee drag selection on body cells`

#### Task 3 — Selection visual tokens + cell styling

**Files:**

- `packages/ui/src/tokens.css` — add new tokens (or extend existing if a similar palette exists)
- `packages/ui/src/grid.css` (or wherever cell styling lives) — apply the tokens
- `packages/react/src/styles.ts` — if cell inline-styles need updating

Tokens (added under the existing `:root` / theme blocks):

```css
--pt-color-selection-bg: rgb(59 130 246 / 0.08); /* light blue 8% */
--pt-color-selection-border: rgb(59 130 246 / 0.6); /* light blue 60% */
--pt-color-focus-ring: rgb(59 130 246); /* solid blue */
```

(Use the existing token system's color semantics — these are placeholders. If `@pretable/ui` already has accent / primary tokens, derive selection colors from them rather than hardcoding hex.)

Cell styling rules:

- Cell with `aria-selected="true"` gets `background: var(--pt-color-selection-bg)`.
- Cell with `data-active-range-edge="true"` (computed at render time — cells on the boundary of the active range) gets a 1px border via `var(--pt-color-selection-border)`. Skip this if it complicates rendering; a continuous background tint is acceptable for v1.
- Cell with `data-focused="true"` gets a 2px inset focus ring via `var(--pt-color-focus-ring)`. Use `box-shadow: inset 0 0 0 2px var(--pt-color-focus-ring)`.

Active-range edge detection: for v1, ship just the background tint (no edge border). The full marching-ants Excel-style border can be a follow-up — getting the visual close enough is enough for the demo.

**Commit:** `feat(ui+react): cell-range selection visuals + new tokens`

#### Task 4 — jsdom tests for click variants + drag

**Files:** `packages/react/src/__tests__/pretable-surface.test.tsx`.

Add tests in a new `describe("click + drag selection", ...)` block:

- Plain click on a cell focuses it and collapses selection to that single cell.
- Shift+click with existing anchor extends the range.
- Shift+click with no prior anchor behaves as plain click.
- Cmd+click adds a discontiguous range; existing ranges remain.
- Cmd+click on an already-selected cell still adds a duplicate single-cell range (idempotent UX is not required in v1).
- Pointer-drag from cell A to cell C produces a range A→C.
- Esc during drag reverts to pre-drag selection.
- Drag with shift held: not entered (shift+click semantics apply on the down event).
- Drag with cmd held: not entered (cmd+click semantics apply).
- `onSelectionChange` and `onFocusChange` fire with the post-action state for each click variant.

Pointer events in jsdom: use `fireEvent.pointerDown(cell, { pointerId: 1 })`, `fireEvent.pointerEnter(otherCell, { pointerId: 1 })`, `fireEvent.pointerUp(otherCell, { pointerId: 1 })`. jsdom's `setPointerCapture` is a no-op stub but doesn't throw. Buttons: button=0 = primary.

Target test count: 92 → 110+.

**Commit:** `test(react): click variants + drag-marquee coverage`

#### Task 5 — Doc updates

**Files:** `apps/website/content/docs/grid/pretable-surface.mdx`.

Add a "Click + Drag Selection" section after the keyboard contract:

```md
## Click + Drag Selection

| Gesture                                | Effect                                     |
| -------------------------------------- | ------------------------------------------ |
| Click body cell                        | Focus + collapse selection to single cell. |
| Shift+click                            | Extend active range from anchor.           |
| Cmd/Ctrl+click                         | Add a discontiguous single-cell range.     |
| Drag (pointer down → enter cells → up) | Marquee selection from start to end cell.  |
| Esc during drag                        | Revert to pre-drag selection.              |

The selection column (Phase 4) provides explicit row-select UX with checkboxes; cell-range gestures and row-select coexist additively.
```

**Commit:** `docs(website): document cell-level click + drag selection`

#### Task 6 — Repo-wide verification + PR

- `pnpm -w typecheck` / `test` / `lint` / `format` all clean.
- Push `b3-cell-range-clicks`, open PR titled `feat(react): cell-range click + drag (Phase 3 of B)`. Body explains the click semantics shift, the temporary row-click UX regression in the hero demo (resolved by Phase 4's checkbox column), and the new visual tokens.

---

## Phase 4 — Built-in checkbox column + select-all (DETAILED)

**Branch:** `b4-checkbox-column`. **Worktree:** `.worktrees/b4-checkbox-column`.

**Phase exit criteria:**

- New `RowSelectionColumnConfig` type and `rowSelectionColumn?` prop on `<PretableSurface>` (forwarded through `Pretable`, `LabeledGridSurface`, `InspectionGrid`).
- When enabled, the surface synthetically injects a left-pinned checkbox column with reserved id `__pretable_row_select__`. The column participates in layout (width, pinned offsets) but is filtered out of sort/filter dispatch and cell-range hit-testing.
- Three-state checkbox per body row, derived from `deriveSelectedRows(snapshot)`. Header checkbox shows checked / indeterminate / unchecked over visible rows; clicking it calls `setSelectAllVisible(checked)`.
- Body checkbox click → `toggleRowSelection(rowId)`. Shift+click on a body checkbox toggles every row from the last-checked anchor to the clicked row (rows-only convention).
- Clicking a checkbox does not move focus, does not collapse cell-range selections, and does not initiate marquee drag.
- Hero demo (`apps/website/app/components/HeroGrid.tsx` and `heroGrid/`) enables the column with the default header checkbox.
- jsdom tests cover injection, header three states, body click, shift+click range, decoupling from cell-range gestures.
- Playwright smoke test (`apps/website/e2e/smoke.spec.ts`) asserts the hero checkbox column is visible and clickable.
- New CSS tokens `--pt-color-checkbox-*` for visual customization.
- `pnpm -w typecheck` / `test` / `lint` / `format` clean.

### Resolved open questions

- **Synthetic column placement**: Inject at the surface level inside `<PretableSurface>` before passing `columns` to `usePretableModel`. Reserved id `__pretable_row_select__` (with double underscores to make accidental collision implausible). The engine sees it as a regular column with no `getValue`, `sortable: false`, `filterable: false`. Surface skips this column when:
  - Computing cell-range click/drag/keyboard target (the gesture handlers check `column.id` and short-circuit if it matches the reserved id).
  - Building `aria-selected` for the checkbox cell — it's never "selected" via cell-range; its visual state comes purely from `deriveSelectedRows`.
- **`state.sort` / `state.filters` interaction**: Engine sees the synthetic column but the surface never sets sort/filter on it. The keyboard handler also skips it for Home/End/etc.
- **Checkbox UX for partial selection**: a body checkbox shows `aria-checked="mixed"` when its row is in `deriveSelectedRows` map with value `"indeterminate"`. Clicking an indeterminate-state checkbox toggles the row (calls `toggleRowSelection`) — same as clicking an unchecked one. (This matches AG Grid; the alternative "complete the partial selection" would surprise users.)

### Tasks

#### Task 1 — Types + synthetic column injection

**Files:**
- `packages/react/src/pretable-surface.tsx` — add the prop and injection logic.
- `packages/react/src/index.ts` — export the new type.

Type:

```ts
export interface RowSelectionColumnConfig {
  enabled: true;
  position?: "left";          // v1: left only
  pinned?: boolean;            // default true
  headerCheckbox?: boolean;    // default true
  width?: number;              // default 36
}
```

In `<PretableSurface>`, before the `columns` is passed to `usePretableModel`:

```tsx
const ROW_SELECT_COLUMN_ID = "__pretable_row_select__";

const effectiveColumns = useMemo(() => {
  if (!rowSelectionColumn?.enabled) return columns;
  const synth: PretableColumn<TRow> = {
    id: ROW_SELECT_COLUMN_ID,
    header: "",
    widthPx: rowSelectionColumn.width ?? 36,
    pinned: (rowSelectionColumn.pinned ?? true) ? "left" : undefined,
    sortable: false,
    filterable: false,
  };
  return [synth, ...columns];
}, [columns, rowSelectionColumn]);
```

Pass `effectiveColumns` everywhere `columns` is used. Helpers like `getPinnedLeftOffsets`, `columnIndexById`, etc. already operate on `columns` — switch them to `effectiveColumns`.

The user-facing `columns` prop is unchanged; we only inject internally.

**Cell-range hit-testing exclusion**: in `handleCellClick`, `onPointerDown`, `onPointerEnter`, and the keyboard handler's wrap-rows Tab logic, short-circuit when `columnId === ROW_SELECT_COLUMN_ID`. The checkbox cell has its own click handler.

**Commit:** `feat(react): synthetic row-selection column injection`

#### Task 2 — Checkbox cell + header rendering

**Files:**
- `packages/react/src/pretable-surface.tsx` — render path branches on `column.id === ROW_SELECT_COLUMN_ID`.
- `packages/ui/src/grid.css` — checkbox cell styling.
- `packages/ui/src/tokens.css` — new `--pt-color-checkbox-*` tokens.

For the body cell: when rendering a row, if the column is the synthetic one, render `<button type="button" role="checkbox" aria-checked={"true" | "false" | "mixed"}>`. Determine state from `deriveSelectedRows(snapshot)` via the existing memoized `selectedCellKeys` / `fullySelectedRowIds` mechanism (or compute analogously). Click handler: `event.stopPropagation()` to prevent cell-range gestures, then `toggleRowSelection(rowId)` (or shift+click range — see Task 3).

For the header cell: when rendering header columns, special-case the synthetic id. If `rowSelectionColumn.headerCheckbox === false`, render an empty placeholder. Otherwise render `<button type="button" role="checkbox" aria-checked={...}>` with three-state derivation:
- `aria-checked="true"` if every visible row is fully selected.
- `aria-checked="mixed"` if some are.
- `aria-checked="false"` otherwise.

Click handler: derives current state, calls `grid.setSelectAllVisible(!allFullySelected)`.

CSS tokens (theme-agnostic fallback in `tokens.css`):

```css
--pt-color-checkbox-bg: var(--pt-color-surface, #fff);
--pt-color-checkbox-border: var(--pt-color-border, #d1d5db);
--pt-color-checkbox-checked-bg: var(--pt-accent-500, #3b82f6);
--pt-color-checkbox-checked-fg: white;
```

Cell styles in `grid.css`:

```css
[data-pretable-cell][data-row-select-cell="true"] {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
[role="checkbox"][data-pretable-row-select] {
  /* 16x16 checkbox with checkmark / dash for mixed */
}
```

Add `data-row-select-cell="true"` to the checkbox cell wrapper for CSS targeting.

**Commit:** `feat(react+ui): three-state checkbox cell + header rendering`

#### Task 3 — Body checkbox shift+click range toggle

**Files:** `packages/react/src/pretable-surface.tsx`.

State: `lastCheckedRowAnchorRef = useRef<string | null>(null)` — tracks the last row whose checkbox was clicked (with or without shift). Cleared if the user does anything else.

Body checkbox click handler:
- Plain click: `lastCheckedRowAnchorRef.current = rowId`; `grid.toggleRowSelection(rowId)`.
- Shift+click: if `lastCheckedRowAnchorRef.current` exists and is in current visible rows, walk from anchor row to clicked row (inclusive, regardless of order), and for each row in that span, ensure it's selected (toggle ON if not already a full-row range — match AG Grid: shift+click "extends selection ON", doesn't toggle individually). Update `lastCheckedRowAnchorRef.current = rowId` after.

Use `snapshot.visibleRows` for the row order; find indices of anchor and clicked, walk between them.

Fire `onSelectionChange` from the snapshot-diff pattern.

**Commit:** `feat(react): shift+click range-toggle on row-select checkbox`

#### Task 4 — Forward `rowSelectionColumn` through composition components

**Files:** `packages/react/src/pretable.tsx`, `inspection-grid.tsx`, `labeled-grid-surface.tsx`.

Add `rowSelectionColumn` to the prop types and forwarding lists. `Pretable` (the simple drop-in) intentionally remains opinionated; consider whether to expose `rowSelectionColumn` there. Recommendation: yes — it's the most common feature consumers will want from the simple drop-in. Add a default of "off" so existing consumers see no change.

**Commit:** `feat(react): forward rowSelectionColumn through Pretable / Inspection / LabeledGrid`

#### Task 5 — Hero demo wiring

**Files:** `apps/website/app/components/HeroGrid.tsx` (or `heroGrid/`).

Pass `rowSelectionColumn={{ enabled: true, headerCheckbox: true }}` to `<PretableSurface>` in the hero demo. Verify visual integration.

**Commit:** `feat(website): hero demo enables row-select column`

#### Task 6 — jsdom tests

**Files:** `packages/react/src/__tests__/pretable-surface.test.tsx`.

New `describe("row-select checkbox column", ...)`:
- Synthetic column injection: with `rowSelectionColumn={{enabled:true}}`, asserts the rendered DOM has the checkbox cell as the leftmost cell.
- Without `rowSelectionColumn`: asserts no synthetic column appears.
- Body checkbox click toggles row selection (`onSelectionChange` fires with full-row range).
- Body checkbox shift+click selects every row from anchor to clicked.
- Header checkbox: when no rows selected, click selects all visible (full-row ranges per visible row).
- Header checkbox: when all visible selected, click deselects all visible.
- Header checkbox: indeterminate state when some rows selected.
- Per-row `aria-checked`: "true" / "mixed" / "false" based on selection state.
- Click on checkbox cell does NOT move focus.
- Click on checkbox cell does NOT collapse existing cell-range selections.
- Cell-range marquee drag does not affect the checkbox column (drag from a body cell over the checkbox column doesn't select it).

Target test count: 110 → ~125+.

**Commit:** `test(react): row-select checkbox column coverage`

#### Task 7 — Playwright smoke test addition

**Files:** `apps/website/e2e/smoke.spec.ts`.

Add a smoke check: visit the hero, locate the leftmost cell as a checkbox, click it, assert visual state changes. (Don't assert specific selection state — Playwright shouldn't depend on internal details. Just verify the checkbox is rendered and interactive.)

**Commit:** `test(website): hero row-select column smoke check`

#### Task 8 — Doc updates

**Files:** `apps/website/content/docs/grid/pretable-surface.mdx`.

Add a new section before "Click + Drag Selection" (or after, ordering judgment call):

```md
## Row-Selection Checkbox Column

Set `rowSelectionColumn={{ enabled: true }}` for a left-pinned checkbox column with three-state header checkbox + per-row toggles.

| Config | Default | Effect |
| --- | --- | --- |
| `enabled: true` | required | Inject the column. |
| `headerCheckbox` | `true` | Show the select-all-visible header checkbox. |
| `pinned` | `true` | Pin to left. |
| `width` | `36` | Pixels. |

The column is independent from cell-range gestures: clicking a checkbox toggles the row's full-row range without moving focus or collapsing other selections. Shift+click on a body checkbox extends from the last-checked row.

Visual customization via `--pt-color-checkbox-*` tokens.
```

**Commit:** `docs(website): document row-select checkbox column`

#### Task 9 — Repo-wide gates + PR

- `pnpm -w typecheck` / `test` / `lint` / `format` all clean.
- Push `b4-checkbox-column`, open PR titled `feat(react): row-select checkbox column (Phase 4 of B)`. Body explains the synthetic column model, shift+click range toggle, hero demo wiring, smoke test addition.

---

## Phase 5 — Copy contract: TSV + overrides (OUTLINE)

**Branch:** `b5-copy`. **Detail:** added when Phase 4 merges.

**Work items:**

- New module `packages/react/src/copy.ts` with `serializeRangesAsTsv(args)` returning `{ text, html? }`.
- Per-block, row-major iteration over visible cells in each range. Multi-range: blocks separated by `\n\n`.
- Per-column `formatForCopy?: (value, row) => string` consulted before the default coercion (`defaultCoerceForCopy`: primitives → string, Date → ISO, plain objects → JSON, null/undefined → empty).
- Grid-level `onCopy?: (args) => string | { text, html? }` overrides the default. Returning the object form writes both `text/plain` and `text/html` to the clipboard.
- `copyWithHeaders?: boolean` (default false) prepends each block with a header row; blank line between header and body.
- Surface-level `keydown` handler for Cmd/Ctrl+C: collect ranges from `state.selection`, build the TSV (or call `onCopy`), call `navigator.clipboard.writeText` (and `.write(new ClipboardItem(...))` if HTML is present).
- jsdom tests: single range, multi-range, formatForCopy, onCopy override, copyWithHeaders, default coercion (numbers, dates, null, JSON objects).

**Open questions to resolve when detailing:**

- jsdom does not implement `navigator.clipboard` reliably. Use a stub injected via a test-only seam (`copyToClipboard?: (data) => Promise<void>` on the surface, defaulting to the real navigator API). This is also the seam Phase 6 uses for announcement testing.
- What happens on copy failure (clipboard API rejects)? Announce via the live region in Phase 6; in Phase 5 just `console.warn` and `return`.

---

## Phase 6 — ARIA live region + announcements (OUTLINE)

**Branch:** `b6-aria-live`. **Detail:** added when Phase 5 merges.

**Work items:**

- Off-screen `<div role="status" aria-live="polite" />` rendered inside the surface root.
- After Cmd+A, after `selectAll()`, after `setSelectAllVisible(true)`: announce "{n} rows × {m} columns selected" (or "all rows selected" if all visible).
- After successful Cmd+C: announce "{n} rows × {m} columns copied". After failure: "Copy failed".
- `messages?: { copyAnnouncement?, selectAllAnnouncement?, copyFailedAnnouncement? }` prop allows consumers to override (i18n).
- jsdom tests: assert `screen.getByRole("status").textContent` after each event.

**Open questions to resolve when detailing:**

- Debouncing rapid announcements (e.g., shift+arrow held down): probably yes, suppress repeated extend announcements; only announce on a "selection settled" boundary (debounced ~500ms after the last keydown).
- Should we announce on every `setSelection` programmatic call? No — only on user-initiated extend / select-all / copy.

---

## Phase 7 — Bench Slab 1: H13 / H14 / H15 (OUTLINE)

**Branch:** `b7-bench-slab1`. **Detail:** added when Phase 6 merges.

**Work items:**

- New scripts under `apps/bench/src/scripts/`: `select-range-extend.ts`, `select-all.ts`, `keyboard-nav-row.ts`. Each follows the existing pattern (set up grid, dispatch keyboard events, capture per-step interaction latency).
- `apps/bench/src/evaluate.ts`: add evaluators for H13 (extend p95 < 16ms over 30 extensions), H14 (arrow nav p95 < 16ms over 60 navs), H15 (Cmd+A end-to-end < 33ms).
- New scenarios registered: `S2/select-range-extend`, `S2/select-all`, `S2/keyboard-nav-row`.
- Repeated Chromium S2/hypothesis runs to produce evidence in `status/runsets/`. Three repeats each per the existing convention.
- Update `docs/research/repo-memory.md` with the new checkpoint.

**Open questions to resolve when detailing:**

- Threshold realism: 16ms is the single-frame budget at 60Hz. If real measurements come in materially over (e.g., 25ms for shift+arrow), do we adjust threshold or fix the cause? Per the project's discipline: fix the cause. This may mean a small Phase 7.5 to address slow paths before the hypothesis can ship.
- Comparators: out of scope per the spec — Slab 2 / sub-project B2.

---

## Phase 8 — Documentation surface (OUTLINE)

**Branch:** `b8-docs`. **Detail:** added when Phase 7 merges.

**Work items:**

- Three new pages under `apps/website/app/docs/grid/`:
  - `selection/page.mdx` — selection model overview, IDs-not-indices invariant, derived row state, three-state checkbox semantics, controlled vs uncontrolled, runnable example.
  - `keyboard/page.mdx` — full keyboard contract table, `tabBehavior` config, ARIA notes.
  - `clipboard/page.mdx` — copy contract: TSV defaults, `formatForCopy`, `onCopy`, `copyWithHeaders`, multi-range serialization. Forward-pointer to Phase-2 paste.
- Updates to existing pages:
  - `apps/website/app/docs/grid/page.mdx` — feature list updated.
  - `apps/website/app/docs/grid/pretable-component/page.mdx` and `…/pretable-surface/page.mdx` — new `state` prop, `onSelectionChange`, `onFocusChange`, `rowSelectionColumn`, `tabBehavior`, `copyWithHeaders`, `onCopy`, `messages`.
  - `apps/website/app/docs/grid/api-reference/page.mdx` — full type reference for `PretableSelectionState`, `PretableCellRange`, `PretableCellAddress`, `PretableFocusState`, `PretableFocusDirection`, `PretableMoveFocusOptions`, `RowSelectionColumnConfig`, `CopyResult`, `RowSelectionTriState`. New / changed engine actions.
  - `apps/website/app/docs/getting-started/concepts/page.mdx` — selection added to the conceptual model.
  - `apps/website/app/docs/_nav.ts` — new entries; ordering: Pretable component → Surface → Selection → Keyboard → Clipboard → Custom rendering → Density helpers → API reference.
- Verify: every public type / prop introduced or changed has a one-sentence purpose, exact type, and ≥1 usage snippet in `api-reference`. Existing MDX example pipeline still typechecks.
- Each phase's PR should already have updated any docs it directly invalidated; this phase consolidates and adds the three new pages.

**Open questions to resolve when detailing:**

- Should the `selection` page demo embed the live hero grid component or a smaller standalone example? Smaller standalone keeps page-level state simple; the hero demo is the "big proof" already linked from `/`.

---

## Self-Review

**Spec coverage check** (against `2026-05-05-selection-keyboard-nav-design.md`):

| Spec section                                                                      | Covered by                                                                             |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Selection model (cell-range, IDs not indices, filtered-row invariant, derivation) | Phase 1 (engine + tests), Phase 4 (checkbox derivation visual)                         |
| Click contract (Excel-style click/shift/cmd/drag/header-checkbox/select-all)      | Phase 3 (cell clicks/drag), Phase 4 (checkbox column clicks)                           |
| Keyboard contract (full table)                                                    | Phase 1 (2D moveFocus engine), Phase 2 (full surface wiring), Phase 5 (Cmd+C)          |
| Built-in checkbox column                                                          | Phase 4                                                                                |
| Copy-to-clipboard (TSV + overrides + paste-deferred note)                         | Phase 5                                                                                |
| Controlled vs uncontrolled (`state` prop rename)                                  | Phase 2                                                                                |
| ARIA & accessibility (roles, live region, messages prop)                          | Phase 2 (roles/tabIndex), Phase 3 (aria-selected on cells/rows), Phase 6 (live region) |
| New engine actions table                                                          | Phase 1                                                                                |
| Bench Slab 1 (H13/H14/H15)                                                        | Phase 7                                                                                |
| Hero demo update                                                                  | Phase 4                                                                                |
| Visual defaults / new tokens                                                      | Phase 3 (cell-range visuals), Phase 4 (checkbox tokens)                                |
| Documentation surface                                                             | Phase 8 (consolidated) + each phase's local doc updates                                |
| Exit criteria (all bullets)                                                       | Cumulatively across phases 1–8                                                         |

**Placeholder scan:** None remain. The phase outlines are explicitly outlines (not bite-sized tasks); they will be detailed before their phase begins. The "Open questions to resolve when detailing" sections are deliberate — they record decisions to make at detail-time, not skipped detail.

**Type consistency check:**

- `GridCoreCellAddress` vs `GridCoreCellRange` vs `GridCoreSelectionState` are used consistently across Tasks 1–4 and the helpers in `derived-selection.ts`.
- `setFocus(addr: GridCoreCellAddress | null)` signature is consistent in the type definition (Task 1.1.2), the implementation (Task 1.2.4), and all callsites (Tasks 1.6.1, 1.6.3).
- `moveFocus(direction, options?)` signature matches between type, implementation, and call sites (Task 1.6.1).
- `toggleRowSelection(rowId)` is consistent everywhere it appears.
- `RowSelectionTriState` is exported from `derived-selection.ts` via the index re-export and referenced as a type in test code.

**Scope check:** Phase 1 is bounded to engine state + callsite migration. New features (multi-cell range, marquee drag, copy, bench, docs) are out of Phase 1. The remaining phases each produce a working, testable PR.

---

## After Phase 1 merges

When Phase 1 lands on `main`, append a "## Phase 2 — Detailed Tasks" section to this file, replacing the Phase 2 outline above with bite-sized tasks. Then create the `b2-keyboard-nav` worktree and execute. Repeat the same just-in-time pattern for Phases 3–8.
