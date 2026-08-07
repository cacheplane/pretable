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
  getTotalHeight(): number;
}

/** @internal */
export interface RowMetricsIndex extends RowMetricsReader {
  getIndexForOffset(offset: number): number;
  updateHeight(index: number, height: number): void;
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
  rowMetrics: RowMetricsIndex;
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
