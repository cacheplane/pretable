import {
  distributeFlexWidths,
  planColumns,
} from "@pretable-internal/layout-core";
import type { ColumnPlan } from "@pretable-internal/layout-core";
import type { PretableColumn, PretableRow } from "@pretable-internal/grid-core";
import type { PretableRowId } from "@pretable-internal/row-model";
import { layoutPreparedText, prepareText } from "@pretable-internal/text-core";
import type { PreparedText } from "@pretable-internal/text-core";

import type { RowHeightCalibrationParameters } from "./row-height-calibration";
import { groupRenderId } from "./types";
import type {
  DomLayoutColumn,
  IndexedDomRenderInput,
  IndexedDomRenderSnapshot,
  RenderAdvances,
  RowBoxMetrics,
  SegmentMeasurer,
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
    averageCharWidthPx: number | null;
    boxMetrics: RowBoxMetrics | null;
    measureSegment: SegmentMeasurer | null;
    letterSpacingPx: number | null;
    renderAdvances: RenderAdvances | null;
  }
>();

/**
 * Padding the estimator deducts from a column's width when nothing states any.
 *
 * Zero, not a nicer number: an unthemed grid must keep wrapping exactly where
 * it wrapped before the box existed.
 */
const NO_BOX_PADDING_X = 0;

/**
 * Where a wrapped cell's text actually gets to run: the column box less its
 * padding, on both sides.
 *
 * Clamped to 1px because `layoutPreparedText` divides the width by the average
 * character width to get characters per line. A narrow column with generous
 * padding — an icon column asked to wrap under Material's 16px — otherwise
 * hands it zero or a negative number.
 */
function resolveWrapWidth<TRow extends object>(
  column: DomLayoutColumn<TRow>,
  paddingXPx: number,
): number {
  return Math.max(1, resolveColumnWidth(column) - 2 * paddingXPx);
}

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
    // The controller's own plan-derived extent — loaded rows' height plus any
    // window spacers (see `RowLayoutControllerState.totalHeight`) — not
    // `state.rowHeights.getTotalHeight()` on its own, which only ever knows
    // the loaded rows and would silently drop the spacer on a windowed grid.
    totalHeight: state.totalHeight,
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
 *
 * `averageCharWidthPx` is the measured average advance width of the grid's font,
 * or `null` when nothing could measure it (server rendering, no canvas). Null
 * keeps `ESTIMATED_CHARACTER_WIDTH`, which is what every grid used before this
 * parameter existed, so an unmeasured grid estimates byte-identically to before.
 * It joins the memo key by VALUE — the measurement arrives after the first rows
 * are already estimated, so a key that ignored it would freeze the guess for
 * those rows' lifetimes.
 *
 * `boxMetrics` is the active theme's row box, or `null` when nothing has read
 * it (no controller option, server rendering, nothing painted). Null keeps the
 * bench-app constants and deducts no padding, which is what every grid did
 * before this parameter existed. It joins the memo key by IDENTITY for the same
 * reason the width joins it by value — the box is read off a rendered cell, so
 * it arrives after the first rows are estimated — and identity is only a valid
 * comparison because the supplier resolves one box per theme and returns that
 * same object on every call. See `getRowBoxMetrics` in `types.ts`.
 *
 * `measureSegment` is the grid font's real per-token advance width, or `null`
 * when nothing can measure it. Given one, `text-core` wraps by accumulated
 * pixel width and `averageCharWidthPx` stops deciding line breaks; without one
 * both behave exactly as before it existed. It joins the memo key by IDENTITY —
 * the supplier returns one function per font, and a font change is precisely
 * when memoized estimates are wrong — for the same arrival-order reason the
 * width and the box join it.
 *
 * `letterSpacingPx` is the cell's CSS `letter-spacing`, charged to every
 * grapheme on both paths. Null and `0` leave every estimate untouched. It joins
 * the memo key by VALUE.
 *
 * `renderAdvances` is what each wrapped column's `render` draws beside its text
 * — the width it consumes and the height of the line box it sits on — or `null`
 * when nothing has measured it. A column absent from the map, and either term
 * of an entry left unmeasured, is estimated exactly as it was before that term
 * existed. It joins the memo key by IDENTITY, for the same arrival-order reason
 * the box does and under the same requirement on its supplier: one map per set
 * of measurements, returned unchanged on every call — which means the supplier
 * must publish a NEW map when EITHER term moves, not only the width.
 */
