import {
  createRowMetricsIndex,
  distributeFlexWidths,
  planColumns,
  planViewport,
} from "@pretable-internal/layout-core";
import type { ColumnPlan } from "@pretable-internal/layout-core";
import type { PretableColumn, PretableRow } from "@pretable-internal/grid-core";
import { layoutPreparedText, prepareText } from "@pretable-internal/text-core";

import type { DomRenderInput, DomRenderSnapshot } from "./types";

const DEFAULT_ROW_HEIGHT = 44;
const WRAPPED_COLUMN_WIDTH = 220;
const FIXED_COLUMN_WIDTH = 140;
// Calibrated against actual browser metrics for Inter Variable at 16px in
// the bench app (cell line-height computed by getComputedStyle = "24px").
// Mismatched constants caused H1's row_height_error_p95_px to fail at 5px
// after the column-virtualization refactor (dfb6a20) made row heights
// planner-driven instead of CSS-grid-auto-sized.
const ROW_LINE_HEIGHT = 24;
const ROW_CHROME_HEIGHT = 42;
const ESTIMATED_CHARACTER_WIDTH = 7;
const ESTIMATE_FONT_KEY = "Pretable Estimate 14";
const estimatedRowHeightCache = new WeakMap<
  object,
  {
    height: number;
    /** The row's own wrapped cell values. */
    signature: string;
    /** The width each wrapped column is DRAWN at, flex distribution included. */
    widthsToken: string;
    columnsRef: unknown;
  }
>();

