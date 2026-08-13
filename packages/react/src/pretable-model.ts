import { createGridUiCore } from "@pretable-internal/grid-core";
import {
  createDomRenderSnapshot,
  createRowLayoutController,
  type DomLayoutColumn,
} from "@pretable-internal/renderer-dom";
import type { PretableRowModel as InternalRowModel } from "@pretable-internal/row-model";
import type {
  PretableQueryFor,
  PretableQueryTransition,
  ColumnIdOf,
  ColumnValueOf,
  PretableGroupRow,
  PretableRowId,
  PretableRowModel,
  PretableRowModelSnapshot,
  PretableRowModelStatus,
  PretableVisibleRowRef,
} from "@pretable/core";
import {
  useCallback,
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  getGridRenderAdvances,
  getGridRowBoxMetrics,
  getThemeRowHeight,
} from "./density";
import {
  getGridAverageCharWidth,
  getGridLetterSpacingPx,
  getGridSegmentMeasurer,
} from "./text-metrics";

/** Inclusive symbolic data-row span exposed by the indexed React grid. @public */
export interface PretableReactRowRange<TRowId extends PretableRowId> {
  readonly startRowId: TRowId;
  readonly endRowId: TRowId;
}

/** Immutable normalized row-range index exposed by the indexed React grid. @public */
export interface PretableReactRowRangeIndex<
  TRowId extends PretableRowId,
> extends Iterable<PretableReactRowRange<TRowId>> {
  readonly size: number;
}

/** Framework-independent indexed grid actions exposed by `usePretable`. @public */
export type PretableReactGrid<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> = {
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly getState: () => PretableGridUiSnapshot<TRowId, TColumns>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setViewport: (viewport: {
    readonly scrollTop: number;
    readonly scrollLeft: number;
    readonly height: number;
    readonly width: number;
  }) => void;
  readonly setFocus: (
    focus: PretableGridUiSnapshot<TRowId, TColumns>["focus"],
  ) => void;
  readonly moveFocus: (
    movement:
      | "up"
      | "down"
      | "left"
      | "right"
      | "page-up"
      | "page-down"
      | "home"
      | "end"
      | "tab"
      | "shift-tab"
      | "parent",
    options?: { readonly pageRows?: number },
  ) => void;
  readonly setSelection: (
    selection: PretableGridUiSnapshot<TRowId, TColumns>["selection"],
  ) => void;
  readonly toggleRowSelection: (rowId: TRowId) => void;
  readonly selectRowRange: (startRowId: TRowId, endRowId: TRowId) => void;
  readonly isRowSelected: (rowId: TRowId) => boolean;
  readonly getSelectionSummary: () => Readonly<{
    readonly state: "none" | "some" | "all";
    readonly selectedCount: number;
    readonly visibleCount: number;
  }>;
  readonly selectAllVisibleRows: () => void;
  readonly clearSelection: () => void;
  readonly beginEdit: <TColumnId extends ColumnIdOf<TColumns>>(input: {
    readonly rowId: TRowId;
    readonly columnId: TColumnId;
    readonly value: ColumnValueOf<TColumns, TColumnId>;
  }) => void;
  readonly setEditDraft: (value: unknown) => void;
  readonly setEditStatus: (
    status: "editing" | "validating" | "saving" | "error",
    error?: string,
  ) => void;
  readonly cancelEdit: () => void;
  readonly setColumnWidth: (
    columnId: ColumnIdOf<TColumns>,
    width: number,
  ) => void;
  readonly setColumnPinned: (
    columnId: ColumnIdOf<TColumns>,
    pinned: "left" | "right" | null,
  ) => void;
  readonly setColumnOrder: (columnIds: readonly ColumnIdOf<TColumns>[]) => void;
  readonly autosizeColumns: () => void;
  /** Reports a measured visible-row height to the indexed layout. */
  readonly measureRow: (
    ref: PretableVisibleRowRef<TRowId>,
    height: number,
  ) => void;
  readonly dispose: () => void;
  readonly setQuery: (
    query: PretableQueryFor<TColumns>,
  ) => PretableQueryTransition<TColumns> | void;
};

