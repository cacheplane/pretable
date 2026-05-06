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

Co-Authored-By: Assistant Opus 4.7 <noreply@anthropic.com>"
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

Co-Authored-By: Assistant Opus 4.7 <noreply@anthropic.com>"
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

Co-Authored-By: Assistant Opus 4.7 <noreply@anthropic.com>"
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

🤖 Generated with [Assistant Code](https://assistant.com/assistant-code)
EOF
)"
```

Expected: PR opens; CI starts.

- [ ] **Step C1.11.6: Watch CI and notify the user when green**

Use `gh pr checks <pr-number> --watch` or set auto-merge with `gh pr merge <pr-number> --auto --squash`. Do NOT merge directly — the user reserves merging per the standing workflow.

---

## Phase C2 — React adapter: resize gesture (OUTLINE)

**Branch:** `c2-resize`. **Detail:** added when C1 merges.

**Work items:**

- New surface props: `onColumnWidthsChange?`, `state.columnWidths` (controlled).
- 4px resize hit area on every header cell where `column.resizable !== false`.
- Pointer events: `onPointerDown` captures initial width; `onPointerMove` updates a `dragLiveWidth` ref + forces re-render with that width applied; `onPointerUp` calls `grid.setColumnWidth(columnId, dragLiveWidth)` (which fires `onColumnWidthsChange`); clear ref.
- `onDoubleClick` on the resize handle calls `grid.autosizeColumn(columnId)`.
- CSS tokens: `--pt-color-resize-handle` (transparent default), `--pt-color-resize-handle-hover` (selection-border accent).
- jsdom tests:
  - pointerDown/move/up sequence — assert `onColumnWidthsChange` fires once at end with the post-clamp width.
  - Resize honors per-column min/max.
  - Resize handle absent when `column.resizable === false`.
  - Double-click on the handle calls autosize.
  - Synthetic row-select column has no resize handle.
  - Controlled `state.columnWidths` round-trip: consumer commits via `useState` setter, rendered widths follow.
- Forward `onColumnWidthsChange` through `Pretable`, `InspectionGrid`, `LabeledGridSurface`.
- Detect structural `columns` prop changes in `usePretableModel` and call `grid.mergeColumnsFromProps(newColumns)`.

**Open questions to resolve when detailing:**

- Resize handle's position: absolute inside the header cell, anchored right edge — interaction with the existing header `<button role="columnheader">` click for sort. Likely the handle is a sibling `<div>` with higher `z-index` and `event.stopPropagation()` on `onPointerDown`.
- Drag-live width: stored as React state (re-renders) or as a ref + manual style mutation (avoids re-render thrash). Default to React state; switch to ref if profiling reveals latency.

---

## Phase C3 — React adapter: reorder gesture + docs (OUTLINE)

**Branch:** `c3-reorder`. **Detail:** added when C2 merges.

**Work items:**

- New surface props: `onColumnOrderChange?`, `onColumnPinnedChange?`, `state.columnOrder` (controlled), `state.columnPinned` (controlled).
- Pointer events on header body (where `column.reorderable !== false`):
  - `onPointerDown` (button 0, no modifiers): set `reorderState` ref with start position; do NOT start drag yet.
  - `onPointerMove`: if distance from start > 5px, start drag — `setPointerCapture`, render ghost (clone of the header, follows cursor with low opacity), render drop-indicator vertical line at the nearest column boundary.
  - `onPointerUp`: if dragging, call `grid.moveColumn(columnId, toIndex)` (engine handles cross-boundary auto-pin and emits both `onColumnOrderChange` and `onColumnPinnedChange` if pin changed). Clear ghost + indicator. If not dragging, let the click event fire normally (sort).
  - `Esc` during drag: cancel without calling the engine.
- CSS tokens: `--pt-color-reorder-ghost-bg`, `--pt-color-reorder-ghost-shadow`, `--pt-color-reorder-drop-indicator`.
- jsdom tests:
  - Threshold-based drag start: pointerDown + small move + pointerUp triggers sort click; pointerDown + 6px move + pointerUp triggers reorder.
  - Reorder fires `onColumnOrderChange` once on drag-end.
  - Cross-boundary reorder: dragging unpinned → pinned region fires both callbacks; pin state updates.
  - Esc cancels.
  - Synthetic row-select column is non-draggable.
  - Reorder respects `column.reorderable === false`.
  - Controlled `state.columnOrder` round-trip.
  - Controlled `state.columnPinned` round-trip.
- Forward `onColumnOrderChange` and `onColumnPinnedChange` through composition components.
- New docs page: `apps/website/content/docs/grid/column-layout.mdx` — covers resize, reorder, pin, autosize, controlled state. Linked from `_nav.ts` after Clipboard.
- Update `api-reference.mdx` with the new types, actions, surface props, and callbacks.
- Surface page (`pretable-surface.mdx`) gains a brief Column Layout section linking out, plus new props in the props table.

**Open questions to resolve when detailing:**

- Ghost element positioning: `position: fixed` in document body (portal) vs absolute inside the surface root. Portal is more correct (follows cursor across other layout) but adds a portal dep. Default to `position: fixed` inside the surface; if cursor leaves the surface, the ghost stays at the boundary.
- Auto-scroll during reorder drag: if cursor is near the viewport edge, do we scroll the column container? Grid Alpha does. Defer to a follow-up unless trivial — the surface's column container isn't always horizontally scrollable.

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
