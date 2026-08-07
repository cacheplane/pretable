import type {
  PretableColumn,
  PretableFrame,
  PretableGroupRow,
  PretableRow,
  PretableGridSnapshot,
} from "@pretable-internal/grid-core";
import type {
  PlannedColumn,
  RowMetricsReader,
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

/** Geometry every windowed row carries, whatever its kind. */
export interface DomRenderRowGeometry {
  id: string;
  /** Index into `snapshot.visibleRows` — group rows included. */
  rowIndex: number;
  top: number;
  height: number;
}

/** A windowed data row: the source row plus its placement. */
export interface DomRenderDataRow<
  TRow extends PretableRow = PretableRow,
> extends DomRenderRowGeometry {
  kind: "data";
  row: TRow;
}

/**
 * A windowed group header row. The renderer plans and passes these through so a
 * surface can draw them; drawing them is sub-project 2, and until then every
 * consumer narrows to `kind === "data"` and skips these.
 */
export interface DomRenderGroupRow extends DomRenderRowGeometry {
  kind: "group";
  group: PretableGroupRow;
}

/**
 * One windowed row, mirroring `PretableVisibleRow`'s discriminant so a consumer
 * narrows the render row exactly as it narrows the visible row.
 */
export type DomRenderRow<TRow extends PretableRow = PretableRow> =
  | DomRenderDataRow<TRow>
  | DomRenderGroupRow;

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
   *
   * Typed as the read-only `RowMetricsReader` rather than the full index: the
   * snapshot is a render *output*, and the live index it aliases is owned and
   * rebuilt by the renderer on every layout pass, so a caller that mutated it
   * would only have its write discarded.
   */
  rowMetrics: RowMetricsReader;
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
