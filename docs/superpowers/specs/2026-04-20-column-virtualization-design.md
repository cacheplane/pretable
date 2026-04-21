# Column Virtualization Design

## Goal

Add horizontal column virtualization so pretable renders only the columns visible in the viewport (plus overscan), enabling smooth scroll quality at 500+ columns. Make S3 ("many-columns") runnable in the bench app and prove that column virtualization doesn't break existing scroll quality.

## Current Behavior

Pretable virtualizes rows but not columns. Every visible row renders all columns:

- PretableSurface's inner loop: `columns.map((column) => ...)` creates a DOM node for every column-row intersection
- With S2 (40 cols, ~7 visible rows) this produces ~280 cells — fine
- With S3 (500 cols, ~10 visible rows at fixed height) this would produce ~5,000 cells — a DOM pressure wall
- Column widths are static: `column.widthPx` or defaults (140px fixed, 220px wrapped) from `packages/react/src/internal/rendering.ts`
- Cells use CSS grid layout with `grid-template-columns` spanning all columns
- Pinned columns use `position: sticky` and are always rendered

S3 is defined in scenario-data but not runnable in the bench app (not in the allowed scenario list).

## Target Behavior

Pretable renders only the columns within the horizontal viewport window plus overscan columns on each side. Pinned columns always render (not virtualized). S3 is runnable in the bench app with all four adapters. The existing scroll quality proof (H1) works with S3 runs.

## Architecture

Column virtualization mirrors the existing row virtualization pattern, extending it horizontally. Three layers change:

### grid-core

`GridCoreViewportState` gains two fields:

```typescript
interface GridCoreViewportState {
  scrollTop: number;
  scrollLeft: number; // new
  height: number;
  width: number; // new — viewport width
}
```

Initial state: `{ scrollTop: 0, scrollLeft: 0, height: 0, width: 0 }`. The `setViewport` equality check adds the two new fields. The snapshot includes the expanded viewport. No other grid-core changes — sort, filter, selection, focus are all unaffected.

### layout-core

New `planColumns()` function parallel to `planViewport()`:

```typescript
interface PlanColumnsInput {
  columns: { id: string; width: number; pinned?: "left" }[];
  scrollLeft: number;
  viewportWidth: number;
  overscan: number;
}

interface PlannedColumn {
  index: number; // index into the original columns array
  id: string;
  left: number; // absolute offset from left edge
  width: number;
  pinned?: "left";
}

interface ColumnPlan {
  columns: PlannedColumn[]; // pinned + visible scrollable
  totalWidth: number;
  pinnedLeftWidth: number; // total width of pinned zone
}
```

Algorithm:

1. Separate pinned columns from scrollable columns.
2. Compute cumulative left offsets for all scrollable columns (like `createRowMetricsIndex` does for rows).
3. Binary search for the first scrollable column whose right edge exceeds `scrollLeft`.
4. Walk forward until the left edge exceeds `scrollLeft + viewportWidth`.
5. Expand the visible range by `overscan` columns on each side, clamped to array bounds.
6. Return pinned columns (always) + the visible scrollable slice with overscan.

Overscan is column-count-based (same as row overscan), not pixel-based. Default overscan of 6 means 6 extra columns on each side — at 140px each, ~840px of buffer for smooth horizontal scrolling.

Pinned columns always render and are not virtualized. Pinned count is always small in practice (S3 has 2, max across all scenarios is 3).

### renderer-dom

`DomRenderInput` gains `scrollLeft` and `viewportWidth`. `DomRenderSnapshot` gains a `columns` field:

```typescript
interface DomRenderSnapshot<TRow> {
  frame: GridCoreFrame<TRow>;
  rows: DomRenderRow<TRow>[];
  columns: PlannedColumn[]; // new — from planColumns()
  nodeCount: number; // now rows.length * columns.length
  totalHeight: number;
  totalWidth: number;
}
```

`createDomRenderSnapshot` calls `planColumns()` with the column definitions, `scrollLeft`, `viewportWidth`, and overscan. The existing `planViewport()` call is unchanged.

### React surface layout

Currently cells use CSS grid with `grid-template-columns`. With column virtualization, only a subset of columns exist in the DOM, so CSS grid breaks.

The fix: cells switch to absolute positioning (left + width), matching how rows already use absolute positioning (top + height). The scroll content div gets `width: totalWidth` and `height: totalHeight`. Each cell is placed at `(row.top, column.left)` with explicit `width` and `height`.

Pinned columns use `position: sticky; left: <offset>` as they do today.

The header row also virtualizes — only visible + pinned column headers render, using the same `renderSnapshot.columns` slice.

## Scenario and Benchmark Integration

S3 becomes runnable in the bench app:

