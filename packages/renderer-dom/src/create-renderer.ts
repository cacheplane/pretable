import {
  distributeFlexWidths,
  planColumns,
} from "@pretable-internal/layout-core";
import type { ColumnPlan } from "@pretable-internal/layout-core";
import type { PretableColumn, PretableRow } from "@pretable-internal/grid-core";
import type { PretableRowId } from "@pretable-internal/row-model";
import { layoutPreparedText, prepareText } from "@pretable-internal/text-core";

import type { RowHeightCalibrationParameters } from "./row-height-calibration";
import { groupRenderId } from "./types";
import type {
  DomLayoutColumn,
  IndexedDomRenderInput,
  IndexedDomRenderSnapshot,
} from "./types";

/**
 * The height a row gets when nothing else has an opinion: no theme loaded, no
 * `defaultRowHeight` passed. Every themed grid overrides it — themes state a
 * row height per density tier — so this is the unthemed default only, and it
 * is the value @pretable/react has rendered since before the token contract
 * existed. One definition, shared with the row layout controller, because two
 * copies of a number this load-bearing is how the estimator and the floor
 * drifted into disagreeing in the first place.
 */
export const DEFAULT_ROW_HEIGHT = 44;
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
    baseHeight: number;
    calibrationRef: RowHeightCalibrationParameters | null;
  }
>();

export function createDomRenderSnapshot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  input: IndexedDomRenderInput<TRow, TRowId, TColumns>,
): IndexedDomRenderSnapshot<TRow, TRowId, TColumns> {
  const state = input.controllerState;
  const flexWidths = distributeFlexWidths({
    columns: input.columns.map((column) => ({
      id: column.id,
      width: resolveColumnWidth(column),
      ...(column.widthPx === undefined && column.flex !== undefined
        ? { flex: column.flex }
        : {}),
      ...(column.minWidthPx === undefined
        ? {}
        : { minWidthPx: column.minWidthPx }),
      ...(column.maxWidthPx === undefined
        ? {}
        : { maxWidthPx: column.maxWidthPx }),
    })),
    viewportWidth: input.viewportWidth ?? Number.POSITIVE_INFINITY,
  });
  const columnPlan = planColumns({
    columns: input.columns.map((column) => ({
      id: column.id,
      width: flexWidths[column.id] ?? resolveColumnWidth(column),
      pinned: column.pinned,
    })),
    scrollLeft: input.viewportWidth === undefined ? 0 : (input.scrollLeft ?? 0),
    viewportWidth: input.viewportWidth ?? Number.POSITIVE_INFINITY,
    overscan: state.viewport.overscan,
  });
  const rows = state.window.map((entry) => {
    const geometry = {
      id:
        entry.ref.kind === "group"
          ? groupRenderId(entry.ref.groupId)
          : typeof entry.ref.rowId === "number"
            ? `data:number:${entry.ref.rowId}`
            : `data:string:${entry.ref.rowId.length}:${entry.ref.rowId}`,
      ref: entry.ref,
      rowIndex: entry.index,
      top: entry.top,
      height: entry.height,
    };
    return entry.row.kind === "data"
      ? ({ ...geometry, kind: "data" as const, row: entry.row.row } as const)
      : ({ ...geometry, kind: "group" as const, group: entry.row } as const);
  });
  return Object.freeze({
    modelRevision: state.observedRevision,
    modelSnapshot: state.snapshot,
    rows: Object.freeze(rows),
    columns: Object.freeze(columnPlan.columns),
    rowMetrics: state.rowHeights,
    nodeCount: rows.length * columnPlan.columns.length,
    totalHeight: state.rowHeights.getTotalHeight(),
    totalWidth: columnPlan.totalWidth,
    pinnedLeftWidth: columnPlan.pinnedLeftWidth,
    pinnedRightWidth: columnPlan.pinnedRightWidth,
  });
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
 * Height to draw a row at before the DOM has measured it.
 *
 * `baseHeight` is the caller's floor — in practice the active theme's
 * `--pretable-row-height` for the current density, threaded down from the row
 * layout controller's `defaultRowHeight`. It used to be a private constant
 * here, which made it a SECOND floor beneath the controller's: a grid asking
 * for Excel's 20px rows was estimated at `Math.max(20, 44)` and never saw its
 * own density. Shipped themes span 20px to 56px, so the number belongs to the
 * caller.
 *
 * It participates in the memo key for the same reason: a density flip changes
 * the answer for a row whose text and columns are untouched.
 */
export function estimateDomRowHeight<TRow extends object>(
  row: TRow,
  columns: readonly DomLayoutColumn<TRow>[],
  baseHeight: number = DEFAULT_ROW_HEIGHT,
  calibration: RowHeightCalibrationParameters | null = null,
): number {
  const cached = estimatedRowHeightCache.get(row);

  if (
    cached &&
    cached.columnsRef === columns &&
    cached.baseHeight === baseHeight &&
    cached.calibrationRef === calibration
  ) {
    return cached.height;
  }

  const signature = getEstimatedRowHeightSignature(row, columns);

  if (
    cached?.signature === signature &&
    cached.baseHeight === baseHeight &&
    cached.calibrationRef === calibration
  ) {
    cached.columnsRef = columns;
    return cached.height;
  }

  // Learned where available, the bench-app constants where not. An uncalibrated
  // grid must produce byte-identical results to before this existed.
  const lineHeightPx = calibration?.lineHeightPx ?? ROW_LINE_HEIGHT;
  const chromeHeightPx = calibration?.chromePx ?? ROW_CHROME_HEIGHT;
  const floorPx = calibration?.floorPx ?? null;

  let estimatedHeight = Math.max(baseHeight, floorPx ?? 0);
  let predictedLines = 1;
  let textDrivenHeight = 0;

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
      lineHeightPx,
      wrapMode: "wrap",
    });

    predictedLines = Math.max(
      predictedLines,
      Math.round(layout.height / lineHeightPx),
    );
    textDrivenHeight = Math.max(
      textDrivenHeight,
      layout.height + chromeHeightPx,
    );
  }

  // The hinge from the model — `measured ≈ max(floor, chrome + lines × lineHeight)`
  // — applied where it bites. A row of one line or fewer is frequently not
  // decided by its wrapped text at all: a custom two-line renderer the estimator
  // is structurally blind to is the tallest cell, which is precisely what the
  // floor is learned from. So once a floor exists, it answers for those rows and
  // the text arithmetic must not raise it.
  //
  // This is not merely tidy. `floorPx` is learned from the first short row, well
  // before the four wrapped samples a slope fit needs, so there is a real
  // interval where the floor is real and `lineHeightPx`/`chromePx` are still the
  // bench app's constants. Taking a max across that mixture is what reintroduces
  // the hero's 66 -> 63 first-paint shrink: 1 x 24 + 42 beats a measured 63.
  //
  // With no calibration `floorPx` is null and this collapses to the original
  // unconditional max, which is the safety property.
  if (floorPx === null || predictedLines >= 2) {
    estimatedHeight = Math.max(estimatedHeight, textDrivenHeight);
  }

  estimatedRowHeightCache.set(row, {
    signature,
    height: estimatedHeight,
    columnsRef: columns,
    baseHeight,
    calibrationRef: calibration,
  });

  return estimatedHeight;
}

