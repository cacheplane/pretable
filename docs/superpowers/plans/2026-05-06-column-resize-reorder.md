# Column Resize + Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-mutable column widths and column order to pretable through standard grid gestures: drag a header's right edge to resize, drag the header itself to reorder, double-click the resize handle to autosize. Pin/unpin happens implicitly when reorder crosses the pinned-region boundary.

**Architecture:** Engine state (in `@pretable-internal/grid-core`) gains five new actions — `setColumnWidth`, `moveColumn`, `setColumnPinned`, `autosizeColumn`, `resetColumnLayout` — plus a private snapshot of the original column state for reset. The React adapter (`@pretable/react`) layers two pointer-event-driven gestures on top: a 4px resize hit area on every header's right edge (drag-live width preview, commit on drag-end), and a 5px-threshold drag on the header body (ghost + drop indicator + cross-boundary auto-pin). Three new narrow controlled-state slices (`state.columnWidths`, `state.columnOrder`, `state.columnPinned`) follow the established pattern from sub-project B.

**Tech Stack:** TypeScript, React 19, Vitest (jsdom), pnpm workspaces. Touched packages: `@pretable-internal/grid-core`, `@pretable/core`, `@pretable/react`, `@pretable/ui`, `apps/website` (docs only).

**Spec:** [`docs/superpowers/specs/2026-05-06-column-resize-reorder-design.md`](../specs/2026-05-06-column-resize-reorder-design.md)

**Working directory:** All paths in this plan are relative to the repo root `/Users/blove/repos/pretable/`. Each phase ships from its own worktree (see "Worktree per phase" below).

---

## Phase Roadmap

Each phase below ships as one PR, merged on green before the next starts. Detail is filled in just-in-time: Phase C1 is fully task-decomposed in this document; subsequent phases have structured outlines and become fully detailed (appended to this same plan file) when their predecessor merges.

| #   | Phase                                                            | Branch / worktree        | Mergeable test surface                                                                                                                                                                                     |
| --- | ---------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Engine state foundation: types + 5 actions + prop-merge          | `c1-engine-column-state` | grid-core unit tests, all in-repo callsites compile, existing tests pass                                                                                                                                   |
| C2  | React adapter — resize gesture + double-click autosize           | `c2-resize`              | jsdom tests for resize drag, drag-live preview, commit-on-drag-end, double-click autosize, controlled `state.columnWidths` round-trip                                                                      |
| C3  | React adapter — reorder gesture + cross-boundary auto-pin + docs | `c3-reorder`             | jsdom tests for reorder ghost, drop indicator, threshold-based start, Esc cancel, cross-boundary pin auto-update, controlled `state.columnOrder` + `state.columnPinned`; new `column-layout.mdx` docs page |

**Worktree per phase:** Implementation for each phase happens in `.worktrees/<branch-name>` (project-local convention, gitignored). The plan file itself lives on `c1-engine-column-state` (the branch this is being written on); subsequent updates to this plan also commit there until C1 merges, then C2 and C3 each carry their own plan-detail commit on their own branches.

**Just-in-time planning:** When C1 merges, the next phase's master-plan section gets fully detailed by appending to this file in the new worktree. Same pattern as sub-project B.

---

## Architectural Notes (shared across phases)

### Column-state ownership

The engine clones `inputOptions.columns` at `createGrid` time into a private `originalColumns` snapshot. The mutable display state lives on `options.columns` (this is `let options = ...`, not the original input — the existing engine already mutates `options` on autosize). All five new actions mutate `options.columns`. `resetColumnLayout` restores from the `originalColumns` snapshot.

When the consumer's `columns` prop changes by reference (a structural change — a column added or removed), `usePretableModel` detects this in a `useLayoutEffect` and calls a new engine helper `mergeColumnsFromProps(nextProps)` that:

1. For each column id present in both `originalColumns` (stale) and the new prop: keeps the engine's current `widthPx`, `pinned`, and order if available.
2. For each column id newly added in the prop: slots in at the prop's position with the prop's `widthPx`.
3. For each column id removed from the prop: drops from engine state.
4. Updates the `originalColumns` snapshot to the new prop (so a subsequent `resetColumnLayout` resets to the new prop, not the old one).

### Synthetic row-select column exclusion

The reserved id `__pretable_row_select__` (constant `ROW_SELECT_COLUMN_ID` exported from `@pretable/react/constants`) is excluded from all column-mutation actions:

- `setColumnWidth(ROW_SELECT_COLUMN_ID, ...)` is silently no-op'd. (The width is set via `rowSelectionColumn.width` config.)
- `moveColumn(ROW_SELECT_COLUMN_ID, ...)` is silently no-op'd. The synthetic column always occupies position 0.
- `setColumnPinned(ROW_SELECT_COLUMN_ID, ...)` is silently no-op'd.
- `autosizeColumn(ROW_SELECT_COLUMN_ID)` is silently no-op'd.
- For other columns, `moveColumn(id, toIndex)` clamps `toIndex >= 1` when the synthetic column is present, ensuring no user column ever lands left of the synthetic.

### Min/max width clamping

Every `setColumnWidth(columnId, width)` clamps to `[column.minWidthPx ?? 40, column.maxWidthPx ?? Infinity]`. The engine reads min/max from the current `options.columns[i]` for that column id.

### Pinned-region boundary

Define `pinnedRegionEnd(columns)` = the index of the first non-pinned column counting from index 0 (or `columns.length` if all are pinned). With the synthetic column at position 0, the synthetic counts as "non-pinned" for this calculation — its presence does not extend the pinned region. `moveColumn(id, toIndex)`:

- Clamp `toIndex` to `[1, columns.length - 1]` if synthetic is at 0; else `[0, columns.length - 1]`.
- If `toIndex < pinnedRegionEnd`: column lands in pinned region → `pinned = "left"`.
- Else if previously pinned: `pinned = undefined`.

### Drag-end-only callback emission

All three new callbacks (`onColumnWidthsChange`, `onColumnOrderChange`, `onColumnPinnedChange`) fire on user-initiated commit (drag-end / double-click / explicit user action). Programmatic engine mutations from `usePretableModel`'s controlled-state injection do not fire callbacks. Same pattern as the established sub-project B Phase 6 announcements.

### No backwards compatibility

Per `feedback_no_backcompat.md`: rename, restructure, remove freely. The new engine actions are additive but the column type extension is backward-compatible (all new fields optional with sensible defaults).

---

## File Structure (Phase C1 scope only)

```
packages/grid-core/src/
├── types.ts                                          (MODIFY: extend GridCoreColumn,
│                                                       add 5 GridCoreStore signatures)
├── create-grid-core.ts                               (MODIFY: implement 5 actions,
│                                                       originalColumns snapshot,
│                                                       mergeColumnsFromProps helper)
├── derived-rows.ts                                   (no change)
├── derived-selection.ts                              (no change)
├── index.ts                                          (no change — types re-exported)
└── __tests__/
    ├── grid-core.test.ts                             (no change)
    ├── selection-state.test.ts                       (no change)
    ├── move-focus.test.ts                            (no change)
    ├── column-layout.test.ts                         (CREATE: width/move/pin/autosize/reset/merge)
    └── emit-behavior.test.ts                         (no change)

packages/core/src/
├── types.ts                                          (no change — GridCoreColumn re-export carries
│                                                       new fields automatically; PretableGrid
│                                                       interface uses Omit so new methods inherit)
└── create-grid.ts                                    (MODIFY: forward 5 new actions)

packages/react/src/
└── (no changes in C1 — C2 and C3 are the React adapter phases)

apps/bench/, apps/website/
└── (no changes in C1 — engine API extension does not break callers)
```

---

## Phase C1 — Engine State Foundation (FULLY DETAILED)

**Branch:** `c1-engine-column-state`. **Worktree:** `.worktrees/c1-engine-column-state`.

**Phase exit criteria:**

- New types (`minWidthPx`, `maxWidthPx`, `resizable`, `reorderable`) added to `GridCoreColumn`.
- Five new actions on `GridCoreStore`: `setColumnWidth`, `moveColumn`, `setColumnPinned`, `autosizeColumn`, `resetColumnLayout`.
- Engine maintains a private `originalColumns` snapshot, captured at `createGrid` time and refreshed when the consumer's `columns` prop changes structurally.
- `mergeColumnsFromProps` helper supports column add/remove while preserving engine-state widths/order for surviving columns.
- All five actions silently no-op for the synthetic row-select column id `__pretable_row_select__`.
- New unit tests in `column-layout.test.ts` cover: width clamp, move repositioning, cross-boundary pin auto-update, single-column autosize, layout reset, prop-merge merge semantics.
- `@pretable/core` `createGrid` forwards the 5 new actions.
- `pnpm -w typecheck` and `pnpm -w test` pass at repo root.
- One PR opened, CI green, merged.

### Worktree setup

- [ ] **Step C1.0.1: Verify the worktree is ready**