export function createDomRenderSnapshot<TRow extends PretableRow>(
  input: DomRenderInput<TRow>,
): DomRenderSnapshot<TRow> {
  // `flex` columns take a share of whatever the fixed ones leave over, so the
  // row ends at the viewport edge. Only meaningful once the viewport has been
  // measured, and only for columns without an explicit `widthPx` — a width the
  // consumer set, or that a resize drag produced, outranks a computed one.
  //
  // Resolved BEFORE row heights, not after: a wrapped flex column is drawn at
  // its distributed width, so that is the width its text wraps at. Estimating
  // it at `resolveColumnWidth`'s fallback instead made the estimate a constant
  // — blind to the viewport, to a sibling's resize, and to a column leaving the
  // drawn set — and rows sat at a height nothing on screen had.
  const flexWidths = distributeFlexWidths({
    columns: input.columns.map((col) => ({
      id: col.id,
      width: resolveColumnWidth(col),
      ...(col.widthPx === undefined && col.flex !== undefined
        ? { flex: col.flex }
        : {}),
      ...(col.minWidthPx === undefined ? {} : { minWidthPx: col.minWidthPx }),
      ...(col.maxWidthPx === undefined ? {} : { maxWidthPx: col.maxWidthPx }),
    })),
    viewportWidth: input.viewportWidth ?? Number.POSITIVE_INFINITY,
  });
  const estimateRowHeight = createRowHeightEstimator(input.columns, flexWidths);
  const rowHeights = input.snapshot.visibleRows.map((entry) => {
    const measuredHeight = input.measuredHeights?.[entry.id];

    if (measuredHeight !== undefined) {
      return measuredHeight;
    }

    // Group headers have no source row to measure wrapped text against, so they
    // estimate at the unwrapped default. Sub-project 2 owns their real chrome.
    return entry.kind === "group"
      ? DEFAULT_ROW_HEIGHT
      : estimateRowHeight(entry.row);
  });
  const rowMetrics = createRowMetricsIndex(rowHeights);
  const viewportPlan = planViewport({
    scrollTop: input.scrollTop,
    viewportHeight: input.viewportHeight,
    overscan: input.overscan,
    rowMetrics,
    pinnedLeft: input.columns
      .filter((column) => column.pinned === "left")
      .map((column) => ({
        columnId: column.id,
        width: resolveColumnWidth(column),
      })),
  });
  const rows = viewportPlan.rows.flatMap((plannedRow) => {
    const entry = input.snapshot.visibleRows[plannedRow.index];

    if (!entry) {
      return [];
    }

    const geometry = {
      id: entry.id,
      rowIndex: plannedRow.index,
      top: plannedRow.top,
      height: plannedRow.height,
    };

    // Group rows pass THROUGH the render snapshot rather than being filtered
    // out: the renderer's job is placement, and a surface that skips drawing
    // them still needs their geometry to keep `rowIndex` aligned with
    // `snapshot.visibleRows`.
    return [
      entry.kind === "group"
        ? { ...geometry, kind: "group" as const, group: entry }
        : { ...geometry, kind: "data" as const, row: entry.row },
    ];
  });

  const columnInputs = input.columns.map((col) => ({
    id: col.id,
    width: flexWidths[col.id] ?? resolveColumnWidth(col),
    pinned: col.pinned,
  }));

  // No `viewportWidth` means "not measured yet": SSR, and the first committed
  // render before the surface's layout effect reads the scrollport. There is no
  // virtualization window to compute, so every column renders — expressed as an
  // infinitely wide viewport at scrollLeft 0, which makes planColumns' forward
  // walk consume the whole scrollable run and its overscan clamp a no-op.
  //
  // This case used to be a hand-rolled plan built inline. It drifted: that
  // version accumulated `left` across ALL columns in declaration order and
  // never reordered into [left-pinned, scrollable, right-pinned], so a
  // prop-declared left pin on a non-leading column got its content offset as a
  // sticky inset instead of its offset within the left-pinned group. Delegating
  // is what keeps the two paths from disagreeing again.
  const columnPlan: ColumnPlan = planColumns({
    columns: columnInputs,
    scrollLeft: input.viewportWidth !== undefined ? (input.scrollLeft ?? 0) : 0,
    viewportWidth: input.viewportWidth ?? Number.POSITIVE_INFINITY,
    overscan: input.overscan,
  });

  return {
    frame: {
      snapshot: input.snapshot,
    },
    rows,
    columns: columnPlan.columns,
    // Passed through, not rebuilt: this index was already constructed above over
    // every visible row (not just the windowed ones), so exposing it is free and
    // keeps unrendered-row geometry on the single layout-core source of truth.
    rowMetrics,
    nodeCount: rows.length * columnPlan.columns.length,
    totalHeight: viewportPlan.totalHeight,
    totalWidth: columnPlan.totalWidth,
    pinnedLeftWidth: columnPlan.pinnedLeftWidth,
    pinnedRightWidth: columnPlan.pinnedRightWidth,
  };
}

/**
 * Lay out every column, ignoring the virtualization window.
 *
 * The single place the unbounded-viewport plan is built. `planColumns`
 * virtualizes the scrollable run, so a plan built at the real viewport width
 * omits precisely the columns callers come here for; the render snapshot has
 * the same gap, since it only carries the columns it draws. Expressing the
 * request as an infinitely wide viewport at scrollLeft 0 makes planColumns'
 * forward walk consume the whole run and its overscan clamp a no-op, so every
 * column is present at its true content offset. Widths go through
 * `resolveColumnWidth` — the renderer's own fallbacks — so an unsized column is
 * not laid out at zero width.
 *
 * Two consumers share one plan, deliberately:
 *
 * - drag-to-reorder hit-testing, for which a scrolled-out column is still a
 *   legitimate drop target;
 * - `scrollLeftToReveal`, which exists to scroll to a column that is not
 *   rendered, and therefore takes a `ColumnPlan` instead of re-planning.
 *
 * Both used to derive their own. PR #203 fixed a bug whose root cause was a
 * second, drifted copy of column-bucketing math; keeping the trick in one
 * function, and passing one `ColumnPlan` object to both callers, is what stops
 * that from recurring.
 */
