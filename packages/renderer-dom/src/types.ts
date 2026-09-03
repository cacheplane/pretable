import type {
  PlannedColumn,
  PretableRowRange,
  RowHeightIndex,
  RowMetricsReader,
} from "@pretable-internal/layout-core";
// Engine types come from `@pretable/core`, never from `@pretable-internal/*`
// directly, even though the latter is where they are written. `@pretable/core`
// re-emits those declarations into its own bundled `.d.ts` (`noExternal`), so
// importing them from both places puts two emissions of one declaration in
// front of the compiler at once — and TypeScript relates a deferred conditional
// like `PretableAggregateOutputOf<TAggregate>` by the identity of its alias, not
// its shape. `@pretable/react` compiles this package's `.d.ts` alongside
// `core/dist`, so the mismatch landed there, as `as unknown as` casts crossing
// its own row model into this controller. One emission, no crossing.
import type {
  PretableGroupId,
  PretableGroupRow as IndexedPretableGroupRow,
  PretableRowId,
  PretableRowModel,
  PretableRowModelSnapshot,
  PretableVisibleRow,
  PretableVisibleRowRef,
} from "@pretable/core";

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
  /**
   * Heights for the LOADED rows only, and therefore the one thing here that
   * is NOT in global coordinates: every offset it takes or returns
   * (`getOffsetForIndex`, `getIndexForOffset`, anchors) is measured from the
   * loaded window's own top. {@link RowLayoutControllerState.leadingHeight}
   * is the distance between that origin and this state's.
   */
  readonly rowHeights: RowHeightIndex<PretableVisibleRowRef<TRowId>>;
  readonly viewport: Readonly<RowLayoutViewport>;
  /**
   * GLOBAL: measured from the top of the whole dataset, leading spacer
   * included — the same space `window[].top`, `totalHeight` and the DOM
   * scroller's own `scrollTop` live in.
   *
   * One space, deliberately: consumers compare this against a row's `top`
   * constantly, and a snapshot that mixed the two drew a windowed grid
   * 240,000px below its own viewport while telemetry reported nothing
   * visible. Cross into `rowHeights`' local space with
   * {@link RowLayoutControllerState.leadingHeight}, never by assumption.
   */
  readonly scrollTop: number;
  readonly range: Readonly<PretableRowRange>;
  readonly window: readonly RowLayoutWindowRow<TRow, TRowId, TColumns>[];
  readonly status: RowLayoutControllerStatus;
  /**
   * The scroll extent for the loaded rows' own height plus any window
   * spacers (see {@link CreateRowLayoutControllerOptions.getWindowSpacers}).
   * Equal to `rowHeights.getTotalHeight()` whenever no spacers apply — a
   * local grid, or a windowed one whose honesty gate is not satisfied this
   * render.
   */
  readonly totalHeight: number;
  /**
   * The leading spacer's height: the distance between this state's GLOBAL
   * origin and `rowHeights`' LOCAL one, in pixels. `0` whenever no leading
   * spacer applies, which is every non-windowed grid.
   *
   * Published so a consumer holding both `rowHeights` (local) and `scrollTop`
   * / `window[].top` (global) can convert between them from one authority,
   * rather than re-deriving the spacer from a row count and a theme value the
   * controller may not have used.
   */
  readonly leadingHeight: number;
}

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
  /**
   * Re-reads {@link CreateRowLayoutControllerOptions.getWindowSpacers} and
   * republishes when the spacer geometry it reports no longer matches the
   * drawn one.
   *
   * The spacers are the one plan input the controller cannot observe: they
   * come from the consumer's `resultMeta`, which can change with the row set
   * byte-identical (a count query landing turns an estimated total exact at
   * the same window), and an identical row set is not an effective model
   * write, so no revision arrives. Without this the drawn leading spacer and
   * scroll extent stay collapsed at the old geometry while every other
   * derivation — `aria-rowindex`, `aria-rowcount` — has already moved.
   *
   * Idempotent and self-guarding: a call whose spacers already match what was
   * drawn does nothing, so a caller may fire it on every commit. Anchored, so
   * a leading spacer that appears under rows already on screen moves the
   * scroll offset rather than the rows.
   *
   * A NO-OP after {@link RowLayoutController.dispose}, where every other
   * method here throws — the one place this interface breaks that
   * uniformity, so it is stated rather than discovered. Those methods carry
   * consumer intent, and silently dropping one would hide a lifecycle bug.
   * This one carries none: it is fired unconditionally on every commit and
   * asks whether there is anything to redraw, and a disposed controller's
   * honest answer is "no". A grid in explicit-model mode whose consumer
   * disposes the model while the component is still mounted commits at least
   * once more afterwards, and throwing there took the whole render tree down.
   */
  readonly refreshWindowSpacers: () => void;
  readonly measure: (
    ref: PretableVisibleRowRef<TRowId>,
    height: number,
  ) => void;
  readonly dispose: () => void;
  /**
   * @internal Compile-time-only invariant descriptor. Keyed by a string
   * literal, not a `unique symbol`, for the reason given over `PretableGroupId`
   * in `@pretable-internal/row-model`'s `types.ts`: this package is `noExternal`
   * in `@pretable/react`'s bundle, so its declarations get re-emitted, and a
   * symbol brand is nominal per declaration file.
   */
  readonly "~pretableRowLayoutController"?: (
    value: readonly [TRow, TRowId, TColumns],
  ) => readonly [TRow, TRowId, TColumns];
}