```bash
cd /Users/blove/repos/pretable/.worktrees/c1-engine-column-state
git status
git log --oneline -3
```

Expected: clean worktree, branch `c1-engine-column-state`, recent commits include the spec and this plan.

- [ ] **Step C1.0.2: Verify clean baseline**

```bash
pnpm install --frozen-lockfile
pnpm --filter @pretable-internal/grid-core test
```

Expected: 55 grid-core tests pass.

### Task 1 — Extend `GridCoreColumn` type with min/max/resizable/reorderable

**Files:**

- Modify: `packages/grid-core/src/types.ts`

- [ ] **Step C1.1.1: Add four new optional fields**

In `packages/grid-core/src/types.ts`, find the `GridCoreColumn<TRow>` interface. Add these fields (preserve existing fields):

```ts
export interface GridCoreColumn<TRow extends GridCoreRow = GridCoreRow> {
  id: string;
  header?: string;
  wrap?: boolean;
  widthPx?: number;
  pinned?: "left";
  sortable?: boolean;
  filterable?: boolean;
  getValue?: (row: TRow) => unknown;
  formatForCopy?: (value: unknown, row: TRow) => string;
  // new in sub-project C:
  minWidthPx?: number; // default 40 (engine-applied)
  maxWidthPx?: number; // default undefined (no max)
  resizable?: boolean; // default true
  reorderable?: boolean; // default true
}
```

- [ ] **Step C1.1.2: Run typecheck**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: passes.

### Task 2 — Add 5 new action signatures to `GridCoreStore`

**Files:**

- Modify: `packages/grid-core/src/types.ts`

- [ ] **Step C1.2.1: Add the new method signatures to `GridCoreStore<TRow>`**