/**
 * The estimator's predicted line count for a row — the max across its wrapped
 * columns, and 1 when it has none.
 *
 * Exported so calibration fits against the estimator's OWN prediction rather
 * than a second, subtly different reckoning of the same thing. Fitting measured
 * height against a line count the estimator never used would learn a correction
 * for a model nobody runs.
 *
 * @internal
 */
export function predictRowLineCount<TRow extends object>(
  row: TRow,
  columns: readonly DomLayoutColumn<TRow>[],
): number {
  let lines = 1;
  for (const column of columns) {
    if (!column.wrap) continue;
    const prepared = prepareText({
      text: String(readCellValue(row, column)),
      fontKey: ESTIMATE_FONT_KEY,
      averageCharWidth: ESTIMATED_CHARACTER_WIDTH,
    });
    const layout = layoutPreparedText(prepared, resolveColumnWidth(column), {
      lineHeightPx: ROW_LINE_HEIGHT,
      wrapMode: "wrap",
    });
    lines = Math.max(lines, Math.round(layout.height / ROW_LINE_HEIGHT));
  }
  return lines;
}

function getEstimatedRowHeightSignature<TRow extends object>(
  row: TRow,
  columns: readonly DomLayoutColumn<TRow>[],
) {
  return columns
    .filter((column) => column.wrap)
    .map((column) => {
      const value = String(readCellValue(row, column) ?? "");

      return `${column.id}:${resolveColumnWidth(column)}:${value}`;
    })
    .join("|");
}

function readCellValue<TRow extends object>(
  row: TRow,
  column: DomLayoutColumn<TRow>,
): unknown {
  return column.value ? column.value(row) : Reflect.get(row, column.id);
}

/**
 * The width `planColumns` is fed for a column, including the fallbacks applied
 * when the column declares no `widthPx`. Module-private on purpose: every plan
 * built from `PretableColumn`s goes through `createDomRenderSnapshot` or
 * `planColumnLayout`, so no caller outside this file has to know the fallbacks
 * — which is exactly how a second copy of them would get started.
 */
function resolveColumnWidth<TRow extends object>(
  column: DomLayoutColumn<TRow>,
): number {
  return (
    column.widthPx ?? (column.wrap ? WRAPPED_COLUMN_WIDTH : FIXED_COLUMN_WIDTH)
  );
}