/** Visual/layout fields consumed by the indexed DOM renderer. */
export interface DomLayoutColumn<
  TRow extends object,
  TColumnId extends string = string,
> {
  readonly id: TColumnId;
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

/**
 * The CSS `white-space` model a wrapped cell's text is laid out under, in the
 * three values `text-core` implements.
 *
 * @internal
 */
export type CellWrapMode = "wrap" | "nowrap" | "pre-wrap";

export interface RowBoxMetrics {
  readonly lineHeightPx: number;
  readonly paddingXPx: number;
  readonly paddingYPx: number;
  readonly borderPx: number;
  /**
   * How the browser will wrap this grid's wrapped cells, read from the element
   * that lays their text out — the same element {@link RowBoxMetrics.lineHeightPx}
   * comes from.
   *
   * `undefined` means UNRESOLVED, and is deliberately a third state rather
   * than a defaulted value. Every other field here has a sane fallback; this
   * one does not, because the wrong answer is not merely imprecise. Reading
   * `nowrap` off a cell that is not a wrapped cell would tell the estimator
   * that no wrapped column ever takes a second line, and a grid with no
   * readable cell at all — SSR, the first render, jsdom — has nothing to read.
   * So the platform layer resolves it only from a cell that declares itself
   * wrapped, and leaves it absent otherwise. Absent means the estimator keeps
   * the `"wrap"` it has always assumed.
   */
  readonly wrapMode?: CellWrapMode;
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

  /**
   * Resolves the current spacer row counts for a windowed dataset — how many
   * rows sit before / after the loaded window in the population the loaded
   * rows are a slice of. `undefined`/absent counts and a `null` return both
   * mean "no window": the planner is byte-for-byte unchanged from before this
   * option existed.
   *
   * Called lazily per plan, not captured at construction, for the same
   * lifetime reason as {@link getAverageCharWidthPx}: the controller instance
   * is built once per row model, while the window (a pager move, a re-fetch)
   * changes on a timescale of its own — often without the row model changing
   * at all.
   *
   * Row COUNTS, not pixel heights: the controller multiplies them by the mean
   * height of every row it has measured so far, falling back to
   * `defaultRowHeight` until something has been measured. The spacer is
   * therefore an ESTIMATE of the region's height — good enough that the scroll
   * extent tracks the population's real size, never exact, because a count
   * cannot say which rows are out there or what any one of them is worth.
   *
   * The caller is responsible for the honesty gate — whether the window is
   * trustworthy enough to report at all (external authority, no grouping, an
   * exact total). This option only draws whatever counts it is given; it does
   * not validate them.
   */
  readonly getWindowSpacers?: () => {
    readonly leadingRows?: number;
    readonly trailingRows?: number;
  } | null;
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
  /** `top` is GLOBAL — see {@link IndexedDomRenderSnapshot.leadingHeight}. */
  readonly rows: readonly IndexedDomRenderRow<TRow, TRowId, TColumns>[];
  readonly columns: readonly PlannedColumn[];
  /**
   * LOCAL to the loaded window: offsets in and out of this reader are
   * measured from the first loaded row, not from the top of the dataset.
   * Add {@link IndexedDomRenderSnapshot.leadingHeight} to compare one against
   * a row's `top` or against the DOM scroller's `scrollTop`.
   */
  readonly rowMetrics: RowMetricsReader;
  readonly nodeCount: number;
  readonly totalHeight: number;
  /**
   * The leading spacer's height — the distance between `rowMetrics`' local
   * origin and the global one `rows[].top` and `totalHeight` use. `0` for
   * every non-windowed grid.
   */
  readonly leadingHeight: number;
  readonly totalWidth: number;
  readonly pinnedLeftWidth: number;
  readonly pinnedRightWidth: number;
}

/** Converts a branded group identity into a stable render/debug id. */
export function groupRenderId(groupId: PretableGroupId): string {
  return `group:${groupId.length}:${groupId}`;
}