| File                                 | Change                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `apps/bench/src/bench-types.ts`      | Add `"S3"` to scenarioId union                                                              |
| `apps/bench/src/query-state.ts`      | Add `"S3"` recognition in `parseBenchQuery`                                                 |
| `packages/bench-runner/src/index.ts` | Add `"S3"` to `validateSupportedP0aRequest`. S3 uses `scroll` only — no interaction scripts |
| `scripts/bench-matrix.mjs`           | Add `"S3"` to `DEFAULT_SCENARIOS`                                                           |

No new hypotheses for S3 initially. S3 proves that column virtualization doesn't break the existing scroll quality proof. The existing H1 evaluation already accepts any scenario — S3 scroll runs feed into it. If S3 exposes column-specific quality gaps (e.g., horizontal blank gaps), targeted hypotheses can be added later.

All four adapters (pretable, Grid Alpha, GridBeta, GridGamma) already handle arbitrary column counts from the dataset. Grid Alpha and GridBeta have built-in column virtualization. GridGamma virtualizes rows but not columns. No adapter code changes needed.

## S3 Scenario Definition (Existing)

| Property        | Value                                          |
| --------------- | ---------------------------------------------- |
| id              | S3                                             |
| name            | many-columns                                   |
| rows            | 10,000                                         |
| cols            | 500                                            |
| row_height_mode | fixed                                          |
| wrapped_columns | 0                                              |
| pinned_left     | 2                                              |
| update_stream   | none                                           |
| purpose         | Column virtualization and pinned-zone overhead |

Row count scales (existing):

| Scale      | Rows   |
| ---------- | ------ |
| smoke      | 250    |
| dev        | 1,000  |
| hypothesis | 5,000  |
| target     | 10,000 |

## Testing Strategy

### layout-core

Unit tests for `planColumns()`:

- Basic case: 10 columns, viewport shows 3, verify correct slice + overscan
- Pinned columns always included regardless of scrollLeft
- Edge cases: scrollLeft=0 (leftmost), scrollLeft=maxScroll (rightmost)
- Empty columns array
- All columns fit in viewport (no virtualization needed — returns all)
- Overscan clamps to array bounds

### renderer-dom

Unit tests for the expanded `createDomRenderSnapshot`:

- With 500 columns and a 1440px viewport, verify `columns` slice is small (not 500)
- `nodeCount` equals `rows.length * columns.length` (visible columns, not all)
- `totalWidth` equals sum of all column widths (not just visible)
- Pinned columns appear in output regardless of scrollLeft
- Column offsets are correct absolute positions

### grid-core

Minimal tests: `setViewport` accepts and returns expanded state with `scrollLeft`/`width`, equality check prevents spurious emissions.

### React surface

DOM tests verifying:

- With 50 columns and a narrow viewport, rendered cell count is much less than 50 per row
- Pinned column cells always present in DOM
- Horizontal scroll updates visible columns without full remount

### scenario-data

S3 dataset test (same pattern as S7): correct column count (500), 2 pinned columns, fixed-height mode, row counts per scale.

### bench-runner and bench-matrix

S3 recognized in validation, present in default scenarios, query-state parses `?scenario=S3`.

## What This Does Not Change

- Row virtualization — unchanged, row planning stays in `planViewport()`
- S1, S2, S4-S7 — no changes to existing scenarios or their behavior
- Adapters — no code changes
- Sort, filter, selection, focus — unaffected, these operate on rows
- Measured row heights — the measurement loop operates on visible rows, unaffected by column count. S3 is fixed-height with no wrapping
- Public API — `@pretable/core` and `@pretable/react` exports unchanged
- H1-H12 hypothesis evaluation — unchanged logic
- Column overscan — uses the same `overscan` prop as rows (default 6), no new prop

## Risk

Low-to-moderate. The main risks:

- **CSS layout shift**: Moving from CSS grid to absolute positioning for cells is the biggest change. It affects all scenarios, not just S3. Must verify that S1, S2, S7 scroll quality doesn't regress.
- **Header virtualization**: The header row must stay synchronized with the body during horizontal scroll. If headers and body columns get out of sync, it will be visually obvious.
- **Pinned column z-index**: Pinned columns must render above scrollable columns. The current sticky positioning handles this, but the absolute positioning change may require explicit z-index management.

## Verification

1. Unit tests: `pnpm test` (all packages)
2. Lint/typecheck: `pnpm lint && pnpm typecheck`
3. S1/S2/S7 regression: `pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S1,S2,S7 --scripts=scroll --scale=dev --repeats=3`
4. S3 smoke: `pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S3 --scripts=scroll --scale=dev --repeats=3`
5. S3 comparative: `pnpm bench:matrix -- --project=chromium --adapters=pretable,gridalpha,gridbeta,gridgamma --scenarios=S3 --scripts=scroll --scale=hypothesis --repeats=3`