export function estimateDomRowHeight<TRow extends object>(
  row: TRow,
  columns: readonly DomLayoutColumn<TRow>[],
  baseHeight: number = DEFAULT_ROW_HEIGHT,
  calibration: RowHeightCalibrationParameters | null = null,
  averageCharWidthPx: number | null = null,
  boxMetrics: RowBoxMetrics | null = null,
  measureSegment: SegmentMeasurer | null = null,
  letterSpacingPx: number | null = null,
  renderAdvances: RenderAdvances | null = null,
): number {
  const cached = estimatedRowHeightCache.get(row);

  if (
    cached &&
    cached.columnsRef === columns &&
    cached.baseHeight === baseHeight &&
    cached.calibrationRef === calibration &&
    cached.averageCharWidthPx === averageCharWidthPx &&
    cached.boxMetrics === boxMetrics &&
    cached.measureSegment === measureSegment &&
    cached.letterSpacingPx === letterSpacingPx &&
    cached.renderAdvances === renderAdvances
  ) {
    return cached.height;
  }

  const signature = getEstimatedRowHeightSignature(row, columns);

  if (
    cached?.signature === signature &&
    cached.baseHeight === baseHeight &&
    cached.calibrationRef === calibration &&
    cached.averageCharWidthPx === averageCharWidthPx &&
    cached.boxMetrics === boxMetrics &&
    cached.measureSegment === measureSegment &&
    cached.letterSpacingPx === letterSpacingPx &&
    cached.renderAdvances === renderAdvances
  ) {
    cached.columnsRef = columns;
    return cached.height;
  }

  // Read where CSS states it, the bench-app constants where it does not. There
  // is no third source any more: the calibration used to infer these exact two
  // numbers from measured rows, and inferring what the browser will simply
  // report is the thing this phase removed. A grid with no box must produce
  // byte-identical results to before any of this existed.
  const lineHeightPx = boxMetrics?.lineHeightPx ?? ROW_LINE_HEIGHT;
  const chromeHeightPx =
    boxMetrics === null
      ? ROW_CHROME_HEIGHT
      : boxMetrics.paddingYPx * 2 + boxMetrics.borderPx;
  const paddingXPx = boxMetrics?.paddingXPx ?? NO_BOX_PADDING_X;
  const floorPx = calibration?.floorPx ?? null;

  let estimatedHeight = Math.max(baseHeight, floorPx ?? 0);
  let predictedLines = 1;
  let textDrivenHeight = 0;

  for (const column of columns) {
    if (!column.wrap) {
      continue;
    }

    const prepared = prepareWrappedColumnText(
      row,
      column,
      averageCharWidthPx,
      measureSegment,
      letterSpacingPx,
      renderAdvances,
    );
    // The text box, not the column box. Padding is on both sides.
    const layout = layoutPreparedText(
      prepared,
      resolveWrapWidth(column, paddingXPx),
      {
        lineHeightPx,
        wrapMode: "wrap",
      },
    );

    predictedLines = Math.max(
      predictedLines,
      Math.round(layout.height / lineHeightPx),
    );
    textDrivenHeight = Math.max(
      textDrivenHeight,
      resolveContentHeight(
        layout.height,
        lineHeightPx,
        // Gated on the same condition the width is: text with no word token has
        // nothing for the render's output to sit beside, so it takes neither
        // term. `text-core` reports one line box for an empty string, which is
        // why this is not implied by the height being positive.
        findLastWordIndex(prepared) === -1
          ? null
          : (renderAdvances?.get(column.id)?.lastLineBoxPx ?? null),
      ) + chromeHeightPx,
    );
  }

  // The hinge — `estimate ≈ max(floor, chrome + lines × lineHeight)` — applied
  // where it bites. A row of one line or fewer is frequently not
  // decided by its wrapped text at all: a custom two-line renderer the estimator
  // is structurally blind to is the tallest cell, which is precisely what the
  // floor is learned from. So once a floor exists, it answers for those rows and
  // the text arithmetic must not raise it.
  //
  // It cannot under-estimate them, either, and that is a construction property
  // rather than a lucky heuristic: the floor is the running max over exactly the
  // L <= 1 population, and those rows' measured heights already include whatever
  // one line of text cost them. Answering an L <= 1 row from the floor is the
  // definition of the term, not an approximation of it.
  //
  // This is not merely tidy. `floorPx` is learned from the first short row, and
  // on a grid that supplies no box the line height and chrome are still the
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
    averageCharWidthPx,
    boxMetrics,
    measureSegment,
    letterSpacingPx,
    renderAdvances,
  });

  return estimatedHeight;
}

