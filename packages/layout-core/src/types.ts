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

/** @internal */
export interface RowMetricsIndex {
  readonly rowCount: number;
  getHeight(index: number): number;
  getOffsetForIndex(index: number): number;
  getIndexForOffset(offset: number): number;
  getTotalHeight(): number;
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
  pinned?: "left";
}

/** @internal */
export interface PlannedColumn {
  index: number;
  id: string;
  left: number;
  width: number;
  pinned?: "left";
}

/** @internal */
export interface ColumnPlan {
  columns: PlannedColumn[];
  totalWidth: number;
  pinnedLeftWidth: number;
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
