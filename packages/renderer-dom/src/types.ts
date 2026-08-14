import type {
  PlannedColumn,
  PretableRowRange,
  RowHeightIndex,
  RowMetricsReader,
} from "@pretable-internal/layout-core";
import type {
  PretableGroupId,
  PretableGroupRow as IndexedPretableGroupRow,
  PretableRowId,
  PretableRowModel,
  PretableRowModelSnapshot,
  PretableVisibleRow,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

/** The vertical window owned by an indexed row-layout controller. */
export interface RowLayoutViewport {
  readonly scrollTop: number;
  readonly viewportHeight: number;
  readonly overscan: number;
}

/** Cooperative continuation policy injected by hosts and deterministic tests. */
export interface RowLayoutScheduler {
  schedule(task: () => void): () => void;
}

export type RowLayoutControllerStatus =
  | { readonly kind: "ready" }
  | { readonly kind: "rebuilding"; readonly targetRevision: number }
  | { readonly kind: "error"; readonly error: RowLayoutControllerError }
  | { readonly kind: "disposed" };

export class RowLayoutControllerError extends Error {
  readonly code: "layout-failed" | "scheduler-failed" | "disposed-controller";
  override readonly cause?: unknown;

  constructor(
    code: RowLayoutControllerError["code"],
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = "RowLayoutControllerError";
    this.code = code;
    this.cause = cause;
  }
}

/** One immutable visible row already paired with its planned geometry. */
export interface RowLayoutWindowRow<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly index: number;
  readonly top: number;
  readonly height: number;
  readonly ref: PretableVisibleRowRef<TRowId>;
  readonly row: PretableVisibleRow<TRow, TRowId, TColumns>;
}

/** One atomic external-store publication. */
export interface RowLayoutControllerState<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly observedRevision: number | null;
  readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns> | null;
  readonly rowHeights: RowHeightIndex<PretableVisibleRowRef<TRowId>>;
  readonly viewport: Readonly<RowLayoutViewport>;
  readonly scrollTop: number;
  readonly range: Readonly<PretableRowRange>;
  readonly window: readonly RowLayoutWindowRow<TRow, TRowId, TColumns>[];
  readonly status: RowLayoutControllerStatus;
}

declare const rowLayoutControllerType: unique symbol;

export interface RowLayoutController<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly getState: () => RowLayoutControllerState<TRow, TRowId, TColumns>;
  /** Starts model observation. Idempotent; `subscribe` also activates. */
  readonly activate: () => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setColumns: (columns: readonly DomLayoutColumn<TRow>[]) => void;
  readonly setViewport: (viewport: RowLayoutViewport) => void;
  readonly measure: (
    ref: PretableVisibleRowRef<TRowId>,
    height: number,
  ) => void;
  readonly dispose: () => void;
  /** @internal Compile-time-only invariant descriptor. */
  readonly [rowLayoutControllerType]?: (
    value: readonly [TRow, TRowId, TColumns],
  ) => readonly [TRow, TRowId, TColumns];
}

/** Visual/layout fields consumed by the indexed DOM renderer. */
export interface DomLayoutColumn<TRow extends object> {
  readonly id: string;
  readonly wrap?: boolean;
  readonly widthPx?: number;
  readonly pinned?: "left" | "right";
  readonly flex?: number;
  readonly minWidthPx?: number;
  readonly maxWidthPx?: number;
  readonly value?: (row: TRow) => unknown;
}

/**
 * The row box, as CSS states it: the cell's line height, its padding on both
 * axes, and its border.
 *
 * These were being inferred. A least-squares fit learned "line height" and
 * "chrome" from measured rows, and the wrap width ignored cell padding
 * entirely — both values the browser will hand over directly. The fit was not
 * merely redundant, it was harmful: it absorbed the padding error and hid it,
 * so a 7px-per-character guess and an un-deducted padding cancelled each other
 * out. Read what is readable.
 *
 * Declared here rather than in `@pretable/react` because this package is the
 * consumer — the estimator lives here, and react depends on this package and
 * not the other way round.
 *
 * @internal
 */
/**
 * Advance width of one token, in px, in the font the grid is drawing in.
 *
 * Supplied by the platform layer — `@pretable/react` measures on a canvas — so
 * this package stays free of font knowledge, exactly as `text-core` is.
 *
 * @internal
 */
