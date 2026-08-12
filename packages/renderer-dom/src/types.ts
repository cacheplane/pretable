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

declare const rowLayoutControllerType: unique symbol;

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
  readonly measure: (
    ref: PretableVisibleRowRef<TRowId>,
    height: number,
  ) => void;
  readonly dispose: () => void;
  /** @internal Compile-time-only invariant descriptor. */
  readonly [rowLayoutControllerType]?: (
    value: readonly [TRow, TRowId, TColumns],
  ) => readonly [TRow, TRowId, TColumns];
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
  /**
   * Allows the first bounded replacement to finish during activation when its
   * entire visible index fits within this limit. Larger indexes always use the
   * cooperative scheduler.
   */
  readonly eagerInitialRowLimit?: number;
  readonly defaultRowHeight?: number;
  readonly maxRetainedMeasurements?: number;
  /** Defers model subscription and scheduled work until activation. */
  readonly deferActivation?: boolean;
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