In `packages/grid-core/src/types.ts`, find the `GridCoreStore<TRow>` interface. Append (don't remove existing methods):

```ts
  // column-layout actions (sub-project C):
  setColumnWidth(columnId: string, width: number): void;
  moveColumn(columnId: string, toIndex: number): void;
  setColumnPinned(columnId: string, pinned: "left" | null): void;
  autosizeColumn(columnId: string, options?: AutosizeOptions): void;
  resetColumnLayout(): void;
```

- [ ] **Step C1.2.2: Run typecheck — expect failures**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: errors in `create-grid-core.ts` because the new methods are declared but not implemented. Task 3 fixes this.

### Task 3 — Implement `setColumnWidth` and clamp helper

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts`

- [ ] **Step C1.3.1: Add the synthetic column id constant + clamp helper**

At the top of `packages/grid-core/src/create-grid-core.ts` (after imports), add:

```ts
const ROW_SELECT_COLUMN_ID = "__pretable_row_select__";

function clampColumnWidth(
  width: number,
  column: GridCoreColumn<GridCoreRow>,
): number {
  const min = column.minWidthPx ?? 40;
  const max = column.maxWidthPx ?? Infinity;
  return Math.max(min, Math.min(max, width));
}
```

(The constant is local to this file; the React-adapter copy lives at `packages/react/src/constants.ts`. Keeping them in sync is a documented invariant; both define the same string.)

- [ ] **Step C1.3.2: Capture the original-columns snapshot at `createGrid` time**

In `packages/grid-core/src/create-grid-core.ts`, after the `applyAutosize` call (around line 60-ish), add:

```ts
const originalColumns: GridCoreColumn<TRow>[] = inputOptions.columns.map(
  (c) => ({
    ...c,
  }),
);
```

This snapshot is the source of truth for `resetColumnLayout`. Wrap it in a `let` because `mergeColumnsFromProps` (Task 8) updates it.

Actually use `let originalColumns: GridCoreColumn<TRow>[] = ...;` so it can be reassigned later.

- [ ] **Step C1.3.3: Implement `setColumnWidth` action**

Inside the `store` object literal in `create-grid-core.ts`, alongside the existing `autosizeColumns`, add:

```ts
    setColumnWidth(columnId: string, width: number) {
      if (columnId === ROW_SELECT_COLUMN_ID) {
        return;
      }
      const idx = options.columns.findIndex((c) => c.id === columnId);
      if (idx === -1) {
        return;
      }
      const column = options.columns[idx]!;
      const clamped = clampColumnWidth(width, column);
      if (column.widthPx === clamped) {
        return;
      }
      const nextColumns = options.columns.slice();
      nextColumns[idx] = { ...column, widthPx: clamped };
      options = { ...options, columns: nextColumns };
      emit();
    },
```

- [ ] **Step C1.3.4: Run typecheck (other actions still missing)**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: still errors for `moveColumn`, `setColumnPinned`, `autosizeColumn`, `resetColumnLayout`. `setColumnWidth` itself should typecheck.

### Task 4 — Implement `moveColumn` with cross-boundary pin auto-update

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts`

- [ ] **Step C1.4.1: Add a `pinnedRegionEnd` helper at the bottom of the file**

```ts
function pinnedRegionEnd<TRow extends GridCoreRow>(
  columns: GridCoreColumn<TRow>[],
): number {
  // Synthetic column at index 0 is treated as non-pinned for this
  // calculation. The pinned region starts at the first user column.
  let i = 0;
  if (columns[0]?.id === ROW_SELECT_COLUMN_ID) {
    i = 1;
  }
  while (i < columns.length && columns[i]?.pinned === "left") {
    i += 1;
  }
  return i;
}
```

- [ ] **Step C1.4.2: Implement `moveColumn` action**

Inside the `store` object literal:

```ts
    moveColumn(columnId: string, toIndex: number) {
      if (columnId === ROW_SELECT_COLUMN_ID) {
        return;
      }
      const fromIndex = options.columns.findIndex((c) => c.id === columnId);
      if (fromIndex === -1) {
        return;
      }
      const synthAtZero =
        options.columns[0]?.id === ROW_SELECT_COLUMN_ID;
      const minIndex = synthAtZero ? 1 : 0;
      const maxIndex = options.columns.length - 1;
      const clampedTo = Math.max(minIndex, Math.min(maxIndex, toIndex));
      if (fromIndex === clampedTo) {
        return;
      }

      const nextColumns = options.columns.slice();
      const [moved] = nextColumns.splice(fromIndex, 1);
      if (!moved) {
        return;
      }
      nextColumns.splice(clampedTo, 0, moved);

      // Compute pin region in the resulting array (after move) by
      // looking at the columns NOT including the moved column's pin
      // state — i.e., where would the moved column land relative to
      // the existing pin/unpin boundary?
      const otherColumns = nextColumns.filter((_, i) => i !== clampedTo);
      let boundary = 0;
      if (otherColumns[0]?.id === ROW_SELECT_COLUMN_ID) {
        boundary = 1;
      }
      while (
        boundary < otherColumns.length &&
        otherColumns[boundary]?.pinned === "left"
      ) {
        boundary += 1;
      }
      // Boundary is the index where the moved column lands in
      // otherColumns; check against the moved column's destination index
      // in nextColumns (= clampedTo).
      const landsInPinned = clampedTo < boundary + (clampedTo <= boundary ? 0 : 0);
      // Simpler: landsInPinned iff clampedTo < boundary + 1 when synth-aware
      // But the destination index in nextColumns is clampedTo; the boundary
      // in otherColumns counts from minIndex up. Translate: in nextColumns,
      // the pinned region spans [minIndex, minIndex + (boundary - minIndex)).
      // The moved column lands at clampedTo. So:
      //   landsInPinned = clampedTo >= minIndex && clampedTo < boundary
      // (after moving it into position, it occupies clampedTo, and the
      // pinned columns to its left + right that were already pinned form
      // the pinned region.)
      const landsInPinnedFinal = clampedTo < boundary;

      const wasPinned = moved.pinned === "left";
      let nextPinned: "left" | undefined = wasPinned ? "left" : undefined;
      if (landsInPinnedFinal) {
        nextPinned = "left";
      } else if (wasPinned) {
        nextPinned = undefined;
      }

      if (nextPinned !== moved.pinned) {
        nextColumns[clampedTo] = { ...moved, pinned: nextPinned };
      }

      options = { ...options, columns: nextColumns };
      emit();
    },
```

(The two-boundary calculation is the trickiest part. The unit tests in Task 9 will catch off-by-one errors; if a test fails, simplify by computing the boundary directly on the post-move array but excluding the moved column's own pin state.)

- [ ] **Step C1.4.3: Run typecheck — moveColumn should compile**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: errors only for the remaining unimplemented actions.

### Task 5 — Implement `setColumnPinned`

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts`

- [ ] **Step C1.5.1: Implement `setColumnPinned` action**

Inside the `store` object literal:

```ts
    setColumnPinned(columnId: string, pinned: "left" | null) {
      if (columnId === ROW_SELECT_COLUMN_ID) {
        return;
      }
      const idx = options.columns.findIndex((c) => c.id === columnId);
      if (idx === -1) {
        return;
      }
      const column = options.columns[idx]!;
      const nextPinnedValue = pinned === "left" ? ("left" as const) : undefined;
      if (column.pinned === nextPinnedValue && pinned === "left") {
        return;
      }
      if (column.pinned === undefined && pinned === null) {
        return;
      }

      // Reposition: pinning moves the column to the end of the
      // pinned region; unpinning moves it to the start of the unpinned
      // region.
      const nextColumns = options.columns.slice();
      nextColumns.splice(idx, 1);

      const synthAtZero =
        nextColumns[0]?.id === ROW_SELECT_COLUMN_ID;
      const baseStart = synthAtZero ? 1 : 0;
      let boundary = baseStart;
      while (
        boundary < nextColumns.length &&
        nextColumns[boundary]?.pinned === "left"
      ) {
        boundary += 1;
      }

      const insertAt = pinned === "left" ? boundary : boundary;
      // (When pinning: insert at end of pinned region. When unpinning:
      // also at boundary, which is start of unpinned region. Same index.)
      const nextColumn: GridCoreColumn<TRow> = {
        ...column,
        pinned: nextPinnedValue,
      };
      nextColumns.splice(insertAt, 0, nextColumn);

      options = { ...options, columns: nextColumns };
      emit();
    },
```

- [ ] **Step C1.5.2: Run typecheck**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: errors only for `autosizeColumn` and `resetColumnLayout`.

### Task 6 — Implement `autosizeColumn`

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts`

- [ ] **Step C1.6.1: Implement `autosizeColumn` action**

The existing `applyAutosize` skips columns with a defined `widthPx`. For `autosizeColumn(id)` we temporarily strip the target column's `widthPx`, run autosize, then merge the result.

Inside the `store` object literal:

```ts
    autosizeColumn(columnId: string, autosizeOptions?: AutosizeOptions) {
      if (columnId === ROW_SELECT_COLUMN_ID) {
        return;
      }
      const idx = options.columns.findIndex((c) => c.id === columnId);
      if (idx === -1) {
        return;
      }
      const column = options.columns[idx]!;
      // Temporarily clear widthPx so applyAutosize will compute one.
      const probeColumns = options.columns.slice();
      probeColumns[idx] = { ...column, widthPx: undefined };
      const probedOptions = { ...options, columns: probeColumns };
      const probed = applyAutosize(probedOptions, autosizeOptions);
      const nextWidth = probed.columns[idx]?.widthPx;
      if (nextWidth === undefined || nextWidth === column.widthPx) {
        return;
      }
      const clamped = clampColumnWidth(nextWidth, column);
      const nextColumns = options.columns.slice();
      nextColumns[idx] = { ...column, widthPx: clamped };
      options = { ...options, columns: nextColumns };
      emit();
    },
```

### Task 7 — Implement `resetColumnLayout`

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts`

- [ ] **Step C1.7.1: Implement `resetColumnLayout` action**

Inside the `store` object literal:

```ts
    resetColumnLayout() {
      // Restore from the original-columns snapshot. Apply autosize
      // again if it was originally enabled (keeps the post-init width
      // contract consistent).
      const restored = inputOptions.autosize
        ? applyAutosize(
            { ...inputOptions, columns: originalColumns.map((c) => ({ ...c })) },
            typeof inputOptions.autosize === "object"
              ? inputOptions.autosize
              : undefined,
          )
        : { ...inputOptions, columns: originalColumns.map((c) => ({ ...c })) };

      // Compare to current to short-circuit no-op resets.
      const current = options.columns;
      const next = restored.columns;
      if (current.length === next.length) {
        let same = true;
        for (let i = 0; i < current.length; i += 1) {
          const c = current[i]!;
          const n = next[i]!;
          if (
            c.id !== n.id ||
            c.widthPx !== n.widthPx ||
            c.pinned !== n.pinned
          ) {
            same = false;
            break;
          }
        }
        if (same) {
          return;
        }
      }

      options = { ...options, columns: next };
      emit();
    },
```

- [ ] **Step C1.7.2: Run typecheck — should be clean**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: passes (all 5 actions implemented).

- [ ] **Step C1.7.3: Run existing grid-core tests**

```bash
pnpm --filter @pretable-internal/grid-core test
```

Expected: 55 existing tests pass (no regressions). New tests come in Task 9.

### Task 8 — Add `mergeColumnsFromProps` for structural prop changes

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts`

This action lets the React adapter detect a `columns` prop change and re-sync the engine's column state, preserving widths/order for surviving columns.

- [ ] **Step C1.8.1: Add the action to `GridCoreStore` type**

In `packages/grid-core/src/types.ts`, append to the `GridCoreStore<TRow>` interface:

```ts
  mergeColumnsFromProps(nextColumns: GridCoreColumn<TRow>[]): void;
```

- [ ] **Step C1.8.2: Implement `mergeColumnsFromProps` in `create-grid-core.ts`**

Inside the `store` object literal:

```ts
    mergeColumnsFromProps(nextColumns: GridCoreColumn<TRow>[]) {
      // Build a lookup of current engine state by id.
      const currentById = new Map(options.columns.map((c) => [c.id, c]));
      // Compute the merged display state in the order specified by nextColumns.
      const merged = nextColumns.map((newCol) => {
        const existing = currentById.get(newCol.id);
        if (existing) {
          // Preserve engine-state widthPx and pinned. Pull other fields
          // (header, getValue, sortable, etc.) from the new prop.
          return {
            ...newCol,
            widthPx: existing.widthPx ?? newCol.widthPx,
            pinned: existing.pinned ?? newCol.pinned,
          };
        }
        return { ...newCol };
      });
      // Update the originalColumns snapshot to the new prop so a
      // subsequent resetColumnLayout resets to the new shape.
      originalColumns = nextColumns.map((c) => ({ ...c }));
      options = { ...options, columns: merged };
      emit();
    },
```

- [ ] **Step C1.8.3: Run typecheck**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: passes.

- [ ] **Step C1.8.4: Commit Tasks 1–8**

```bash
git add packages/grid-core/src/types.ts packages/grid-core/src/create-grid-core.ts
git commit -m "feat(grid-core): column resize/reorder/pin actions

Adds setColumnWidth, moveColumn, setColumnPinned, autosizeColumn,
resetColumnLayout, mergeColumnsFromProps. Extends GridCoreColumn with
minWidthPx, maxWidthPx, resizable, reorderable. Captures an
originalColumns snapshot for layout reset. Synthetic row-select
column is excluded from all column mutations.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 9 — Unit tests for column-layout actions

**Files:**

- Create: `packages/grid-core/src/__tests__/column-layout.test.ts`

- [ ] **Step C1.9.1: Create the test file**

Create `packages/grid-core/src/__tests__/column-layout.test.ts` with this exact content:

```ts
import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";

interface Row {
  id: string;
  a: string;
  b: string;
  c: string;
  d: string;
}

const baseColumns = [
  { id: "a", header: "A", widthPx: 100 },
  { id: "b", header: "B", widthPx: 100 },
  { id: "c", header: "C", widthPx: 100 },
  { id: "d", header: "D", widthPx: 100 },
] as const;

const baseRows: Row[] = [
  { id: "r1", a: "a1", b: "b1", c: "c1", d: "d1" },
  { id: "r2", a: "a2", b: "b2", c: "c2", d: "d2" },
];

function makeGrid(columnsOverride?: typeof baseColumns) {
  return createGridCore<Row>({
    columns: [...(columnsOverride ?? baseColumns)],
    rows: baseRows,
    getRowId: (row) => row.id,
  });
}

describe("setColumnWidth", () => {
  test("updates the column width", () => {
    const grid = makeGrid();
    grid.setColumnWidth("b", 250);
    expect(grid.options.columns.find((c) => c.id === "b")?.widthPx).toBe(250);
  });

  test("clamps to default min (40)", () => {
    const grid = makeGrid();
    grid.setColumnWidth("a", 10);
    expect(grid.options.columns.find((c) => c.id === "a")?.widthPx).toBe(40);
  });

  test("clamps to per-column min", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100, minWidthPx: 80 },
        { id: "b", header: "B", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnWidth("a", 10);
    expect(grid.options.columns.find((c) => c.id === "a")?.widthPx).toBe(80);
  });

  test("clamps to per-column max", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100, maxWidthPx: 200 },
        { id: "b", header: "B", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnWidth("a", 999);
    expect(grid.options.columns.find((c) => c.id === "a")?.widthPx).toBe(200);
  });

  test("no-ops when width is unchanged", () => {
    const grid = makeGrid();
    let emits = 0;
    grid.subscribe(() => {
      emits += 1;
    });
    grid.setColumnWidth("a", 100); // already 100
    expect(emits).toBe(0);
  });

  test("no-ops for unknown column id", () => {
    const grid = makeGrid();
    grid.setColumnWidth("nonexistent", 200);
    expect(grid.options.columns.find((c) => c.id === "a")?.widthPx).toBe(100);
  });
});

