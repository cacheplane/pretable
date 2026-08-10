/**
 * Half-open row index range — `start` inclusive, `end` exclusive — used to
 * describe the visible row window in {@link PretableGridSnapshot.visibleRange}.
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
 * @internal
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

/**
 * Immutable, persistent row geometry keyed by logical visible-row identity.
 * `replace` and later inserts reuse retained measurements for equal stable keys,
 * even when the caller supplies newly allocated key objects.
 * @internal
 */
export interface RowHeightIndex<TKey> extends RowMetricsReader {
  keyAt(index: number): TKey | undefined;
  hasMeasurement(ref: TKey): boolean;
  measure(index: number, ref: TKey, height: number): RowHeightIndex<TKey>;
  apply(operations: readonly RowHeightOperation<TKey>[]): RowHeightIndex<TKey>;
  replace(rows: readonly RowHeightEntry<TKey>[]): RowHeightIndex<TKey>;
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

/** @internal */
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

/** @internal */
export interface AutosizeColumnDef<
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  header?: string;
  widthPx?: number;
  wrap?: boolean;
  value?: (row: TRow) => unknown;
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

/** @internal */
export interface AutosizeColumnsInput<
  TRow extends Record<string, unknown> = Record<string, unknown>,
> {
  columns: AutosizeColumnDef<TRow>[];
  rows: TRow[];
  options?: AutosizeOptions;
}

/** @internal */
export interface AutosizeResult {
  widths: Map<string, number>;
}
