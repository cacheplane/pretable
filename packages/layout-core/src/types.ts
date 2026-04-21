export interface LayoutSpan {
  start: number;
  end: number;
}

export interface RowMetricsIndex {
  readonly rowCount: number;
  getHeight(index: number): number;
  getOffsetForIndex(index: number): number;
  getIndexForOffset(offset: number): number;
  getTotalHeight(): number;
  updateHeight(index: number, height: number): void;
}

export interface PinnedColumnInput {
  columnId: string;
  width: number;
}

export interface PlannedPinnedColumn extends PinnedColumnInput {
  side: "left" | "right";
  start: number;
  end: number;
}

export interface PlannedRow {
  index: number;
  top: number;
  height: number;
}

export interface PlanViewportInput {
  scrollTop: number;
  viewportHeight: number;
  overscan: number;
  rowMetrics: RowMetricsIndex;
  pinnedLeft?: PinnedColumnInput[];
  pinnedRight?: PinnedColumnInput[];
}

export interface ViewportPlan {
  range: LayoutSpan;
  rows: PlannedRow[];
  totalHeight: number;
  pinned: {
    left: PlannedPinnedColumn[];
    right: PlannedPinnedColumn[];
  };
}

export interface PlanColumnsInput {
  columns: readonly PlanColumnsColumnInput[];
  scrollLeft: number;
  viewportWidth: number;
  overscan: number;
}

export interface PlanColumnsColumnInput {
  id: string;
  width: number;
  pinned?: "left";
}

export interface PlannedColumn {
  index: number;
  id: string;
  left: number;
  width: number;
  pinned?: "left";
}

export interface ColumnPlan {
  columns: PlannedColumn[];
  totalWidth: number;
  pinnedLeftWidth: number;
}
