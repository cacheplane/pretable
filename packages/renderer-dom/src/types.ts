import type {
  PretableColumn,
  PretableFrame,
  PretableRow,
  PretableGridSnapshot,
} from "@pretable-internal/grid-core";
import type {
  PlannedColumn,
  RowMetricsIndex,
} from "@pretable-internal/layout-core";

export interface DomRenderInput<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn<TRow>[];
  snapshot: PretableGridSnapshot<TRow>;
  scrollTop: number;
  scrollLeft?: number;
  viewportHeight: number;
  viewportWidth?: number;
  overscan: number;
  measuredHeights?: Record<string, number>;
}

export interface DomRenderRow<TRow extends PretableRow = PretableRow> {
  id: string;
  row: TRow;
  rowIndex: number;
  top: number;
  height: number;
}

export interface DomRenderSnapshot<TRow extends PretableRow = PretableRow> {
  frame: PretableFrame<TRow>;
  /** Only the *windowed* rows. For anything outside it, use `rowMetrics`. */
  rows: DomRenderRow<TRow>[];
  columns: PlannedColumn[];
  /**
   * Row offsets and heights for **every** visible row, not just the windowed
   * ones in `rows` — the same index the viewport planner ran against, passed
   * through rather than rebuilt. Consumers that need the geometry of an
   * unrendered row (scroll-into-view for keyboard focus, for one) read it here
   * instead of re-deriving offsets, which is what keeps them from drifting
   * from `layout-core`.
   */
  rowMetrics: RowMetricsIndex;
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
  /**
   * Total width of the left-pinned column group, as `planColumns` computes it.
   * The left-pinned group overlays content at `scrollLeft`, so the unoccluded
   * band starts at `scrollLeft + pinnedLeftWidth`.
   */
  pinnedLeftWidth: number;
  /** Total width of the right-pinned column group, as `planColumns` computes it. */
  pinnedRightWidth: number;
}
