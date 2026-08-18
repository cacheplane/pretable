/**
 * Half-open row index range — `start` inclusive, `end` exclusive — used to
 * describe a visible row window without materializing the rows outside it.
 *
 * @public
 */
export interface PretableRowRange {
  start: number;
  end: number;
}

/**
 * Read-only view of row geometry. Split out of {@link RowMetricsIndex} so that
 * read-only consumers — a render snapshot handed to application code, or the
 * pure scroll math — can accept row offsets without also advertising the
 * mutators that maintain them. A full index is assignable wherever a reader is
 * expected.
 *
 * Reachable from application code as `PretableRenderSnapshot.rowMetrics`, so
 * it is public even though this package is not published: `@pretable/react`
 * inlines and re-exports it.
 *
 * @public
 */
export interface RowMetricsReader {
  readonly rowCount: number;
  getHeight(index: number): number;
  getOffsetForIndex(index: number): number;
  getIndexForOffset(offset: number): number;
  getTotalHeight(): number;
}

/** @internal */
export interface RowMetricsIndex extends RowMetricsReader {
  updateHeight(index: number, height: number): void;
}

/** One visible row and its optional unmeasured height estimate. @internal */
export interface RowHeightEntry<TKey> {
  readonly key: TKey;
  readonly estimatedHeight?: number;
}

/**
 * A primitive identity must be pure and stable for the index lifetime. It is
 * intentionally supplied by the owner so recreated discriminated row refs can
 * share measurements without relying on object identity or serialization.
 * @internal
 */
export interface CreateRowHeightIndexOptions<TKey> {
  readonly defaultHeight: number;
  readonly getKey: (key: TKey) => string | number;
  readonly rows?: readonly RowHeightEntry<TKey>[];
  /** Maximum measured heights retained for keys that are not currently visible. */
  readonly maxRetainedMeasurements?: number;
}

/**
 * Sequential structural changes expressed against the current intermediate
 * root. Moves and removals retain measurements by stable identity; updates
 * invalidate the affected measurement so the estimate is used until the row
 * is measured again.
 * @internal
 */
export type RowHeightOperation<TKey> =
  | {
      readonly kind: "insert";
      readonly ref: TKey;
      readonly index: number;
      readonly estimatedHeight?: number;
    }
  | {
      readonly kind: "remove";
      readonly ref: TKey;
      readonly previousIndex: number;
    }
  | {
      readonly kind: "move";
      readonly ref: TKey;
      readonly previousIndex: number;
      readonly index: number;
    }
  | {
      readonly kind: "update";
      readonly ref: TKey;
      readonly index: number;
      readonly estimatedHeight?: number;
    };

/** A captured pixel position within a stable logical row. @internal */
export interface RowHeightAnchor<TKey> {
  readonly ref: TKey;
  readonly offset: number;
}

/** Indexed replacement input; rows are read lazily by cooperative builders. @internal */
export interface RowHeightReplacementSource<TKey> {
  readonly rowCount: number;
  entryAt(index: number): RowHeightEntry<TKey>;
}

/** One cooperative replacement slice budget. @internal */
export interface RowHeightReplacementAdvanceOptions {
  /** Positive integer work budget; implementations enforce a hard cap of 256. */
  readonly maxUnits: number;
  /** Absolute deadline in the clock domain returned by `now`. */
  readonly deadline?: number;
  /** Required with `deadline`; sampled after every completed work unit. */
  readonly now?: () => number;
}

/** Observable cooperative replacement progress. @internal */
export interface RowHeightReplacementProgress {
  readonly phase:
    | "ingest"
    | "scan-retained"
    | "scan-visible"
    | "evict"
    | "build-tombstones"
    | "build-sequence"
    | "build-retention-order"
    | "done";
  readonly completedUnits: number;
  readonly totalUnits: number;
  readonly unitsThisSlice: number;
  readonly sourceRowsIngested: number;
  readonly previousRowsScanned: number;
  readonly done: boolean;
}

/** Cancellable cooperative construction of one immutable height root. @internal */
export interface RowHeightReplacementBuilder<TKey> {
  readonly done: boolean;
  readonly progress: RowHeightReplacementProgress;
  advance(
    options: RowHeightReplacementAdvanceOptions,
  ): RowHeightReplacementProgress;
  finish(): RowHeightIndex<TKey>;
  cancel(): void;
}

/**
 * Immutable, persistent row geometry keyed by logical visible-row identity.
 * `replace` and later inserts reuse retained measurements for equal stable keys,
 * even when the caller supplies newly allocated key objects.
 * @internal
 */
