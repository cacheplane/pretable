import {
  createRowMetricsIndex,
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
    signature: string;
    columnsRef: unknown;
  }
>();

export function createDomRenderSnapshot<TRow extends PretableRow>(
  input: DomRenderInput<TRow>,
): DomRenderSnapshot<TRow> {
  const rowHeights = input.snapshot.visibleRows.map((entry) => {
    const measuredHeight = input.measuredHeights?.[entry.id];

    return measuredHeight ?? estimateRowHeight(entry.row, input.columns);
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

    return [
      {
        id: entry.id,
        row: entry.row,
        rowIndex: plannedRow.index,
        top: plannedRow.top,
        height: plannedRow.height,
      },
    ];
  });

  const columnInputs = input.columns.map((col) => ({
    id: col.id,
    width: resolveColumnWidth(col),
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

function estimateRowHeight<TRow extends PretableRow>(
  row: TRow,
  columns: PretableColumn<TRow>[],
): number {
  const cached = estimatedRowHeightCache.get(row);

  if (cached && cached.columnsRef === columns) {
    return cached.height;
  }

  const signature = getEstimatedRowHeightSignature(row, columns);

  if (cached?.signature === signature) {
    cached.columnsRef = columns;
    return cached.height;
  }

  let estimatedHeight = DEFAULT_ROW_HEIGHT;

  for (const column of columns) {
    if (!column.wrap) {
      continue;
    }

    const prepared = prepareText({
      text: String(readCellValue(row, column)),
      fontKey: ESTIMATE_FONT_KEY,
      averageCharWidth: ESTIMATED_CHARACTER_WIDTH,
    });
    const layout = layoutPreparedText(prepared, resolveColumnWidth(column), {
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
    height: estimatedHeight,
    columnsRef: columns,
  });

  return estimatedHeight;
}

function getEstimatedRowHeightSignature<TRow extends PretableRow>(
  row: TRow,
  columns: PretableColumn<TRow>[],
) {
  return columns
    .filter((column) => column.wrap)
    .map((column) => {
      const value = String(readCellValue(row, column) ?? "");

      return `${column.id}:${resolveColumnWidth(column)}:${value}`;
    })
    .join("|");
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