export function planColumnLayout<TRow extends PretableRow>(
  columns: readonly PretableColumn<TRow>[],
): ColumnPlan {
  return planColumns({
    columns: columns.map((col) => ({
      id: col.id,
      width: resolveColumnWidth(col),
      pinned: col.pinned,
    })),
    scrollLeft: 0,
    viewportWidth: Number.POSITIVE_INFINITY,
    overscan: 0,
  });
}

/**
 * A per-render-pass row-height estimator, bound to the widths the columns are
 * actually drawn at.
 *
 * The wrapping widths are hoisted out of the per-row work on purpose. They are
 * identical for every row in the pass, and the cache's fast path runs once per
 * visible row — including rows far outside the window — so anything O(columns)
 * in there is paid thousands of times for an answer that cannot differ.
 *
 * Two things invalidate a cached estimate, and the cache has to see both:
 *
 * - the row's own wrapped values, which `signature` carries;
 * - the width each wrapped column is drawn at, which `widthsToken` carries.
 *
 * `columnsRef` alone cannot stand in for the second. A viewport resize hands
 * back the very same column array (the engine's column model is copy-on-write,
 * and resizing the window does not touch it) while every flex column's resolved
 * width moves underneath it — so an identity hit would serve a height estimated
 * against a width that is no longer on screen.
 */
function createRowHeightEstimator<TRow extends PretableRow>(
  columns: PretableColumn<TRow>[],
  flexWidths: Record<string, number>,
): (row: TRow) => number {
  const wrappedColumns = columns
    .filter((column) => column.wrap)
    .map((column) => ({
      column,
      width: flexWidths[column.id] ?? resolveColumnWidth(column),
    }));
  const widthsToken = wrappedColumns
    .map((entry) => `${entry.column.id}:${entry.width}`)
    .join("|");

  return (row: TRow): number => {
    const cached = estimatedRowHeightCache.get(row);

    if (
      cached &&
      cached.columnsRef === columns &&
      cached.widthsToken === widthsToken
    ) {
      return cached.height;
    }

    const signature = wrappedColumns
      .map(
        (entry) =>
          `${entry.column.id}:${String(readCellValue(row, entry.column) ?? "")}`,
      )
      .join("|");

    if (cached?.signature === signature && cached.widthsToken === widthsToken) {
      cached.columnsRef = columns;
      return cached.height;
    }

    let estimatedHeight = DEFAULT_ROW_HEIGHT;

    for (const entry of wrappedColumns) {
      const prepared = prepareText({
        text: String(readCellValue(row, entry.column)),
        fontKey: ESTIMATE_FONT_KEY,
        averageCharWidth: ESTIMATED_CHARACTER_WIDTH,
      });
      const layout = layoutPreparedText(prepared, entry.width, {
        lineHeightPx: ROW_LINE_HEIGHT,
        wrapMode: "wrap",
      });

      estimatedHeight = Math.max(
        estimatedHeight,
        layout.height + ROW_CHROME_HEIGHT,
      );
    }

    estimatedRowHeightCache.set(row, {
      signature,
      widthsToken,
      height: estimatedHeight,
      columnsRef: columns,
    });

    return estimatedHeight;
  };
}

function readCellValue<TRow extends PretableRow>(
  row: TRow,
  column: PretableColumn<TRow>,
): unknown {
  return column.value ? column.value(row) : row[column.id];
}

/**
 * The width `planColumns` is fed for a column, including the fallbacks applied
 * when the column declares no `widthPx`. Module-private on purpose: every plan
 * built from `PretableColumn`s goes through `createDomRenderSnapshot` or
 * `planColumnLayout`, so no caller outside this file has to know the fallbacks
 * — which is exactly how a second copy of them would get started.
 */
function resolveColumnWidth<TRow extends PretableRow>(
  column: PretableColumn<TRow>,
): number {
  return (
    column.widthPx ?? (column.wrap ? WRAPPED_COLUMN_WIDTH : FIXED_COLUMN_WIDTH)
  );
}