/** Immutable snapshot of indexed grid UI state. @public */
export interface PretableGridUiSnapshot<
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly viewport: Readonly<{
    readonly scrollTop: number;
    readonly scrollLeft: number;
    readonly height: number;
    readonly width: number;
  }>;
  readonly focus: Readonly<{
    readonly ref: PretableVisibleRowRef<TRowId> | null;
    readonly columnId: ColumnIdOf<TColumns> | null;
  }>;
  readonly selection: Readonly<{
    readonly rows:
      | {
          readonly kind: "explicit";
          readonly rowIds: ReadonlySet<TRowId>;
          readonly ranges?: PretableReactRowRangeIndex<TRowId>;
          readonly excludedRanges?: PretableReactRowRangeIndex<TRowId>;
        }
      | {
          readonly kind: "all";
          readonly excludedRanges?: PretableReactRowRangeIndex<TRowId>;
        };
    readonly ranges: readonly {
      readonly start: {
        readonly rowId: TRowId;
        readonly columnId: ColumnIdOf<TColumns>;
      };
      readonly end: {
        readonly rowId: TRowId;
        readonly columnId: ColumnIdOf<TColumns>;
      };
    }[];
    readonly anchor: {
      readonly rowId: TRowId;
      readonly columnId: ColumnIdOf<TColumns>;
    } | null;
  }>;
  readonly editing:
    | {
        readonly [TColumnId in ColumnIdOf<TColumns>]: {
          readonly rowId: TRowId;
          readonly columnId: TColumnId;
          readonly value: ColumnValueOf<TColumns, TColumnId>;
          readonly status: "editing" | "validating" | "saving" | "error";
          readonly error?: string;
        };
      }[ColumnIdOf<TColumns>]
    | null;
  readonly columnLayout: readonly Readonly<{
    readonly id: ColumnIdOf<TColumns>;
    readonly widthPx: number;
    readonly pinned?: "left" | "right";
  }>[];
  readonly observedRowModelRevision: number | null;
}

/** Atomic indexed DOM-render snapshot. @public */
export interface PretableIndexedRenderSnapshot<
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
  readonly rows: readonly (
    | {
        readonly kind: "data";
        readonly row: TRow;
        readonly id: string;
        readonly ref: PretableVisibleRowRef<TRowId>;
        readonly rowIndex: number;
        readonly top: number;
        readonly height: number;
      }
    | {
        readonly kind: "group";
        readonly group: PretableGroupRow<TColumns>;
        readonly id: string;
        readonly ref: PretableVisibleRowRef<TRowId>;
        readonly rowIndex: number;
        readonly top: number;
        readonly height: number;
      }
  )[];
  readonly columns: readonly {
    readonly index: number;
    readonly id: string;
    readonly left: number;
    readonly width: number;
    readonly pinned?: "left" | "right";
    readonly right?: number;
  }[];
  readonly rowMetrics: {
    readonly rowCount: number;
    getHeight(index: number): number;
    getOffsetForIndex(index: number): number;
    getIndexForOffset(offset: number): number;
    getTotalHeight(): number;
  };
  readonly nodeCount: number;
  readonly totalHeight: number;
  readonly totalWidth: number;
  readonly pinnedLeftWidth: number;
  readonly pinnedRightWidth: number;
}

export interface UseIndexedPretableOptions<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly columns:
    | readonly DomLayoutColumn<TRow>[]
    | ((query: PretableQueryFor<TColumns>) => readonly DomLayoutColumn<TRow>[]);
  readonly viewportHeight: number;
  readonly viewportWidth?: number;
  readonly overscan?: number;
  readonly onQueryChange?: (query: PretableQueryFor<TColumns>) => void;
  /** @internal Synthetic surface columns may exist outside the model schema. */
  readonly allowVisualExtras?: boolean;
}

