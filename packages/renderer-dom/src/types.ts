import type {
  PretableColumn,
  PretableFrame,
  PretableGroupRow,
  PretableRow,
  PretableGridSnapshot,
} from "@pretable-internal/grid-core";
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
  DomRenderDataRow<TRow> | DomRenderGroupRow;

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

export interface RowLayoutController<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  getState(): RowLayoutControllerState<TRow, TRowId, TColumns>;
  subscribe(listener: () => void): () => void;
  setViewport(viewport: RowLayoutViewport): void;
  measure(ref: PretableVisibleRowRef<TRowId>, height: number): void;
  dispose(): void;
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
  readonly defaultRowHeight?: number;
  readonly maxRetainedMeasurements?: number;
  /**
   * Testable/custom estimate seam; the default uses wrapped column text.
   * Positive estimates below `defaultRowHeight` are clamped to that floor;
   * actual DOM measurements may still be smaller.
   */
  readonly estimateRowHeight?: (row: TRow) => number;
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