export type SegmentMeasurer = (segment: string) => number;

export interface RowBoxMetrics {
  readonly lineHeightPx: number;
  readonly paddingXPx: number;
  readonly paddingYPx: number;
  readonly borderPx: number;
}

/**
 * What a column's `render` draws BESIDE its wrapped text, in the two dimensions
 * that change the row's height.
 *
 * The estimator wraps the raw cell value. A `render` that puts something next
 * to that text — the homepage hero's stance badge — is invisible to that string
 * and yet
 *
 *   - consumes WIDTH on the last line, which can push the text onto another
 *     line box ({@link RenderAdvance.widthPx}), and
 *   - makes the line box it sits on TALLER than a line of the text's own
 *     line-height ({@link RenderAdvance.lastLineBoxPx}).
 *
 * A column absent from the map has neither term measurable, and is estimated
 * exactly as it was before this existed. That is the conservative answer and it
 * is deliberate: see `getRenderAdvances` in `CreateRowLayoutControllerOptions`
 * for what "could not measure" covers.
 *
 * @internal
 */
export interface RenderAdvance {
  /**
   * Summed outer width (border box plus horizontal margins) of what the render
   * draws beside the text, px. Always positive: a column with nothing
   * measurable beside its text gets no entry at all.
   */
  readonly widthPx: number;
  /**
   * Height of the line box that content sits on, px — or `null` when it could
   * not be measured.
   *
   * `null` and any value at or below the line height are the same answer: the
   * estimator clamps to `lineHeightPx`, which is what it charged before this
   * term existed.
   *
   * NOT the same thing as the drawn element's own height, and that is a
   * measured finding rather than a modelling choice. The hero's badge is a
   * 21.25px border box on a 20.3px line and produces a **22.61875px** line box,
   * because an inline aligned on the baseline contributes its ascent and its
   * descent separately and each is maxed against the strut's. See
   * `measureLastLineBox` in `packages/react/src/density.ts` for the probe.
   */
  readonly lastLineBoxPx: number | null;
}

/**
 * {@link RenderAdvance} by column id.
 *
 * @internal
 */
export type RenderAdvances = ReadonlyMap<string, RenderAdvance>;