function mergeRenderColumns<TRow extends object>(
  columns: readonly DomLayoutColumn<TRow>[],
  layout: readonly {
    readonly id: string;
    readonly widthPx: number;
    readonly pinned?: "left" | "right";
  }[],
  autoWidthIds: ReadonlySet<string>,
): readonly DomLayoutColumn<TRow>[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const hasSameIds =
    layout.length === columns.length &&
    layout.every((entry) => byId.has(entry.id));
  const effectiveLayout = hasSameIds
    ? layout
    : columns.map(
        (column) =>
          layout.find((entry) => entry.id === column.id) ?? {
            id: column.id,
            widthPx: column.widthPx ?? 160,
            ...(column.pinned === undefined ? {} : { pinned: column.pinned }),
          },
      );
  return effectiveLayout.map((entry) => {
    const presentation = byId.get(entry.id);
    if (presentation === undefined) {
      throw new TypeError(`Missing presentation column: ${entry.id}`);
    }
    return {
      ...presentation,
      widthPx: autoWidthIds.has(entry.id) ? undefined : entry.widthPx,
      pinned: entry.pinned,
    };
  });
}

function createAutoWidthStore<TRow extends object>(
  columns: readonly DomLayoutColumn<TRow>[],
) {
  let state: ReadonlySet<string> = new Set(
    columns
      .filter((column) => column.widthPx === undefined)
      .map((column) => column.id),
  );
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setAuto(columnId: string, auto: boolean) {
      if (state.has(columnId) === auto) return;
      const next = new Set(state);
      if (auto) next.add(columnId);
      else next.delete(columnId);
      state = next;
      for (const listener of Array.from(listeners)) listener();
    },
    dispose() {
      listeners.clear();
    },
  };
}

function createLatestValueChannel<T>(initialValue: T) {
  let currentValue = initialValue;
  return {
    get: () => currentValue,
    set: (nextValue: T) => {
      currentValue = nextValue;
    },
  };
}

/** Public result shared by both `usePretable` ownership modes. @public */
export interface PretableModel<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly grid: PretableReactGrid<TRow, TRowId, TColumns>;
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly gridSnapshot: PretableGridUiSnapshot<TRowId, TColumns>;
  readonly rowModelSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  readonly renderSnapshot: PretableIndexedRenderSnapshot<
    TRow,
    TRowId,
    TColumns
  >;
  readonly status: PretableRowModelStatus;
}