describe("moveColumn", () => {
  test("moves column to a new index", () => {
    const grid = makeGrid();
    grid.moveColumn("a", 2);
    expect(grid.options.columns.map((c) => c.id)).toEqual(["b", "c", "a", "d"]);
  });

  test("clamps toIndex to valid bounds", () => {
    const grid = makeGrid();
    grid.moveColumn("a", -1);
    expect(grid.options.columns.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    grid.moveColumn("a", 99);
    expect(grid.options.columns.map((c) => c.id)).toEqual(["b", "c", "d", "a"]);
  });

  test("auto-pins when column lands in pinned region", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", pinned: "left", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
        { id: "d", header: "D", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("c", 1);
    const cAfter = grid.options.columns.find((col) => col.id === "c");
    expect(cAfter?.pinned).toBe("left");
  });

  test("auto-unpins when column leaves pinned region", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", pinned: "left", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("a", 2);
    const aAfter = grid.options.columns.find((col) => col.id === "a");
    expect(aAfter?.pinned).toBeUndefined();
  });

  test("synthetic row-select column id is silently no-op'd", () => {
    const grid = makeGrid();
    grid.moveColumn("__pretable_row_select__", 2);
    expect(grid.options.columns.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });

  test("clamps toIndex >= 1 when synthetic column at index 0", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "__pretable_row_select__", header: "" },
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.moveColumn("c", 0);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "__pretable_row_select__",
      "c",
      "a",
      "b",
    ]);
  });
});

describe("setColumnPinned", () => {
  test("pins an unpinned column", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("c", "left");
    const cAfter = grid.options.columns.find((col) => col.id === "c");
    expect(cAfter?.pinned).toBe("left");
    // Pinning moves it to the start (or end of pinned region).
    expect(grid.options.columns[0]?.id).toBe("c");
  });

  test("unpins a pinned column", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", pinned: "left", widthPx: 100 },
        { id: "b", header: "B", pinned: "left", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnPinned("a", null);
    const aAfter = grid.options.columns.find((col) => col.id === "a");
    expect(aAfter?.pinned).toBeUndefined();
    // a should now be at the start of the unpinned region (index 1, after b).
    expect(grid.options.columns.map((col) => col.id)).toEqual(["b", "a", "c"]);
  });
});

