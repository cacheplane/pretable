# Column Resize + Reorder (Sub-project C)

## Goal

Make column widths and column order user-mutable at runtime through standard grid gestures: drag the right edge of a header to resize, drag the header itself to reorder, double-click the resize handle to autosize. Pin/unpin happens implicitly when a reorder crosses the pinned-region boundary. The new state is independently controllable through narrow `state.*` slices, mirroring the existing pattern from sub-project B.

## Position in the Tier 1 Roadmap

Sub-project C is the next item after sub-project B per the user-confirmed priority (`project_tier1_revised_priority.md`):

1. ~~B — selection + keyboard nav~~ ✅ shipped (Phase 7 bench deferred).
2. **C — column resize + reorder (this spec).**
3. D — cell renderers (separate brainstorm).
4. A — public API stabilization (audit + contract tests).
5. B Phase 7 — Bench Slab 1 (selection/nav latency hypotheses).

## Non-Goals

- Right-pinned columns. Pretable currently supports `pinned: "left"` only. Right-pinning is its own design problem and deferred.
- Column groups / nested headers. No current consumer renders them; deferred.
- Column visibility (show/hide picker). Different UX surface; deferred.
- Bench validation of resize/reorder latency. Same focused-session strategy as Phase 7 of B; tracked separately.
- HTML5 drag-and-drop. Pointer Events are used everywhere (consistent with Phase 3's marquee drag, jsdom-friendly).

## Selection-model recap (context, not changed)

Sub-project B's cell-range selection state is unaffected. Ranges store stable column IDs, so reordering columns does not invalidate selections — the data they refer to follows. Resizing columns has no semantic effect on selection.

## Engine state + actions

The engine in `@pretable-internal/grid-core` owns column display state internally. On `createGrid({ columns, ... })` the engine clones the user's column array as the initial display state. After that, column state is mutable only through the engine actions below; the `options.columns` array snapshot reflects the current display state when read via `grid.options.columns` or via `getSnapshot().columns` (whichever the existing API uses; preserve that).

When the consumer's `columns` prop changes by reference (a structural change — column added or removed), the engine merges:

- Existing columns keep their engine-state `widthPx`, position in display order, and `pinned` value.
- New columns slot in at their position in the new prop array, with their prop `widthPx` (or default).
- Removed columns drop from engine state.
- Order in the engine's display array follows the new prop order for any column whose engine-state position is no longer derivable.

### New actions on `GridCoreStore`

```ts
setColumnWidth(columnId: string, width: number): void;
moveColumn(columnId: string, toIndex: number): void;
setColumnPinned(columnId: string, pinned: "left" | null): void;
autosizeColumn(columnId: string, options?: AutosizeOptions): void;
resetColumnLayout(): void;
```

**Semantics:**

- `setColumnWidth` clamps `width` to `[column.minWidthPx ?? 40, column.maxWidthPx ?? Infinity]`. No-op when the resulting width equals the current width.
- `moveColumn` repositions the column in the display array. The synthetic row-select column (id `__pretable_row_select__`) always occupies position 0 when enabled and is never moved; calling `moveColumn` with that id is silently no-op'd, and `toIndex < 1` for any other column is clamped to `1` to keep the synthetic column leftmost. The pinned region spans from the first user-column slot (index 1 if synth is enabled, 0 otherwise) up to but not including the first non-pinned column. If the resulting `toIndex` falls inside that pinned region, the column's `pinned` is set to `"left"`. If `toIndex` falls outside the pinned region and the column was pinned, `pinned` is cleared.
- `setColumnPinned` repositions the column to the pin-region boundary (last position of the pinned region when pinning, first position of the unpinned region when unpinning) and updates `pinned`. Used for explicit pin actions outside drag.
- `autosizeColumn` runs the existing autosize algorithm for one column. Reuses `@pretable-internal/layout-core`'s `autosizeColumns` with a single-id filter.
- `resetColumnLayout` restores the engine's column state to whatever was on the original `inputOptions.columns` array (the clone made at `createGrid` time). Stored as a private snapshot.

The synthetic row-select column from sub-project B is excluded from all of the above.

### Column type extension

`GridCoreColumn<TRow>` (re-exported as `PretableColumn<TRow>`) gains:

```ts
interface GridCoreColumn<TRow> {
  // existing: id, header, wrap, widthPx, pinned, sortable, filterable, getValue, formatForCopy
  minWidthPx?: number;       // default: 40 (engine-applied)
  maxWidthPx?: number;       // default: undefined (no max)
  resizable?: boolean;       // default: true
  reorderable?: boolean;     // default: true
}
```

`resizable: false` removes the resize handle from that column. `reorderable: false` makes the header non-draggable. Both default to `true`.

## React adapter — `<PretableSurface>`

### New props

```ts
interface PretableSurfaceProps<TRow> {
  // ... existing props
  onColumnWidthsChange?: (next: Record<string, number>) => void;
  onColumnOrderChange?: (next: readonly string[]) => void;
  onColumnPinnedChange?: (next: Record<string, "left" | null>) => void;
}
```

### Extended controlled `state` slices

```ts
interface PretableSurfaceState {
  // existing: sort, filters, selection, focus
  columnWidths?: Record<string, number>;        // columnId → widthPx
  columnOrder?: readonly string[];              // display order, all column ids
  columnPinned?: Record<string, "left" | null>; // explicit pin overrides
}
```

Same controlled/uncontrolled pattern as the existing slices: provide the slice to drive the engine; omit to let the engine own it. Callbacks fire **on drag-end only** (not during the live drag), matching the established pattern from sub-project B Phase 6 (debounced announcements: "callbacks fire on user-induced changes, not programmatic re-applications"). Programmatic mutations from inside `usePretableModel`'s controlled-state injection do not fire callbacks.

If `state.columnOrder` is provided and is missing a column id from `options.columns`, the engine appends that column at the end. If `state.columnWidths` is missing a column, the engine falls back to the column's `widthPx` from props or the default min.

### Resize gesture

Every header cell where `column.resizable !== false` renders a 4px-wide hit area on its right edge with `cursor: col-resize` on hover.

- `onPointerDown` (button 0, no shift/cmd) on the handle:
  1. `event.stopPropagation()` (don't start a reorder drag).
  2. `event.currentTarget.setPointerCapture(event.pointerId)` (wrapped in try/catch — jsdom no-ops).
  3. Capture initial width and pointer X into a `dragState` ref.
  4. Set internal `dragLiveWidth: { columnId, width }` state to drive the live cell width.
- `onPointerMove`:
  1. Compute new width = `initialWidth + (event.clientX - initialPointerX)`.
  2. Clamp to `[column.minWidthPx ?? 40, column.maxWidthPx ?? Infinity]`.
  3. Update `dragLiveWidth` (re-renders the affected cells with the live width).
- `onPointerUp` / `onPointerCancel`:
  1. Call `grid.setColumnWidth(columnId, dragLiveWidth.width)`.
  2. Clear `dragLiveWidth`.
  3. The engine emit triggers normal re-render, fires `onColumnWidthsChange`.
- `onDoubleClick` on the handle (no drag started):
  1. Call `grid.autosizeColumn(columnId)`.
  2. Fires `onColumnWidthsChange` once.

### Reorder gesture

Entire header cell where `column.reorderable !== false` is the drag source, except for the resize hit area on the right edge.

- `onPointerDown` (button 0, no modifiers) on the header (excluding resize area):
  1. Set `reorderState: { columnId, startX, startY, dragging: false }` ref.
  2. Don't start drag yet — wait for movement past threshold to disambiguate from sort click.
- `onPointerMove`:
  1. If not yet dragging, compute distance from `startX/Y`. If > 5px, set `dragging: true`, `setPointerCapture`.
  2. Once dragging: render a ghost (clone of the header cell, `position: fixed`, follows cursor, `opacity: 0.6`). Compute the nearest column boundary based on cursor X relative to the column edges of `effectiveColumns`. Render a vertical drop indicator line at that boundary (`position: absolute`, 2px wide, full height of header + body).
- `onPointerUp` over a valid drop position:
  1. If not dragging (didn't pass threshold), let the click event fire normally — sort dispatch handles it.
  2. If dragging: compute target index from drop indicator position. Call `grid.moveColumn(columnId, toIndex)`. The engine handles cross-boundary auto-pin and fires `onColumnOrderChange` (and `onColumnPinnedChange` if pin state changed).
  3. Clear `reorderState`. Remove ghost + drop indicator.
- `Esc` during drag: cancel without calling `moveColumn`. Clear `reorderState`.

### CSS tokens (added to `packages/ui/src/tokens.css`)

```css
--pt-color-resize-handle: transparent;
--pt-color-resize-handle-hover: var(--pt-color-selection-border);
--pt-color-reorder-ghost-bg: var(--pt-color-surface, #fff);
--pt-color-reorder-ghost-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
--pt-color-reorder-drop-indicator: var(--pt-color-focus-ring);
```

### Prop forwarding

`Pretable`, `InspectionGrid`, `LabeledGridSurface` forward the three new callbacks. The simple `Pretable` drop-in already exposes the controlled `state` prop; nothing else changes there.

## Phase structure

Sub-project C ships as 3 PRs, each merged on green before the next:

| # | Branch | Scope |
|---|---|---|
| C1 | `c1-engine-column-state` | Engine: new types, all 5 actions, column-merge logic on prop change, unit tests in `grid-core`, public-type re-exports through `@pretable/core`. No React adapter changes. |
| C2 | `c2-resize` | React adapter: resize gesture (pointer events, drag-live width, commit on drag-end), double-click autosize, `state.columnWidths` controlled mode, `onColumnWidthsChange` callback, jsdom tests, partial doc updates. |
| C3 | `c3-reorder` | React adapter: reorder gesture (ghost + drop indicator + cross-boundary auto-pin), `state.columnOrder` + `state.columnPinned` controlled modes, two callbacks, jsdom tests, full `column-layout.mdx` docs page, `_nav.ts` entry. |

Each phase's PR carries the spec on its first commit (this file, ported into the worktree at `docs/superpowers/specs/`); the master plan lands in C1's PR; C2 and C3 append phase-specific plan detail to the master plan in their own PRs (the just-in-time pattern established in sub-project B).

## Exit criteria (cumulative across C1–C3)

- All 5 new engine actions implemented with unit tests covering: width clamp, move repositioning, cross-boundary pin auto-update, single-column autosize, layout reset, prop-merge merge semantics on column add/remove.
- Header cells render resize handles where `column.resizable !== false`. Resize gesture works end-to-end including drag-live preview and drag-end commit. Double-click autosizes one column. Per-column min/max honored.
- Header cells are draggable for reorder where `column.reorderable !== false`. Reorder gesture works end-to-end including ghost, drop indicator, threshold-based start, Esc cancel, cross-boundary auto-pin.
- Synthetic row-select column has no resize handle and is non-draggable.
- Three new controlled state slices wired with three new `on…Change` callbacks. Programmatic mutations don't fire callbacks. Drag-end commits fire callbacks once.
- New `column-layout.mdx` docs page covers resize, reorder, pin, autosize, controlled state, callbacks. `_nav.ts` and `api-reference.mdx` updated.
- `pnpm -w typecheck` / `test` / `lint` / `format` clean across all three phases.

## Open items tracked elsewhere

- Bench validation for resize/reorder latency — picks up alongside Phase 7 selection/nav benches in a focused session.
- Right-pinning, column groups, column visibility — separate sub-projects.
- Cell renderer architecture (sub-project D) — separate brainstorm.