export interface RowHeightIndex<TKey> extends RowMetricsReader {
  /**
   * True iff the index holds ANY state a replacement could retain: a cached
   * measurement, a tombstoned (removed-row) measurement, or retention-order
   * bookkeeping. Visible entries alone are NOT retained state — a populated but
   * never-measured index reports `false`, because a replacement's retained-state
   * lookups would all miss and rebuilding from the source alone is exact. When
   * this is `false`, `beginReplacement` returns a builder that completes in a
   * single `advance` (the synchronous bulk path); callers may run it to
   * completion without cooperative slicing.
   */
  readonly hasRetainedState: boolean;
  keyAt(index: number): TKey | undefined;
  hasMeasurement(ref: TKey): boolean;
  /**
   * Mean of every height in the measurement cache — rows currently visible and
   * measured, plus the retained measurements of rows that have left the view.
   * `undefined` when nothing has been measured, which is the caller's cue to
   * fall back to its default height rather than to a mean of no samples.
   *
   * Estimates are deliberately excluded: `apply` drops a row's cached entry
   * when it re-estimates, so this is a mean over numbers the DOM reported, not
   * over the arithmetic that stands in for them.
   *
   * It is an ESTIMATOR, not a total. Rows are not uniform, so multiplying it
   * by a row count gives a region's approximate height, never its exact one.
   */
  getMeasuredHeightMean(): number | undefined;
  measure(index: number, ref: TKey, height: number): RowHeightIndex<TKey>;
  /** Retains a bounded measured height for a stable key absent from the view. */
  retainMeasurement(ref: TKey, height: number): RowHeightIndex<TKey>;
  apply(operations: readonly RowHeightOperation<TKey>[]): RowHeightIndex<TKey>;
  replace(rows: readonly RowHeightEntry<TKey>[]): RowHeightIndex<TKey>;
  /**
   * Rebuilds the ordered structure from the EXISTING entries in a new order —
   * a permutation of the current rows, synchronously. No entry is re-measured
   * or re-estimated (source `estimatedHeight`s are ignored); only the sequence
   * and its prefix sums are recomputed. Throws when the source is not an exact
   * permutation of the current rows; callers fall back to `beginReplacement`.
   */
  reorder(source: RowHeightReplacementSource<TKey>): RowHeightIndex<TKey>;
  beginReplacement(
    source: RowHeightReplacementSource<TKey>,
  ): RowHeightReplacementBuilder<TKey>;
  captureAnchor(
    index: number,
    scrollTop: number,
  ): RowHeightAnchor<TKey> | undefined;
  restoreAnchor(anchor: RowHeightAnchor<TKey>, index: number): number;
}

/** @internal */
export interface PinnedColumnInput {
  columnId: string;
  width: number;
}

/** @internal */
export interface PlannedPinnedColumn extends PinnedColumnInput {
  side: "left" | "right";
  start: number;
  end: number;
}

/** @internal */
export interface PlannedRow {
  index: number;
  top: number;
  height: number;
}

/** @internal */
export interface PlanViewportInput {
  scrollTop: number;
  viewportHeight: number;
  overscan: number;
  rowMetrics: RowMetricsReader;
  /** Geometry for rows before the window. Never materialized as rows. */
  leadingHeight?: number;
  /** Geometry for rows after the window. Never materialized as rows. */
  trailingHeight?: number;
  pinnedLeft?: PinnedColumnInput[];
  pinnedRight?: PinnedColumnInput[];
}

/** @internal */
export interface ViewportPlan {
  range: PretableRowRange;
  rows: PlannedRow[];
  totalHeight: number;
  pinned: {
    left: PlannedPinnedColumn[];
    right: PlannedPinnedColumn[];
  };
}

/** @internal */
export interface PlanColumnsInput {
  columns: readonly PlanColumnsColumnInput[];
  scrollLeft: number;
  viewportWidth: number;
  overscan: number;
}

/** @internal */
export interface PlanColumnsColumnInput {
  id: string;
  width: number;
  pinned?: "left" | "right";
}

/**
 * One column's resolved geometry in a layout pass.
 *
 * Reachable from application code as `PretableRenderSnapshot.columns`, so it is
 * public even though this package is not published: `@pretable/react` inlines
 * and re-exports it.
 *
 * @public
 */
export interface PlannedColumn {
  index: number;
  id: string;
  /**
   * The column's content offset in px — where it sits in the end-to-end
   * column layout, always measured from the start of the content box.
   *
   * Left-pinned and scrollable columns render at this offset. Right-pinned
   * columns do not (they are positioned from the measured scrollport
   * instead), but `left` is still their true content offset, so consumers
   * that map plan entries onto content coordinates — the drag-to-reorder drop
   * indicator, for one — get a usable answer for every column.
   */
  left: number;
  width: number;
  pinned?: "left" | "right";
  /**
   * Offset from the viewport's right edge, in px. Set only for right-pinned
   * columns (the last one is flush at `0`); left-pinned and scrollable
   * columns position themselves with `left`.
   */
  right?: number;
}

/** @internal */
export interface ColumnPlan {
  columns: PlannedColumn[];
  totalWidth: number;
  pinnedLeftWidth: number;
  pinnedRightWidth: number;
}

/**
 * Tuning knobs for column autosize calculations.
 *
 * @public
 */
export interface AutosizeOptions {
  maxWidthPx?: number;
  minWidthPx?: number;
  averageCharWidth?: number;
  cellPaddingPx?: number;
}