/**
 * A wrapped cell's content height: `(L − 1) × lineHeight + lastLineBox`.
 *
 * The estimator charged `L × lineHeight` until this existed, and that is wrong
 * for exactly one line — the last one. A line box is as tall as the tallest
 * thing sitting on it, and what a column's `render` draws beside the text sits
 * on the last line by construction (see `chargeRenderAdvance`: the advance is
 * glued to the final word token, because there is no break opportunity between
 * them). On the homepage hero that line box measures **22.61875px** against a
 * 20.3px line, which is 2.31875px of under-estimate on every wrapped row.
 *
 * `lastLineBoxPx` is measured, never inferred, and it is NOT the drawn
 * element's own height — see {@link RenderAdvance.lastLineBoxPx}.
 *
 * Three properties, in the order they matter:
 *
 * 1. **With no measured line box the output is byte-identical.** `null` clamps
 *    to `lineHeightPx` and the expression is `height + 0`, which is `height`
 *    exactly rather than a re-derivation of it through `L`. A grid that
 *    supplies no advances — every grid, until one measures — cannot move.
 * 2. **A measured box shorter than a line charges nothing.** The browser lays
 *    lines out at a rounded advance (Chromium quantises 20.3px to 20.296875px),
 *    so a genuinely unremarkable line box measures a hair UNDER the line height
 *    it was computed from. `Math.max` makes that the same answer as `null`
 *    rather than a fractional discount.
 * 3. **Text that occupies no line box gets no last line box.** Its caller
 *    applies the same rule one level up, for the emptier case `text-core` does
 *    report a line box for: a cell with no word token at all. Both are the
 *    floor's business, not this term's.
 */
function resolveContentHeight(
  textHeightPx: number,
  lineHeightPx: number,
  lastLineBoxPx: number | null,
): number {
  if (!(textHeightPx > 0)) return textHeightPx;
  return textHeightPx + Math.max(0, (lastLineBoxPx ?? 0) - lineHeightPx);
}

/**
 * The one place a wrapped column's text is prepared, shared by the height
 * estimate and the line-count prediction. They must agree exactly: a
 * calibration fitted against a line count no estimate was built from learns a
 * correction for a model nobody runs.
 */
function prepareWrappedColumnText<TRow extends object>(
  row: TRow,
  column: DomLayoutColumn<TRow>,
  averageCharWidthPx: number | null,
  measureSegment: SegmentMeasurer | null,
  letterSpacingPx: number | null,
  renderAdvances: RenderAdvances | null,
): PreparedText {
  const prepared = prepareText(
    prepareTextInput(
      String(readCellValue(row, column)),
      averageCharWidthPx,
      measureSegment,
      letterSpacingPx,
    ),
  );
  return chargeRenderAdvance(
    prepared,
    renderAdvances?.get(column.id)?.widthPx ?? 0,
  );
}

/**
 * Charge a column's render advance to the LAST word of its text, rather than to
 * every line by narrowing the wrap width.
 *
 * Which of those two models the browser implements is not a matter of taste,
 * and it was measured rather than reasoned about. Probe: the running homepage
 * hero in Chromium 1.62.1's bundled build, four real analyst strings laid out
 * in the hero's own `span.analyst` (14px/20.3px system-ui) at every container
 * width from 120px to 460px in 10px steps — 140 cases — with the hero's own
 * badge node cloned in, line counts read back as `height / lineHeight`:
 *
 *   narrowing the wrap width by the advance   57 of 140 wrong, ALL over
 *   charging it to the last word               3 of 140 wrong
 *
 * The three misses are all at 120-140px, where the glued run is wider than the
 * whole line and `text-core` splits it by the word's own average grapheme
 * density; they are that approximation, not this model.
 *
 * The reason is the browser's line-breaking rule, and the probe agrees with it:
 * an inline element sits on the last line, so it constrains only that line —
 * and because it is adjacent to the last character with no intervening space,
 * there is no break opportunity between them. The last word and the badge move
 * down together, which is exactly a wider last word.
 *
 * So this narrows nothing: the wrap width stays the column box less its
 * padding, and the advance rides the last word. A zero or negative wrap width
 * is therefore not reachable through the advance at all — a badge wider than
 * its own column produces an over-wide word, which `layoutPreparedText` already
 * breaks inside itself.
 *
 * Both of `text-core`'s paths are charged, so the two cannot disagree: the
 * measured path takes the pixels directly, and the average path converts them
 * to grapheme-equivalents at the same effective advance it wraps by. `length`
 * is what the character path counts, so that is what it has to be charged in.
 *
 * Text with no word token at all — empty, or whitespace only — is left alone.
 * There is nothing for the advance to be glued to, and one badge on an
 * otherwise empty line does not add a line box.
 */
