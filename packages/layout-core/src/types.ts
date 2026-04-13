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