/** Internal indexed implementation shared by the public ownership overloads. */
export function usePretableModelInternal<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  options: UseIndexedPretableOptions<TRow, TRowId, TColumns>,
): PretableModel<TRow, TRowId, TColumns> {
  const columnSource = options.columns;
  const rowModel = options.rowModel;
  const onQueryChange = options.onQueryChange;
  const initialColumns =
    typeof columnSource === "function"
      ? columnSource(rowModel.getState().snapshot.query)
      : columnSource;
  const [queryChangeChannel] = useState(() =>
    createLatestValueChannel(onQueryChange),
  );
  const presentationColumnsRef = useRef(initialColumns);
  const schemaColumns = rowModel.getColumns() as readonly {
    readonly id: string;
  }[];
  const schemaIds = new Set(schemaColumns.map((column) => column.id));
  for (const column of initialColumns) schemaIds.delete(column.id);
  if (
    !options.allowVisualExtras &&
    (schemaIds.size !== 0 || initialColumns.length !== schemaColumns.length)
  ) {
    throw new TypeError(
      "Pretable presentation columns must match the row model schema exactly.",
    );
  }
  const stores = useMemo(() => {
    const internalModel = rowModel as unknown as InternalRowModel<
      TRow,
      TRowId,
      TColumns
    >;
    const gridCore = createGridUiCore<TRow, TRowId, TColumns>({
      rowModel: internalModel,
      columns: initialColumns as never,
      viewport: {
        scrollTop: 0,
        scrollLeft: 0,
        height: options.viewportHeight,
        width: options.viewportWidth ?? 0,
      },
    });
    const autoWidths = createAutoWidthStore(initialColumns);
    const initialRenderColumns = mergeRenderColumns(
      initialColumns,
      gridCore.getState().columnLayout,
      autoWidths.getState(),
    );
    const controller = createRowLayoutController<TRow, TRowId, TColumns>({
      model: internalModel,
      columns: initialRenderColumns,
      // Estimates for rows the DOM has not rendered yet. Same value the
      // surface floors measured rows at, so the two agree under every theme.
      defaultRowHeight: getThemeRowHeight(),
      // Measured off a rendered cell, so it is null until one exists — hence a
      // getter, resolved per estimate rather than captured here.
      getAverageCharWidthPx: () => getGridAverageCharWidth(),
      // Likewise read off a rendered cell, and likewise null until one exists.
      // The getter resolves one box per theme and returns that same object
      // thereafter, which is what makes the estimator's identity comparison of
      // it valid.
      getRowBoxMetrics: () => getGridRowBoxMetrics(),
      // Real per-token widths, so line breaks stop depending on how average a
      // string's characters happen to be. Null until a cell has rendered, and
      // on any host without a canvas, where the average width still answers.
      // One function per font, because the estimate memo compares it by
      // identity.
      getSegmentMeasurer: () => getGridSegmentMeasurer(),
      getLetterSpacingPx: () => getGridLetterSpacingPx(),
      // What a column's `render` draws BESIDE its text — the hero's stance
      // badge — which the raw cell value cannot express and which pushes the
      // text onto another line. Null until a cell has rendered with content in
      // it, and one map per set of measurements, because the estimate memo
      // compares it by identity.
      getRenderAdvances: () => getGridRenderAdvances(),
      deferActivation: true,
      eagerInitialRowLimit: 32,
      viewport: {
        scrollTop: 0,
        viewportHeight: options.viewportHeight,
        overscan: options.overscan ?? 6,
      },
    });
    return { autoWidths, gridCore, controller };
    // Stores are ownership-scoped to the model. Declarative visual inputs are
    // reconciled after commit without erasing UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowModel]);

  const grid = useMemo(() => {
    const setQuery = (query: PretableQueryFor<TColumns>) => {
      const currentLayout = stores.gridCore.getState().columnLayout;
      stores.gridCore.setColumnOrder(currentLayout.map((column) => column.id));
      const callback = queryChangeChannel.get();
      if (callback !== undefined) {
        callback(query);
        return;
      }
      const transition = rowModel.setQuery(query);
      void transition.finished.catch(() => undefined);
      return transition;
    };
    const facade = Object.create(stores.gridCore) as Record<string, unknown>;
    facade.rowModel = rowModel;
    facade.setQuery = setQuery;
    facade.autosizeColumns = () => {
      for (const column of presentationColumnsRef.current) {
        stores.autoWidths.setAuto(column.id, true);
      }
    };
    facade.measureRow = stores.controller.measure;
    facade.setColumnWidth = (columnId: ColumnIdOf<TColumns>, width: number) => {
      stores.gridCore.setColumnWidth(columnId, width);
      stores.autoWidths.setAuto(columnId, false);
    };
    return facade as PretableReactGrid<TRow, TRowId, TColumns>;
  }, [
    presentationColumnsRef,
    queryChangeChannel,
    rowModel,
    stores.autoWidths,
    stores.controller.measure,
    stores.gridCore,
  ]);

  const [pendingDisposals] = useState(() => new Set<typeof stores>());
  useEffect(() => {
    pendingDisposals.delete(stores);
    return () => {
      pendingDisposals.add(stores);
      queueMicrotask(() => {
        if (!pendingDisposals.delete(stores)) return;
        stores.controller.dispose();
        stores.gridCore.dispose();
        stores.autoWidths.dispose();
      });
    };
  }, [pendingDisposals, stores]);

  // Subscribe to the SNAPSHOT and to a coarse status — never to `getState()`.
  //
  // `setQuery`/`setDerivations` rebuild cooperatively, publishing a fresh state
  // object on every slice whose `status` carries `completedRows`/`totalRows`.
  // `snapshot` meanwhile keeps pointing at the current rows until the new ones
  // swap in. Reading `getState` here handed useSyncExternalStore a new identity
  // per slice, so the whole grid re-rendered on every progress tick against
  // rows that had not changed — and because each of those renders lands inside
  // the yield between slices, the rebuild pays for them.
  //
  // Measured on a 120-row grouping transition: the model alone settles in 7ms
  // over 10 scheduler hops; the same model under this component took 89 hops
  // and seconds, long enough that the bench's `group` script sampled an
  // ungrouped grid and reported zero group rows (#327).
  //
  // Progress is still published by the model — subscribe to it directly if you
  // want a progress bar. What this hook reports is which phase the model is in,
  // which is what a renderer can act on.
  const readSnapshot = useCallback(
    () => rowModel.getState().snapshot,
    [rowModel],
  );
  const coarseStatusRef = useRef<
    ReturnType<typeof rowModel.getState>["status"] | null
  >(null);
  const readStatus = useCallback(() => {
    const next = rowModel.getState().status;
    const previous = coarseStatusRef.current;
    if (
      previous !== null &&
      previous.kind === next.kind &&
      (previous as { transitionId?: number }).transitionId ===
        (next as { transitionId?: number }).transitionId
    ) {
      return previous;
    }
    coarseStatusRef.current = next;
    return next;
  }, [rowModel]);
  const rowModelSnapshotValue = useSyncExternalStore(
    rowModel.subscribe,
    readSnapshot,
    readSnapshot,
  );
  const rowModelStatusValue = useSyncExternalStore(
    rowModel.subscribe,
    readStatus,
    readStatus,
  );
  const rowModelState = useMemo(
    () => ({ snapshot: rowModelSnapshotValue, status: rowModelStatusValue }),
    [rowModelSnapshotValue, rowModelStatusValue],
  );
  const gridSnapshot = useSyncExternalStore(
    stores.gridCore.subscribe,
    stores.gridCore.getState,
    stores.gridCore.getState,
  );
  const renderControllerSnapshot = useSyncExternalStore(
    stores.controller.subscribe,
    stores.controller.getState,
    stores.controller.getState,
  );
  const autoWidthIds = useSyncExternalStore(
    stores.autoWidths.subscribe,
    stores.autoWidths.getState,
    stores.autoWidths.getState,
  );
  const observedQuery =
    renderControllerSnapshot.snapshot?.query ?? rowModelState.snapshot.query;
  const columns = useMemo(
    () =>
      typeof columnSource === "function"
        ? columnSource(observedQuery)
        : columnSource,
    [columnSource, observedQuery],
  );
  const observedSchemaIds = new Set(schemaColumns.map((column) => column.id));
  for (const column of columns) observedSchemaIds.delete(column.id);
  if (
    !options.allowVisualExtras &&
    (observedSchemaIds.size !== 0 || columns.length !== schemaColumns.length)
  ) {
    throw new TypeError(
      "Pretable presentation columns must match the row model schema exactly.",
    );
  }

  // Effect Events cannot back this public imperative method because callers
  // also invoke it outside Effects. An insertion effect publishes only the
  // committed render's callback before any descendant layout effect can act.
  useInsertionEffect(() => {
    presentationColumnsRef.current = columns;
    queryChangeChannel.set(onQueryChange);
  }, [columns, onQueryChange, queryChangeChannel]);

  const renderColumns = useMemo(
    () => mergeRenderColumns(columns, gridSnapshot.columnLayout, autoWidthIds),
    [autoWidthIds, columns, gridSnapshot.columnLayout],
  );

  useLayoutEffect(() => {
    const currentViewport = stores.gridCore.getState().viewport;
    stores.gridCore.setViewport({
      scrollTop: currentViewport.scrollTop,
      scrollLeft: currentViewport.scrollLeft,
      height: options.viewportHeight,
      width: options.viewportWidth ?? currentViewport.width,
    });
  }, [options.viewportHeight, options.viewportWidth, stores.gridCore]);

  const previousPresentationColumns = useRef(columns);
  useLayoutEffect(() => {
    const previous = new Map(
      previousPresentationColumns.current.map((column) => [column.id, column]),
    );
    const previousOrder = previousPresentationColumns.current.map(
      (column) => column.id,
    );
    const nextOrder = columns.map((column) => column.id);
    const sameIds =
      previousOrder.length === nextOrder.length &&
      previousOrder.every((id) => nextOrder.includes(id));
    if (!sameIds) {
      stores.gridCore.setColumns(columns as never);
    } else if (previousOrder.some((id, index) => id !== nextOrder[index])) {
      stores.gridCore.setColumnOrder(nextOrder as never);
    }
    for (const column of columns) {
      const prior = previous.get(column.id);
      if (prior === undefined || prior.widthPx !== column.widthPx) {
        stores.gridCore.setColumnWidth(
          column.id as never,
          column.widthPx ?? 160,
        );
        stores.autoWidths.setAuto(column.id, column.widthPx === undefined);
      }
      if (prior?.pinned !== column.pinned) {
        stores.gridCore.setColumnPinned(
          column.id as never,
          column.pinned ?? null,
        );
      }
    }
    previousPresentationColumns.current = columns;
  }, [columns, stores.autoWidths, stores.gridCore]);

  useLayoutEffect(() => {
    if (renderControllerSnapshot.status.kind === "disposed") return;
    stores.controller.setColumns(renderColumns);
    stores.controller.setViewport({
      scrollTop: gridSnapshot.viewport.scrollTop,
      viewportHeight: gridSnapshot.viewport.height,
      overscan: options.overscan ?? 6,
    });
  }, [
    gridSnapshot.viewport.height,
    gridSnapshot.viewport.scrollTop,
    options.overscan,
    renderColumns,
    renderControllerSnapshot.status.kind,
    stores.controller,
  ]);

  const observedRevision = renderControllerSnapshot.observedRevision;
  useLayoutEffect(() => {
    if (observedRevision !== null) {
      stores.gridCore.observeRowModelRevision(observedRevision);
    }
  }, [observedRevision, stores.gridCore]);

  const renderSnapshot = useMemo(
    () =>
      createDomRenderSnapshot<TRow, TRowId, TColumns>({
        controllerState: renderControllerSnapshot,
        columns: renderColumns,
        scrollLeft: gridSnapshot.viewport.scrollLeft,
        viewportWidth:
          options.viewportWidth === undefined &&
          gridSnapshot.viewport.width === 0
            ? undefined
            : gridSnapshot.viewport.width,
      }),
    [
      gridSnapshot.viewport.scrollLeft,
      gridSnapshot.viewport.width,
      options.viewportWidth,
      renderColumns,
      renderControllerSnapshot,
    ],
  );

  return {
    grid,
    rowModel,
    gridSnapshot: gridSnapshot as unknown as PretableGridUiSnapshot<
      TRowId,
      TColumns
    >,
    rowModelSnapshot: rowModelState.snapshot,
    renderSnapshot: renderSnapshot as PretableIndexedRenderSnapshot<
      TRow,
      TRowId,
      TColumns
    >,
    status: rowModelState.status,
  };
}