/**
 * Index of the last `word` token, or `-1` when the text has none — empty, or
 * whitespace only.
 *
 * The one place "is there anything for the render's output to sit beside" is
 * decided, because both terms of {@link RenderAdvance} have to answer it the
 * same way. A cell with no word has no last line for a badge to ride, so it
 * takes neither the width nor the taller line box.
 */
function findLastWordIndex(prepared: PreparedText): number {
  for (let index = prepared.tokens.length - 1; index >= 0; index -= 1) {
    if (prepared.tokens[index]?.kind === "word") return index;
  }
  return -1;
}

function chargeRenderAdvance(
  prepared: PreparedText,
  advancePx: number,
): PreparedText {
  if (!(advancePx > 0)) return prepared;
  const lastWordIndex = findLastWordIndex(prepared);
  if (lastWordIndex === -1) return prepared;

  const widths = prepared.tokenWidthsPx;
  if (widths !== undefined) {
    const charged = [...widths];
    charged[lastWordIndex] = (charged[lastWordIndex] ?? 0) + advancePx;
    return { ...prepared, tokenWidthsPx: charged };
  }

  const perGrapheme = prepared.averageCharWidth;
  if (!(perGrapheme > 0)) return prepared;
  const token = prepared.tokens[lastWordIndex];
  if (token === undefined) return prepared;
  const tokens = [...prepared.tokens];
  tokens[lastWordIndex] = {
    ...token,
    length: token.length + Math.ceil(advancePx / perGrapheme),
  };
  return { ...prepared, tokens };
}

/**
 * The one place the estimator's text inputs are assembled.
 */
function prepareTextInput(
  text: string,
  averageCharWidthPx: number | null,
  measureSegment: SegmentMeasurer | null,
  letterSpacingPx: number | null,
): Parameters<typeof prepareText>[0] {
  return {
    text,
    fontKey: ESTIMATE_FONT_KEY,
    // Measured where the platform allows it; the guess otherwise. `prepareText`
    // infers a width from the font-key string when this is undefined, and the
    // key we pass matches none of its patterns — so the guess is always 7.
    // Still supplied on the measured path: `text-core` keeps it for the inputs
    // segment widths cannot answer.
    averageCharWidth: averageCharWidthPx ?? ESTIMATED_CHARACTER_WIDTH,
    ...(measureSegment === null ? {} : { measureSegment }),
    ...(letterSpacingPx === null ? {} : { letterSpacingPx }),
  };
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
  averageCharWidthPx: number | null = null,
  boxMetrics: RowBoxMetrics | null = null,
  measureSegment: SegmentMeasurer | null = null,
  letterSpacingPx: number | null = null,
  renderAdvances: RenderAdvances | null = null,
): number {
  // Every term must match what `estimateDomRowHeight` was given, or the
  // calibration fits a correction to a line count no estimate was ever built
  // from. That is why the controller reads one box per estimate and hands the
  // same one to both.
  const lineHeightPx = boxMetrics?.lineHeightPx ?? ROW_LINE_HEIGHT;
  const paddingXPx = boxMetrics?.paddingXPx ?? NO_BOX_PADDING_X;
  let lines = 1;
  for (const column of columns) {
    if (!column.wrap) continue;
    const prepared = prepareWrappedColumnText(
      row,
      column,
      averageCharWidthPx,
      measureSegment,
      letterSpacingPx,
      renderAdvances,
    );
    const layout = layoutPreparedText(
      prepared,
      resolveWrapWidth(column, paddingXPx),
      {
        lineHeightPx,
        wrapMode: "wrap",
      },
    );
    lines = Math.max(lines, Math.round(layout.height / lineHeightPx));
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