export interface CreateRowLayoutControllerOptions<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly model: PretableRowModel<TRow, TRowId, TColumns>;
  readonly columns: readonly DomLayoutColumn<TRow>[];
  readonly viewport: RowLayoutViewport;
  readonly scheduler?: RowLayoutScheduler;
  readonly now?: () => number;
  readonly budgetMs?: number;
  readonly maxUnitsPerSlice?: number;
  /**
   * Allows the first bounded replacement to finish during activation when its
   * entire visible index fits within this limit. Larger indexes always use the
   * cooperative scheduler.
   */
  readonly eagerInitialRowLimit?: number;
  readonly defaultRowHeight?: number;
  readonly maxRetainedMeasurements?: number;
  /**
   * Caps how many data rows retain their last DOM-reported height for use as an
   * update's fallback, in place of a fresh estimate. Distinct from
   * `maxRetainedMeasurements`, which bounds the height index's tombstones —
   * measurements for rows absent from the visible set — and does not bound live
   * measurements at all. Set to `0` to disable retention entirely, which returns
   * updated rows to estimating their height.
   */
  readonly maxRetainedRowHeights?: number;
  /** Defers model subscription and scheduled work until activation. */
  readonly deferActivation?: boolean;
  /**
   * Testable/custom estimate seam; the default uses wrapped column text.
   * Positive estimates below `defaultRowHeight` are clamped to that floor;
   * actual DOM measurements may still be smaller.
   */
  readonly estimateRowHeight?: (row: TRow) => number;
  /**
   * Resolves the grid font's average character width, or `null` when it cannot
   * be measured (server rendering, no canvas). Called lazily per estimate, not
   * once at construction: the font is only measurable after something has
   * rendered, and a controller is built before that.
   *
   * Absent — or returning `null` — leaves the estimator on the width it guessed
   * before this option existed.
   */
  readonly getAverageCharWidthPx?: () => number | null;
  /**
   * Resolves the active theme's row box, or `null` when it cannot be read yet
   * (server rendering, nothing painted). Called lazily per estimate for the
   * same reason as {@link getAverageCharWidthPx}: the cell's line height only
   * exists once a cell does, and a controller is built before that.
   *
   * The returned object's IDENTITY is part of the estimate memo key, so the
   * implementation must return the same object while the theme is unchanged.
   * A getter that rebuilt the box per call would miss the memo on every row.
   *
   * Absent — or returning `null` — leaves the estimator on the constants it
   * used before this option existed: no padding deducted from the wrap width,
   * and the bench app's line height and chrome.
   */
  readonly getRowBoxMetrics?: () => RowBoxMetrics | null;
  /**
   * Resolves a measurer for the grid font's per-token advance width, or `null`
   * when nothing can measure it (server rendering, no canvas, nothing painted).
   * Called lazily per estimate for the same lifetime reason as
   * {@link getAverageCharWidthPx}.
   *
   * The returned function's IDENTITY is part of the estimate memo key, so the
   * implementation must return the same function while the font is unchanged.
   * A getter that rebuilt a closure per call would miss the memo on every row.
   *
   * Absent — or returning `null` — leaves the estimator wrapping by average
   * character width, exactly as it did before this option existed.
   */
  readonly getSegmentMeasurer?: () => SegmentMeasurer | null;
  /**
   * Resolves the cell's CSS `letter-spacing` in px, or `null` when it cannot be
   * read yet. Absent, `null` and `0` all leave every estimate untouched.
   */
  readonly getLetterSpacingPx?: () => number | null;
  /**
   * Resolves how much horizontal space each wrapped column's `render` draws
   * beside its text ({@link RenderAdvances}), or `null` when nothing has been
   * measured yet. Called lazily per estimate for the same lifetime reason as
   * {@link getAverageCharWidthPx}: a renderer's output only exists once a cell
   * has rendered, and a controller is built before that.
   *
   * The returned map's IDENTITY is part of the estimate memo key, so the
   * implementation must return the same map while the measurements are
   * unchanged, exactly as {@link getRowBoxMetrics} must for the box.
   *
   * Absent, `null`, and a column missing from the map all leave that column
   * estimated as it was before this option existed.
   */
  readonly getRenderAdvances?: () => RenderAdvances | null;
}

export interface IndexedDomRenderInput<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly controllerState: RowLayoutControllerState<TRow, TRowId, TColumns>;
  readonly columns: readonly DomLayoutColumn<TRow>[];
  readonly scrollLeft?: number;
  readonly viewportWidth?: number;
}

export interface IndexedDomRenderRowGeometry<TRowId extends PretableRowId> {
  readonly id: string;
  readonly ref: PretableVisibleRowRef<TRowId>;
  readonly rowIndex: number;
  readonly top: number;
  readonly height: number;
}

export interface IndexedDomRenderDataRow<
  TRow extends object,
  TRowId extends PretableRowId,
> extends IndexedDomRenderRowGeometry<TRowId> {
  readonly kind: "data";
  readonly row: TRow;
}

export interface IndexedDomRenderGroupRow<
  TRowId extends PretableRowId,
  TColumns,
> extends IndexedDomRenderRowGeometry<TRowId> {
  readonly kind: "group";
  readonly group: IndexedPretableGroupRow<TColumns>;
}

export type IndexedDomRenderRow<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> =
  | IndexedDomRenderDataRow<TRow, TRowId>
  | IndexedDomRenderGroupRow<TRowId, TColumns>;

export interface IndexedDomRenderSnapshot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly modelRevision: number | null;
  readonly modelSnapshot: PretableRowModelSnapshot<
    TRow,
    TRowId,
    TColumns
  > | null;
  readonly rows: readonly IndexedDomRenderRow<TRow, TRowId, TColumns>[];
  readonly columns: readonly PlannedColumn[];
  readonly rowMetrics: RowMetricsReader;
  readonly nodeCount: number;
  readonly totalHeight: number;
  readonly totalWidth: number;
  readonly pinnedLeftWidth: number;
  readonly pinnedRightWidth: number;
}

/** Converts a branded group identity into a stable render/debug id. */
export function groupRenderId(groupId: PretableGroupId): string {
  return `group:${groupId.length}:${groupId}`;
}