describe("autosizeColumn", () => {
  test("computes a width for the target column", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A long header text", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
      autosize: false,
    });
    grid.autosizeColumn("a");
    const aAfter = grid.options.columns.find((col) => col.id === "a");
    expect(aAfter?.widthPx).toBeDefined();
    expect(aAfter?.widthPx).not.toBe(100);
  });

  test("synthetic column id is silently no-op'd", () => {
    const grid = makeGrid();
    grid.autosizeColumn("__pretable_row_select__");
    expect(grid.options.columns.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("resetColumnLayout", () => {
  test("restores widths and pinned state to the original input", () => {
    const grid = createGridCore<Row>({
      columns: [
        { id: "a", header: "A", widthPx: 100 },
        { id: "b", header: "B", widthPx: 100 },
        { id: "c", header: "C", widthPx: 100 },
      ],
      rows: baseRows,
      getRowId: (row) => row.id,
    });
    grid.setColumnWidth("a", 250);
    grid.setColumnPinned("c", "left");
    grid.resetColumnLayout();
    expect(grid.options.columns.map((col) => col.id)).toEqual(["a", "b", "c"]);
    expect(grid.options.columns.find((col) => col.id === "a")?.widthPx).toBe(
      100,
    );
    expect(
      grid.options.columns.find((col) => col.id === "c")?.pinned,
    ).toBeUndefined();
  });
});

describe("mergeColumnsFromProps", () => {
  test("preserves engine-state widths for surviving columns", () => {
    const grid = makeGrid();
    grid.setColumnWidth("b", 250);
    grid.mergeColumnsFromProps([
      { id: "a", header: "A", widthPx: 100 },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
      { id: "d", header: "D", widthPx: 100 },
    ]);
    expect(grid.options.columns.find((col) => col.id === "b")?.widthPx).toBe(
      250,
    );
  });

  test("adds new columns at their prop position with prop widthPx", () => {
    const grid = makeGrid();
    grid.mergeColumnsFromProps([
      { id: "a", header: "A", widthPx: 100 },
      { id: "new", header: "New", widthPx: 150 },
      { id: "b", header: "B", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
      { id: "d", header: "D", widthPx: 100 },
    ]);
    const newCol = grid.options.columns.find((col) => col.id === "new");
    expect(newCol?.widthPx).toBe(150);
    expect(grid.options.columns.map((col) => col.id)).toEqual([
      "a",
      "new",
      "b",
      "c",
      "d",
    ]);
  });

  test("drops removed columns", () => {
    const grid = makeGrid();
    grid.mergeColumnsFromProps([
      { id: "a", header: "A", widthPx: 100 },
      { id: "c", header: "C", widthPx: 100 },
    ]);
    expect(grid.options.columns.map((col) => col.id)).toEqual(["a", "c"]);
  });

  test("subsequent resetColumnLayout resets to the new prop shape", () => {
    const grid = makeGrid();
    grid.mergeColumnsFromProps([
      { id: "a", header: "A", widthPx: 100 },
      { id: "x", header: "X", widthPx: 100 },
    ]);
    grid.setColumnWidth("a", 250);
    grid.resetColumnLayout();
    expect(grid.options.columns.map((col) => col.id)).toEqual(["a", "x"]);
    expect(grid.options.columns.find((col) => col.id === "a")?.widthPx).toBe(
      100,
    );
  });
});
```

- [ ] **Step C1.9.2: Run the new test file**

```bash
pnpm --filter @pretable-internal/grid-core test column-layout
```

Expected: all tests pass. If any fail, read the error carefully — the most likely culprits are off-by-one in `moveColumn`'s pin-region calculation or `setColumnPinned`'s reposition index.

- [ ] **Step C1.9.3: Run the full grid-core suite**

```bash
pnpm --filter @pretable-internal/grid-core test
```

Expected: ALL test files pass (existing 55 + new ~17 = ~72 total).

- [ ] **Step C1.9.4: Commit Task 9**

```bash
git add packages/grid-core/src/__tests__/column-layout.test.ts
git commit -m "test(grid-core): column resize/reorder/pin coverage

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 10 — Forward new actions through `@pretable/core`

**Files:**

- Modify: `packages/core/src/create-grid.ts`

The `PretableGrid` interface uses `Omit<GridCoreStore<TRow>, "options">` so new methods inherit automatically through the type. But the runtime `createGrid` function explicitly forwards each method, so we need to add the 6 new ones (5 user-facing + `mergeColumnsFromProps`).

- [ ] **Step C1.10.1: Add the six new forwards**

In `packages/core/src/create-grid.ts`, find the existing forwards (the lines that look like `setSort: gridCore.setSort, …`). Add these after the existing column-adjacent action `autosizeColumns`:

```ts
    setColumnWidth: gridCore.setColumnWidth,
    moveColumn: gridCore.moveColumn,
    setColumnPinned: gridCore.setColumnPinned,
    autosizeColumn: gridCore.autosizeColumn,
    resetColumnLayout: gridCore.resetColumnLayout,
    mergeColumnsFromProps: gridCore.mergeColumnsFromProps,
```

- [ ] **Step C1.10.2: Typecheck `@pretable/core`**

```bash
pnpm --filter @pretable/core typecheck
```

Expected: passes.

- [ ] **Step C1.10.3: Run @pretable/core tests**

```bash
pnpm --filter @pretable/core test
```

Expected: passes.

- [ ] **Step C1.10.4: Commit Task 10**

```bash
git add packages/core/src/create-grid.ts
git commit -m "feat(core): forward column-layout actions through createGrid

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 11 — Repo-wide gates and PR

- [ ] **Step C1.11.1: Build all packages**

```bash
pnpm --filter "@pretable*" build
```

Expected: all packages build successfully.

- [ ] **Step C1.11.2: Run repo-wide typecheck**

```bash
pnpm -w typecheck
```

Expected: passes for every workspace.

- [ ] **Step C1.11.3: Run repo-wide tests**

```bash
pnpm -w test
```

Expected: all tests pass. Existing test count grows by ~17 from the new column-layout.test.ts.

- [ ] **Step C1.11.4: Run lint and format**

```bash
pnpm -w lint
pnpm format
```

Expected: 0 lint errors. If `pnpm format` reports issues, run `pnpm prettier --write .` and commit the result as a follow-up `style: prettier --write` commit.

- [ ] **Step C1.11.5: Push branch and open PR**

```bash
git push -u origin c1-engine-column-state
gh pr create --title "feat(grid-core): column resize + reorder engine foundation (Phase C1)" --body "$(cat <<'EOF'
## Summary

Phase C1 of sub-project C — engine state foundation for column resize and reorder. Spec: \`docs/superpowers/specs/2026-05-06-column-resize-reorder-design.md\`. Plan: \`docs/superpowers/plans/2026-05-06-column-resize-reorder.md\` (§Phase C1 detail).

## Engine changes

- New types on \`GridCoreColumn\`: \`minWidthPx\`, \`maxWidthPx\`, \`resizable\`, \`reorderable\`. All optional with engine-applied defaults.
- New actions on \`GridCoreStore\`: \`setColumnWidth\`, \`moveColumn\` (with cross-boundary auto-pin), \`setColumnPinned\`, \`autosizeColumn\`, \`resetColumnLayout\`, \`mergeColumnsFromProps\`.
- Engine captures an \`originalColumns\` snapshot at \`createGrid\` time; \`resetColumnLayout\` restores from it.
- Synthetic row-select column (\`__pretable_row_select__\`) is silently no-op'd by all column-mutation actions.

## Adapter forwarding

\`@pretable/core\` \`createGrid\` forwards the six new actions.

## What's NOT in this PR

- React adapter resize gesture — Phase C2.
- React adapter reorder gesture + cross-boundary auto-pin UX — Phase C3.
- Documentation page \`column-layout.mdx\` — lands with C3.

## Test plan

- [x] grid-core unit tests: column-layout.test.ts (~17 new tests)
- [x] @pretable/core typechecks and tests pass
- [x] @pretable/react typechecks (no behavior change)
- [x] repo-wide pnpm -w typecheck / test / lint / format pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens; CI starts.

- [ ] **Step C1.11.6: Watch CI and notify the user when green**

Use `gh pr checks <pr-number> --watch` or set auto-merge with `gh pr merge <pr-number> --auto --squash`. Do NOT merge directly — the user reserves merging per the standing workflow.

---

## Phase C2 — React adapter: resize gesture (DETAILED)

**Branch:** `c2-resize`. **Worktree:** `.worktrees/c2-resize`.

**Phase exit criteria:**

- New props on `<PretableSurface>`: `onColumnWidthsChange?`, `state.columnWidths?` (controlled), forwarded through `Pretable`, `InspectionGrid`, `LabeledGridSurface`.
- 4px resize hit area on every header cell where `column.resizable !== false`. Synthetic row-select column has no handle.
- Pointer events: `onPointerDown` captures initial width + pointer X; `onPointerMove` updates internal `dragLiveWidth` state and re-renders the cell + header at that width (engine state untouched); `onPointerUp` / `onPointerCancel` calls `grid.setColumnWidth(columnId, dragLiveWidth.width)`, which is the single commit point that fires `onColumnWidthsChange`. Drag-live width is React state (option A from open questions) — switch to ref-and-style-mutation only if profiling reveals real latency.
- `onDoubleClick` on the resize handle calls `grid.autosizeColumn(columnId)`. The dblclick listener guards against firing during/after a drag (a `wasDraggingRef` prevents the implicit dblclick that follows a quick down-up).
- New CSS tokens added to `packages/ui/src/tokens.css` and styled in `packages/ui/src/grid.css`. Hover state shows the handle; active drag adds `cursor: col-resize` to body.
- `usePretableModel` detects structural changes to the `columns` prop (column added/removed by id) via a ref-tracked previous id list; on change, calls `grid.mergeColumnsFromProps(newColumns)`.
- jsdom test coverage for: drag sequence (down/move/up), drag-end fires once, min/max clamp, handle absent for non-resizable columns, double-click autosizes, synthetic column has no handle, controlled `state.columnWidths` round-trip.
- `pnpm -w typecheck` / `test` / `lint` / `format` clean.

### Resolved open questions

- **Handle placement vs sort button**: the resize handle is a sibling `<div>` rendered alongside the existing `<button role="columnheader">`, absolutely positioned at the cell's right edge with a higher `z-index` than the button. `onPointerDown` on the handle calls `event.stopPropagation()` so the click doesn't reach the sort button. This keeps the existing sort-click behavior untouched.
- **Drag-live width state**: React state stored on the surface (`useState<{ columnId, width } | null>`). Re-renders during drag are scoped to the affected cell + header (existing layout already keys per column). Profile-driven optimization to ref + imperative style mutation can come later if needed; not in this phase.
- **Pointer capture for jsdom**: wrap `setPointerCapture` in `try/catch` so jsdom's no-op stub doesn't throw (consistent with Phase 3's marquee drag).
- **`onColumnWidthsChange` payload**: a `Record<string, number>` of every column's current `widthPx` (not just the changed one). This matches the established controlled-state pattern (consumer can persist the whole state in one setState).
- **Programmatic `setColumnWidth` from outside**: does NOT fire `onColumnWidthsChange`. Same pattern as Phase 6 announcements — only user-initiated commits fire callbacks. The keystone is firing the callback from inside the `onPointerUp` handler (and the dblclick autosize handler), not from a snapshot-diff effect.

### Tasks

#### Task 1 — Surface props + types

**Files:** `packages/react/src/use-pretable.ts`, `packages/react/src/pretable-surface.tsx`.

In `use-pretable.ts`, extend `PretableSurfaceState`:

```ts
export interface PretableSurfaceState {
  filters?: Record<string, string>;
  focus?: PretableFocusState;
  selection?: PretableSelectionState;
  sort?: PretableSortState | null;
  columnWidths?: Record<string, number>; // NEW
}
```

In `pretable-surface.tsx`, add to `PretableSurfaceProps<TRow>`:

```ts
onColumnWidthsChange?: (next: Record<string, number>) => void;
```

Forward through `pretable.tsx`, `labeled-grid-surface.tsx`, `inspection-grid.tsx` like other prop-forwarding patterns established in earlier phases.

In `usePretableModel` (in `use-pretable.ts`), inside the `if (state)` block, add the columnWidths apply step (after the existing filters step):

```ts
if (state.columnWidths !== undefined) {
  const widths = state.columnWidths;
  for (const column of grid.options.columns) {
    const next = widths[column.id];
    if (next !== undefined && next !== column.widthPx) {
      grid.setColumnWidth(column.id, next);
    }
  }
}
```

This is the controlled-mode injection: when consumer provides `state.columnWidths`, force the engine to it on every render.

**Commit:** `feat(react): state.columnWidths + onColumnWidthsChange prop`.

#### Task 2 — Detect structural columns prop changes

**Files:** `packages/react/src/use-pretable.ts`.

In `usePretableModel`, add a `useLayoutEffect` that compares the columns array's ids against the previous render's ids. If they differ, call `grid.mergeColumnsFromProps(columns)`.

```ts
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
```

The first render sets the ref but does NOT call merge (engine already initialized from these columns). Subsequent renders with structural differences trigger a merge.

Note: a "structural difference" means id-list mismatch. Per-column changes to `header`, `widthPx`, etc. without an id change do NOT trigger a merge (the engine already preserves its mutated state across non-structural prop updates because we never re-init from prop after the first render).

**Commit:** `feat(react): merge columns from prop on structural change`.

#### Task 3 — Resize handle DOM + pointer events

**Files:** `packages/react/src/pretable-surface.tsx`, `packages/ui/src/tokens.css`, `packages/ui/src/grid.css`.

Add to `tokens.css`:

```css
--pt-color-resize-handle: transparent;
--pt-color-resize-handle-hover: var(--pt-color-selection-border);
```

Add to `grid.css`:

```css
[data-pretable-resize-handle] {
  position: absolute;
  top: 0;
  right: 0;
  width: 4px;
  height: 100%;
  cursor: col-resize;
  background: var(--pt-color-resize-handle);
  z-index: 2;
  user-select: none;
  touch-action: none;
}
[data-pretable-resize-handle]:hover,
[data-pretable-resize-handle][data-dragging="true"] {
  background: var(--pt-color-resize-handle-hover);
}
```

In `pretable-surface.tsx`, add the resize state:

```ts
const [dragLiveWidth, setDragLiveWidth] = useState<{
  columnId: string;
  width: number;
} | null>(null);
const resizeStateRef = useRef<{
  columnId: string;
  startX: number;
  startWidth: number;
  pointerId: number;
} | null>(null);
const wasResizingRef = useRef(false);
```

For each rendered header cell where the column has `resizable !== false` AND id is not `ROW_SELECT_COLUMN_ID`, render a sibling element next to the header button:

```tsx
<div
  data-pretable-resize-handle=""
  data-column-id={column.id}
  data-dragging={dragLiveWidth?.columnId === column.id ? "true" : "false"}
  onPointerDown={(event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const startWidth = column.widthPx ?? Math.max(column.minWidthPx ?? 40, 80);
    resizeStateRef.current = {
      columnId: column.id,
      startX: event.clientX,
      startWidth,
      pointerId: event.pointerId,
    };
    wasResizingRef.current = false;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom — no-op
    }
    setDragLiveWidth({ columnId: column.id, width: startWidth });
  }}
  onPointerMove={(event) => {
    const drag = resizeStateRef.current;
    if (!drag || drag.columnId !== column.id) return;
    const min = column.minWidthPx ?? 40;
    const max = column.maxWidthPx ?? Infinity;
    const next = Math.max(
      min,
      Math.min(max, drag.startWidth + (event.clientX - drag.startX)),
    );
    if (Math.abs(next - drag.startWidth) > 0) {
      wasResizingRef.current = true;
    }
    setDragLiveWidth({ columnId: column.id, width: next });
  }}
  onPointerUp={(event) => {
    const drag = resizeStateRef.current;
    if (!drag || drag.columnId !== column.id) return;
    const finalWidth = dragLiveWidth?.width ?? drag.startWidth;
    grid.setColumnWidth(column.id, finalWidth);
    onColumnWidthsChange?.(buildWidthsMap(grid));
    resizeStateRef.current = null;
    setDragLiveWidth(null);
  }}
  onPointerCancel={() => {
    resizeStateRef.current = null;
    setDragLiveWidth(null);
    wasResizingRef.current = false;
  }}
  onDoubleClick={(event) => {
    if (wasResizingRef.current) {
      // Suppress dblclick that fires after a drag-resize.
      event.preventDefault();
      wasResizingRef.current = false;
      return;
    }
    grid.autosizeColumn(column.id);
    onColumnWidthsChange?.(buildWidthsMap(grid));
  }}
/>
```

Helper at the bottom of the file:

```ts
function buildWidthsMap<TRow extends PretableRow>(
  grid: PretableGrid<TRow>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const col of grid.options.columns) {
    if (col.id === ROW_SELECT_COLUMN_ID) continue;
    if (typeof col.widthPx === "number") {
      result[col.id] = col.widthPx;
    }
  }
  return result;
}
```

For the cell render path (body cells AND header cells), if `dragLiveWidth?.columnId === column.id`, override the rendered width with `dragLiveWidth.width`. The simplest way is to pass an override into the existing `getCellStyle`/`getHeaderCellStyle` callsites, OR compute the column's effective width once per render and use it everywhere.

Recommended approach: compute `columnWidthOverrides: Record<string, number>` once per render at the top of the component:

```ts
const columnWidthOverrides = useMemo(
  () =>
    dragLiveWidth ? { [dragLiveWidth.columnId]: dragLiveWidth.width } : null,
  [dragLiveWidth],
);
```

Then wherever the rendering reads `column.widthPx`, prefer `columnWidthOverrides?.[column.id] ?? column.widthPx`.

**Commit:** `feat(react+ui): resize handle + drag-live width preview`.

#### Task 4 — jsdom tests

**Files:** `packages/react/src/__tests__/pretable-surface.test.tsx`.

Add a new `describe("column resize", ...)` block. Tests:

1. **Resize handle renders for resizable columns** — render harness with default columns; assert `[data-pretable-resize-handle]` exists for each column.
2. **No handle for `column.resizable === false`** — column with the flag, assert no handle for that column.
3. **No handle for synthetic row-select column** — `rowSelectionColumn={{enabled:true}}`, assert handle is absent on the synthetic column's header.
4. **PointerDown + Move + Up commits the new width** — fire `pointerDown` on a handle, then `pointerMove` with `clientX` shifted +50, then `pointerUp`. Assert `onColumnWidthsChange` fires exactly once at the end with the new width for that column.
5. **Resize honors per-column min** — column with `minWidthPx: 80`. Drag with delta -200; assert final width is 80.
6. **Resize honors per-column max** — column with `maxWidthPx: 200`. Drag with delta +500; assert final width is 200.
7. **Drag-live width re-renders the cell** — after `pointerMove` (without `pointerUp`), query the cell's `style.width` and assert it reflects the live drag width, NOT the original.
8. **Double-click on handle calls autosize** — fire `dblClick` on handle; assert `onColumnWidthsChange` fires once and the column's width changes (compared against original).
9. **Drag followed by dblclick suppresses autosize** — pointerDown + tiny pointerMove (>0px) + pointerUp + immediate dblclick. The dblclick must NOT trigger autosize (verified by stable width or `onColumnWidthsChange` only firing once for the resize commit, not twice).
10. **Programmatic `grid.setColumnWidth` from outside does NOT fire `onColumnWidthsChange`** — render with the callback as a vi.fn(); call `grid.setColumnWidth` directly via `onGridReady`; assert callback was not called.
11. **Controlled `state.columnWidths` round-trip** — render with `state.columnWidths={{ a: 250 }}`; assert column "a" renders at 250. Re-render with `state.columnWidths={{ a: 320 }}`; assert column "a" renders at 320.
12. **Resize handle stopPropagation does not break sort** — pointerDown on handle, pointerUp without movement; the column header sort button must NOT have triggered a sort change. (Tests the stopPropagation contract.)

Use `fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: ... })` and friends, consistent with Phase 3's marquee tests.

For the drag-live-width re-render test: the cell's width is set inline via the existing `getCellStyle` which takes `width` from the column. After `pointerMove`, the affected cell's `style.width` should reflect the live drag width.

**Commit:** `test(react): column resize gesture coverage`.

#### Task 5 — Doc updates

**Files:** `apps/website/content/docs/grid/pretable-surface.mdx`, `apps/website/content/docs/grid/api-reference.mdx`.

In `pretable-surface.mdx`, add `onColumnWidthsChange` to the props table. The full `column-layout.mdx` docs page lands in C3.

In `api-reference.mdx`, add the new `state.columnWidths` slice to the `PretableSurfaceState` interface. The C3 docs page is the canonical reference for the full column-layout surface.

**Commit:** `docs(website): document onColumnWidthsChange + state.columnWidths`.

#### Task 6 — Repo-wide gates + PR

`pnpm -w typecheck` / `test` / `lint` / `format` clean. Push, open PR titled `feat(react): column resize gesture (Phase C2 of C)`. Body explains the resize-handle DOM + pointer events, drag-live preview state, drag-end commit semantics, the synthetic-column exclusion, the dblclick-autosize guard, and the structural-prop-change merge.

---

## Phase C3 — React adapter: reorder gesture + docs (DETAILED)

**Branch:** `c3-reorder`. **Worktree:** `.worktrees/c3-reorder`.

**Phase exit criteria:**

- New surface props: `onColumnOrderChange?: (next: readonly string[]) => void`, `onColumnPinnedChange?: (next: Record<string, "left" | null>) => void`, `state.columnOrder?: readonly string[]`, `state.columnPinned?: Record<string, "left" | null>`. Forwarded through `Pretable`, `InspectionGrid`, `LabeledGridSurface`.
- Reorder pointer-event sequence on header buttons where `column.reorderable !== false` and id is not `__pretable_row_select__`:
  - 5px threshold disambiguates click-for-sort from drag-for-reorder.
  - Ghost element follows cursor while dragging (low-opacity clone of the header).
  - Drop indicator (2px vertical line) snaps to the nearest column boundary based on cursor X.
  - `pointerUp` over a valid drop position calls `grid.moveColumn(columnId, toIndex)`. Engine handles cross-boundary auto-pin.
  - `Esc` during drag cancels without engine mutation.
- Both callbacks fire on user-initiated drag-end, not on programmatic engine mutations or controlled-prop reapply.
- jsdom tests for: threshold-based drag start, drag commit, cross-boundary auto-pin (callbacks for both order AND pin), Esc cancel, synthetic column non-draggable, `column.reorderable === false` skip, controlled-state round-trips for order and pin.
- New `apps/website/content/docs/grid/column-layout.mdx` page covers the full surface (resize, reorder, pin, autosize, controlled state). Linked from `_nav.ts` between Clipboard and Custom rendering.
- `api-reference.mdx` gets updated `PretableSurfaceState` shape (adds `columnOrder` + `columnPinned`) and `PretableGrid` actions table (5 column-layout actions + `mergeColumnsFromProps`).
- `pretable-surface.mdx` props table adds the two new callbacks; brief Column Layout section links to the new page.
- `pnpm -w typecheck` / `test` / `lint` / `format` clean.
- One PR opened, CI green, user merges.

### Resolved open questions

- **Ghost positioning**: `position: fixed` inside the surface root. The ghost is rendered via React (no portal). Coordinates come from pointer events. If the cursor leaves the surface, the ghost simply stays at the last in-bounds position — releasing outside the surface bounds cancels the drag (treated as `pointerCancel`).
- **Auto-scroll during reorder drag**: deferred. The horizontal-scroll case is uncommon for the existing demos; a follow-up can add it once we have a real consumer with a wide grid + many overflow columns.
- **Drop indicator snap targets**: between every pair of adjacent visible columns. With N columns there are N+1 snap positions (left of col 0, between 0/1, ..., right of col N-1). When the synthetic row-select column is at position 0, the leftmost valid snap is at index 1 (cursor between synth and first user column).
- **Threshold of 5px**: matches AG Grid / common drag UX. Pure-click pointerDown→pointerUp without movement passes through to the existing sort-click handler.
- **Controlled `state.columnPinned`**: a `Record<string, "left" | null>` where `"left"` means pinned and `null` means explicitly unpinned. A column id absent from the record falls back to whatever the engine currently has.

### Tasks

#### Task 1 — Surface props + state slices + callback forwarding

**Files:** `packages/react/src/use-pretable.ts`, `packages/react/src/pretable-surface.tsx`, `packages/react/src/pretable.tsx`, `packages/react/src/labeled-grid-surface.tsx`, `packages/react/src/inspection-grid.tsx`.

In `use-pretable.ts`, extend `PretableSurfaceState`:

```ts
export interface PretableSurfaceState {
  filters?: Record<string, string>;
  focus?: PretableFocusState;
  selection?: PretableSelectionState;
  sort?: PretableSortState | null;
  columnWidths?: Record<string, number>;
  columnOrder?: readonly string[]; // NEW
  columnPinned?: Record<string, "left" | null>; // NEW
}
```

In `usePretableModel`, inside the `if (state)` block, add controlled-state injection for the two new slices (after the existing `columnWidths` injection):

```ts
if (state.columnOrder !== undefined) {
  // Apply order by repositioning each column to its position in the
  // requested order. Missing ids are appended at the end (engine
  // contract).
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
```

In `pretable-surface.tsx`, add to `PretableSurfaceProps<TRow>`:

```ts
onColumnOrderChange?: (next: readonly string[]) => void;
onColumnPinnedChange?: (next: Record<string, "left" | null>) => void;
```

Forward through `Pretable`, `LabeledGridSurface`, `InspectionGrid` per the established pattern.

Verify: `pnpm --filter "@pretable*" build && pnpm -w typecheck && pnpm --filter @pretable/react test`. Existing 181 tests still pass.

**Commit:** `feat(react): state.columnOrder + state.columnPinned + reorder callbacks`.

#### Task 2 — Reorder gesture: pointer events, ghost, drop indicator

**Files:** `packages/react/src/pretable-surface.tsx`, `packages/ui/src/tokens.css`, `packages/ui/src/grid.css`.

Add CSS tokens to `tokens.css`:

```css
--pt-color-reorder-ghost-bg: var(--pt-color-surface, #fff);
--pt-color-reorder-ghost-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
--pt-color-reorder-drop-indicator: var(--pt-color-focus-ring);
```

Add to `grid.css`:

```css
[data-pretable-reorder-ghost] {
  position: fixed;
  pointer-events: none;
  background: var(--pt-color-reorder-ghost-bg);
  box-shadow: var(--pt-color-reorder-ghost-shadow);
  opacity: 0.6;
  z-index: 10;
  user-select: none;
}
[data-pretable-reorder-drop-indicator] {
  position: absolute;
  top: 0;
  width: 2px;
  background: var(--pt-color-reorder-drop-indicator);
  z-index: 9;
  pointer-events: none;
}
```

In `pretable-surface.tsx`, add reorder state to the component body:

```ts
const reorderStateRef = useRef<{
  columnId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
} | null>(null);
const [reorderDrag, setReorderDrag] = useState<{
  columnId: string;
  cursorX: number;
  cursorY: number;
  dropIndex: number; // target index in effectiveColumns
  ghostWidth: number;
  ghostHeight: number;
  ghostHeader: string;
} | null>(null);

const REORDER_THRESHOLD_PX = 5;
```

For each header button render where `column.reorderable !== false` AND `column.id !== ROW_SELECT_COLUMN_ID`, attach pointer handlers to the header BUTTON itself (not the resize handle). The resize handle's `stopPropagation` already prevents resize-pointer events from triggering reorder.

Handler shape:

```tsx
onPointerDown={(event) => {
  if (event.button !== 0) return;
  if (event.shiftKey || event.metaKey || event.ctrlKey) return;
  reorderStateRef.current = {
    columnId: column.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    dragging: false,
  };
}}
onPointerMove={(event) => {
  const drag = reorderStateRef.current;
  if (!drag || drag.columnId !== column.id) return;
  if (event.pointerId !== drag.pointerId) return;

  const dx = event.clientX - drag.startX;
  const dy = event.clientY - drag.startY;
  const dist = Math.hypot(dx, dy);

  if (!drag.dragging) {
    if (dist < REORDER_THRESHOLD_PX) return;
    drag.dragging = true;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom — no-op
    }
    // Capture ghost dimensions from the header element.
    const headerEl = event.currentTarget as HTMLElement;
    const rect = headerEl.getBoundingClientRect();
    setReorderDrag({
      columnId: column.id,
      cursorX: event.clientX,
      cursorY: event.clientY,
      dropIndex: computeDropIndex(event.clientX, effectiveColumns, /* layout info */),
      ghostWidth: rect.width,
      ghostHeight: rect.height,
      ghostHeader: column.header ?? column.id,
    });
    return;
  }

  setReorderDrag((prev) =>
    prev
      ? {
          ...prev,
          cursorX: event.clientX,
          cursorY: event.clientY,
          dropIndex: computeDropIndex(event.clientX, effectiveColumns, /* layout info */),
        }
      : null,
  );
}}
onPointerUp={(event) => {
  const drag = reorderStateRef.current;
  if (!drag || drag.columnId !== column.id) return;
  if (event.pointerId !== drag.pointerId) return;

  if (drag.dragging && reorderDrag) {
    const before = grid.getSnapshot();
    const beforePinned = buildPinnedMap(grid);
    grid.moveColumn(column.id, reorderDrag.dropIndex);
    const after = grid.getSnapshot();
    const afterOrder = grid.options.columns.map((c) => c.id);
    onColumnOrderChange?.(afterOrder);
    const afterPinned = buildPinnedMap(grid);
    if (!pinnedMapsEqual(beforePinned, afterPinned)) {
      onColumnPinnedChange?.(afterPinned);
    }
  }

  reorderStateRef.current = null;
  setReorderDrag(null);
}}
onPointerCancel={() => {
  reorderStateRef.current = null;
  setReorderDrag(null);
}}
```

Helper functions at the bottom of the file:

```ts
function buildPinnedMap<TRow extends PretableRow>(
  grid: PretableGrid<TRow>,
): Record<string, "left" | null> {
  const result: Record<string, "left" | null> = {};
  for (const col of grid.options.columns) {
    if (col.id === ROW_SELECT_COLUMN_ID) continue;
    result[col.id] = col.pinned === "left" ? "left" : null;
  }
  return result;
}

function pinnedMapsEqual(
  a: Record<string, "left" | null>,
  b: Record<string, "left" | null>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

function computeDropIndex(
  cursorX: number,
  columns: PretableColumn<unknown>[],
  /* layout: pass the renderSnapshot's column left positions */
  columnLefts: number[],
  columnWidths: number[],
  surfaceLeft: number,
): number {
  // Cursor X is in viewport coordinates. Convert to surface-relative.
  const x = cursorX - surfaceLeft;
  for (let i = 0; i < columns.length; i += 1) {
    const left = columnLefts[i] ?? 0;
    const width = columnWidths[i] ?? 0;
    const mid = left + width / 2;
    if (x < mid) {
      return i;
    }
  }
  return columns.length - 1;
}
```

The `computeDropIndex` helper needs the per-column left positions and widths. Look at how the existing rendering computes column lefts (`getPinnedLeftOffsets`, `renderSnapshot.columns`). The simplest path: at render time, capture an array of `[left, width]` pairs from `renderSnapshot.columns` (or compute from `effectiveColumns` if pinned offsets are needed). Pass that array into `computeDropIndex` along with the cursor X.

Render the ghost + drop indicator inside the surface root when `reorderDrag !== null`:

```tsx
{
  reorderDrag && (
    <>
      <div
        data-pretable-reorder-ghost=""
        style={{
          left: reorderDrag.cursorX + 8,
          top: reorderDrag.cursorY + 8,
          width: reorderDrag.ghostWidth,
          height: reorderDrag.ghostHeight,
          display: "flex",
          alignItems: "center",
          paddingLeft: 12,
        }}
      >
        {reorderDrag.ghostHeader}
      </div>
      <div
        data-pretable-reorder-drop-indicator=""
        style={{
          left: computeDropIndicatorLeft(reorderDrag.dropIndex, columnLefts),
          height: reorderDrag.ghostHeight + bodyViewportHeight,
        }}
      />
    </>
  );
}
```

(The `computeDropIndicatorLeft` helper returns the X position for the indicator — the left edge of the column at `dropIndex`, or the right edge of the last column if `dropIndex === columns.length`.)

**Esc cancellation**: extend the existing `onKeyDown` handler near the surface root. If `reorderStateRef.current?.dragging` is true, set both refs to null without calling `grid.moveColumn`.

Verify: `pnpm --filter "@pretable*" build && pnpm -w typecheck && pnpm --filter @pretable/react test`. Existing 181 tests still pass.

**Commit:** `feat(react+ui): reorder gesture with ghost and drop indicator`.

#### Task 3 — jsdom tests for reorder

**Files:** `packages/react/src/__tests__/pretable-surface.test.tsx`.

Add a new `describe("column reorder", ...)` block. Tests:

1. **PointerDown + small move (<5px) + pointerUp triggers sort, not reorder** — fire pointerDown on the column header button, then a 2px pointerMove, then pointerUp + click. Assert sort changed; `onColumnOrderChange` was NOT called.
2. **PointerDown + 6px move + pointerUp triggers reorder** — fire pointerDown, pointerMove with clientX shifted +6, pointerUp at the new position. Assert `onColumnOrderChange` fires once with the new order.
3. **Reorder fires `onColumnOrderChange` with the post-move order** — drag column "a" past column "b". Assert callback payload is the reordered ids.
4. **Cross-boundary auto-pin: dragging unpinned into pinned region fires both `onColumnOrderChange` and `onColumnPinnedChange`** — set up grid with column "a" pinned, "b" unpinned. Drag "b" to position 0 (or wherever lands in pinned region). Assert both callbacks fire; pinned map shows "b" pinned.
5. **Cross-boundary auto-unpin** — opposite direction. Drag pinned "a" out into unpinned region. Both callbacks fire; "a" is unpinned.
6. **Esc during drag cancels** — pointerDown + 6px pointerMove (drag started) + Escape keydown. Assert `onColumnOrderChange` was NOT called; engine state unchanged.
7. **Synthetic row-select column has no reorder handlers** — render with `rowSelectionColumn={{enabled:true}}`. Try to fire pointerDown on the synthetic column's header. Assert no reorder state is set (look at the impl — probably no handlers attached, so the test asserts the synthetic column doesn't render a reorderable header).
8. **`column.reorderable === false` skips reorder** — column with the flag. Drag past threshold; assert `onColumnOrderChange` was NOT called.
9. **Programmatic `grid.moveColumn` does NOT fire callbacks** — call directly via `onGridReady`. Assert callbacks not called.
10. **Controlled `state.columnOrder` round-trip** — render with `state={{ columnOrder: ["b", "a", "c"] }}`. Assert rendered column order matches. Re-render with different order; assert it follows.
11. **Controlled `state.columnPinned` round-trip** — render with `state={{ columnPinned: { c: "left" } }}`. Assert column "c" is pinned.

Test count target: 181 → 192+.

For pointer events use `fireEvent.pointerDown/Move/Up` with appropriate `pointerId`, `button: 0`, `clientX/Y`. For Esc cancel: `fireEvent.keyDown(grid, { key: "Escape" })`.

**Commit:** `test(react): column reorder gesture coverage`.

#### Task 4 — New `column-layout.mdx` docs page

**Files:** Create `apps/website/content/docs/grid/column-layout.mdx`. Update `apps/website/app/docs/_nav.ts`. Update `apps/website/content/docs/grid/api-reference.mdx`.

Frontmatter for the new page:

```
---
title: Column Layout
description: "Resize, reorder, pin, and autosize columns; per-column min/max; controlled state."
nav: Grid
order: 7
---
```

Content sections:

- Opening paragraph: "Pretable supports column resize, reorder, pin, and autosize out of the box. All three live behind narrow controlled-state slices that mirror the established pattern."
- **Resize**: 4px right-edge handle, drag commits on release, double-click autosizes one column. Per-column `minWidthPx`/`maxWidthPx`/`resizable`.
- **Reorder**: drag the header. 5px threshold disambiguates from sort click. Cross-boundary auto-pin: dragging into the leftmost pinned region pins; dragging out unpins. Per-column `reorderable`.
- **Pin**: explicit `grid.setColumnPinned(id, "left" | null)`. Repositions to the pin-region boundary. Synthetic row-select column always at position 0; never reorderable / pinnable / resizable.
- **Autosize**: `grid.autosizeColumn(id)` for one column; `grid.autosizeColumns()` for all. Double-click on the resize handle is the keyboard-free shortcut.
- **Reset**: `grid.resetColumnLayout()` restores order, widths, pinned to the original `columns` prop snapshot.
- **Controlled state**: three slices (`columnWidths`, `columnOrder`, `columnPinned`) and three callbacks (`onColumnWidthsChange`, `onColumnOrderChange`, `onColumnPinnedChange`). Drag-end-only emission. Programmatic mutations do not fire callbacks.
- **Code example**: a small `<PretableSurface>` snippet with `state.columnWidths` + `useState` round-trip. ≤30 lines.
- **See also**: link to selection, keyboard, clipboard.

Bump `order` on subsequent pages: custom-rendering 7→8, density-helpers 8→9, api-reference 9→10. Update `_nav.ts` to insert `Column layout` between `Clipboard` and `Custom rendering`.

In `api-reference.mdx`, add the column-layout types section:

```ts
interface PretableSurfaceState {
  // ... existing slices
  columnWidths?: Record<string, number>;
  columnOrder?: readonly string[];
  columnPinned?: Record<string, "left" | null>;
}
```

Add the 5 new actions + `mergeColumnsFromProps` to the `PretableGrid` actions table.

In `pretable-surface.mdx`, add the two new callbacks to the props table (alongside the existing `onColumnWidthsChange` from C2).

**Commit:** `docs(website): column-layout page + api-reference + nav integration`.

#### Task 5 — Repo-wide gates + PR

`pnpm -w typecheck` / `test` / `lint` / `format` clean. Push, open PR titled `feat(react): column reorder + cross-boundary auto-pin (Phase C3 of C)`. Body explains the threshold-based drag start, the ghost + drop indicator, cross-boundary auto-pin via the C1 engine action, the new docs page, and that this completes sub-project C.

---

## Self-Review

**Spec coverage check** (against `2026-05-06-column-resize-reorder-design.md`):

| Spec section                                                        | Covered by                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Engine state + actions (5 actions + mergeColumnsFromProps)          | C1 Tasks 3-8 (one task per action + the snapshot/merge helpers)       |
| Column type extension (minWidthPx/maxWidthPx/resizable/reorderable) | C1 Task 1                                                             |
| Synthetic row-select column exclusion                               | C1 Tasks 3, 4, 5, 6, 9 (each action's no-op branch + tests)           |
| Min/max width clamping                                              | C1 Tasks 3, 9                                                         |
| Pinned-region boundary semantics                                    | C1 Tasks 4, 9                                                         |
| Drag-end-only callback emission                                     | C2/C3 Outlines (callbacks fire from event handlers, not engine emits) |
| Prop-merge semantics on column add/remove                           | C1 Tasks 8, 9                                                         |
| Controlled state slices (columnWidths/Order/Pinned)                 | C2/C3 Outlines                                                        |
| Resize gesture                                                      | C2 Outline                                                            |
| Reorder gesture + cross-boundary auto-pin                           | C3 Outline                                                            |
| Per-column resizable/reorderable opt-out                            | C2/C3 Outlines + tests                                                |
| Documentation (column-layout.mdx)                                   | C3 Outline                                                            |

All spec sections are covered.

**Placeholder scan:** None remain. The phase outlines are explicitly outlines (not bite-sized tasks); they will be detailed before their phase begins. The "Open questions to resolve when detailing" subsections record decisions to make at detail-time, not skipped detail.

**Type consistency check:**

- `GridCoreColumn` extension fields (`minWidthPx`, `maxWidthPx`, `resizable`, `reorderable`) are referenced consistently across Tasks 1, 3, 9.
- `setColumnWidth(columnId: string, width: number)` matches between type definition (Task 2), implementation (Task 3), tests (Task 9), and `@pretable/core` forward (Task 10).
- `moveColumn(columnId: string, toIndex: number)` consistent across Tasks 2, 4, 9, 10.
- `setColumnPinned(columnId: string, pinned: "left" | null)` consistent.
- `mergeColumnsFromProps(nextColumns)` declared in Task 8, tested in Task 9, forwarded in Task 10.
- `ROW_SELECT_COLUMN_ID = "__pretable_row_select__"` defined locally in Task 3 (in `create-grid-core.ts`); the existing `packages/react/src/constants.ts` already exports the same string. Both must stay in sync — documented as an invariant in Task 3.

**Scope check:** Phase C1 is bounded to engine changes only. No React adapter, no docs, no UX. The phase produces a working, testable engine update; the React adapter consumes it in C2 and C3.

---

## After Phase C1 merges

When C1 lands on `main`, append a "## Phase C2 — Detailed Tasks" section to this file (in a new `c2-resize` worktree), replacing the C2 outline above with bite-sized tasks. Then execute. Repeat for C3.
