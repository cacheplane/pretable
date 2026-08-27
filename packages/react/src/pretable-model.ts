import {
  createDomRenderSnapshot,
  createRowLayoutController,
  type DomLayoutColumn,
} from "@pretable-internal/renderer-dom";
import {
  ɵcreateGridUiCore as createGridUiCore,
  type PretableGridUiState,
} from "@pretable/core";
import type {
  PretableQueryFor,
  PretableQueryTransition,
  ColumnIdOf,
  ColumnValueOf,
  PretableGroupRow,
  PretableIndexedCellSelectionSummary,
  PretableIndexedFocusMovement,
  PretableIndexedMoveFocusOptions,
  PretableOpenEditStatus,
  PretableRowId,
  PretableRowModel,
  PretableRowModelSnapshot,
  PretableRowModelStatus,
  PretableRowSelectionState,
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

/**
 * Framework-independent indexed grid actions exposed by `usePretable`.
 *
 * `TColumns` is the row model's SCHEMA — the only thing that says what type
 * the value in a given column has, so `beginEdit` is written against it.
 * `TColumnId` is the vocabulary of columns actually DRAWN, which a
 * presentation layer may extend past the schema (`<PretableSurface>` draws a
 * grouped-row column and a row-checkbox column). It defaults to the schema's
 * own ids, which is exact for every grid without presentation extras. See
 * {@link PretableGridUiState} in `@pretable/core`.
 *
 * @public
 */
export type PretableReactGrid<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string = ColumnIdOf<TColumns>,
> = {
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly getState: () => PretableGridUiSnapshot<TRowId, TColumns, TColumnId>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setViewport: (viewport: {
    readonly scrollTop: number;
    readonly scrollLeft: number;
    readonly height: number;
    readonly width: number;
  }) => void;
  readonly setFocus: (
    focus: PretableGridUiSnapshot<TRowId, TColumns, TColumnId>["focus"],
  ) => void;
  /**
   * The movement union and the options are IMPORTED, never respelled here. A
   * hand-copied union went two members stale when `first-column` /
   * `last-column` were added and broke the build; the fix at the time was a
   * cast at the call site, which is the same trade one step further away.
   */
  readonly moveFocus: (
    movement: PretableIndexedFocusMovement,
    options?: PretableIndexedMoveFocusOptions,
  ) => void;
  readonly setSelection: (
    selection: PretableGridUiSnapshot<TRowId, TColumns, TColumnId>["selection"],
  ) => void;
  /**
   * Replace the row-checkbox slice without touching the cell ranges — the
   * imperative twin of `state.rowSelection`, for consumers driving the grid
   * from a handle rather than from props.
   */
  readonly setRowSelection: (rows: PretableRowSelectionState<TRowId>) => void;
  readonly toggleRowSelection: (rowId: TRowId) => void;
  readonly selectRowRange: (startRowId: TRowId, endRowId: TRowId) => void;
  readonly isRowSelected: (rowId: TRowId) => boolean;
  readonly getSelectionSummary: () => Readonly<{
    readonly state: "none" | "some" | "all";
    readonly selectedCount: number;
    readonly visibleCount: number;
  }>;
  /**
   * How many data rows `selection.ranges` covers, and whether that number is
   * proven — counted by arithmetic over dataset spans, so it survives its
   * rows being evicted. Distinct from {@link getSelectionSummary}, which
   * counts the sparse row-selection program the checkbox column drives.
   *
   * Declared here, not merely inherited: the runtime object delegates to the
   * grid core through its prototype, so leaving it off this type would make
   * `verified` reachable only behind a cast, absent from autocomplete, and
   * absent from `react.api.md` — which would leave the exported
   * `PretableIndexedCellSelectionSummary` with no react-level producer at
   * all.
   */
  readonly getCellSelectionSummary: () => PretableIndexedCellSelectionSummary;
  readonly selectAllVisibleRows: () => void;
  readonly clearSelection: () => void;
  /**
   * `TEditColumnId` ranges over the SCHEMA ids, not the drawn ones — an edit
   * carries a value, and only the schema says what type a column's value has.
   */
  readonly beginEdit: <TEditColumnId extends ColumnIdOf<TColumns>>(input: {
    readonly rowId: TRowId;
    readonly columnId: TEditColumnId;
    readonly value: ColumnValueOf<TColumns, TEditColumnId>;
    readonly status?: "checking" | "editing";
  }) => void;
  readonly setEditDraft: (value: unknown) => void;
  readonly setEditStatus: (
    status: PretableOpenEditStatus,
    error?: string,
  ) => void;
  readonly cancelEdit: () => void;
  readonly setColumnWidth: (columnId: TColumnId, width: number) => void;
  readonly setColumnPinned: (
    columnId: TColumnId,
    pinned: "left" | "right" | null,
  ) => void;
  /**
   * Show or hide a layout column. Declared here for the same reason
   * {@link getCellSelectionSummary} is: the runtime object reaches it through
   * the grid core's prototype, so leaving it off this type would strand a
   * runtime-reachable method behind a cast and keep it out of `react.api.md`.
   */
  readonly setColumnVisible: (columnId: TColumnId, visible: boolean) => void;
  readonly setColumnOrder: (columnIds: readonly TColumnId[]) => void;
  /**
   * Write the engine's `hideGroupedColumns`. Declared here for the same reason
   * {@link setColumnVisible} is: the runtime object reaches it through the grid
   * core's prototype, so leaving it off this type would strand a
   * runtime-reachable method behind a cast and keep it out of `react.api.md`.
   *
   * `<PretableSurface>`'s prop of the same name SEEDS this at mount, and the
   * surface's drawn column set follows the engine value from then on — but the
   * prop keeps writing in both directions: a consumer who CHANGES the prop
   * after mount has that change written back onto the engine, clobbering a
   * write made here. A pane driving this state on a grid whose consumer also
   * passes the prop is in a two-writer situation; only a consumer who leaves
   * the prop alone after mount cedes ownership.
   */
  readonly setHideGroupedColumns: (value: boolean) => void;
  /**
   * Override the aggregate a column's prop declared, or clear the override by
   * passing `undefined`. Ids are the DRAWN vocabulary (`TColumnId`), matching
   * the rest of this handle; `usePretable` drops any that no derivation
   * carries — a synthetic presentation column, say — before handing the rest
   * to the row model, which keys by the schema. Declared here for the
   * {@link setColumnVisible} reason.
   *
   * ROWS MODE ONLY. In explicit-model mode the caller owns their row model and
   * this hook never re-requests its derivations, so the write is recorded in
   * engine state and has no effect on what a group row shows. State an
   * aggregate on the model's own columns instead.
   *
   * AN INVALID AGGREGATE DESTROYS THE GRID, not just the write. It is reported
   * the way a bad declared `aggregate` is — `CompiledQueryValidationError`,
   * raised where the merged derivations are compiled — but that happens inside
   * the React commit this write schedules, so it is a render-time throw, and
   * the outcome depends on who is rendering (all three measured):
   *
   * - `<PretableSurface>` with no error boundary: the error propagates out of
   *   this call AND React unmounts the whole tree. The container is left
   *   empty.
   * - `<PretableSurface>` under an error boundary: the boundary swallows the
   *   error, so this call returns normally, but the grid subtree is gone —
   *   zero rows. Clearing the override afterwards restores NOTHING; only a
   *   remount brings the grid back, and a remount discards the override rather
   *   than clearing it.
   * - `usePretable` on its own: the error propagates out of this call and the
   *   hook survives. Clearing the override succeeds and `columnAggregates`
   *   returns to `{}`.
   *
   * So a UI offering free-form aggregates MUST validate before calling this;
   * there is no recovery path at the surface. grid-core cannot validate for
   * you: it deliberately stores an aggregate without interpreting one.
   */
  readonly setColumnAggregate: (
    columnId: TColumnId,
    aggregate: unknown,
  ) => void;
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

/**
 * Immutable snapshot of indexed grid UI state — the engine's own
 * {@link PretableGridUiState}, named for react consumers.
 *
 * An ALIAS, not a copy. This was a 74-line hand-written mirror that spelled out
 * `PretableViewportState`, `PretableIndexedFocusState`,
 * `PretableIndexedRowSelection`, `PretableIndexedCellRange`,
 * `PretableIndexedCellAddress`, `PretableIndexedEditingState` and
 * `PretableGridUiColumnLayout` inline — every one of them already re-exported
 * by this package — and it published two more names,
 * `PretableReactRowRange(Index)`, for types the engine already called
 * `PretableIndexedRowRange(Index)`. It was structurally identical to
 * `PretableGridUiState` field for field, so it bought nothing and could drift
 * in either direction the moment the engine gained a field.
 *
 * See {@link PretableReactGrid} for why the schema column tuple (`TColumns`)
 * and the drawn column-id vocabulary (`TColumnId`) are separate parameters:
 * `columnLayout`, `focus.columnId` and the selection endpoints all address
 * DRAWN columns, while `editing` addresses a schema one. `focus.ref` may be
 * `{kind: "header"}` — a real value, since the cursor sits on a column header
 * whenever the user has arrowed up off the first row.
 *
 * @public
 */
export type PretableGridUiSnapshot<
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string = ColumnIdOf<TColumns>,
> = PretableGridUiState<TRowId, TColumns, TColumnId>;

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
  /**
   * LOCAL to the loaded window: offsets in and out of this reader are measured
   * from the first loaded row, while `rows[].top`, `totalHeight` and the
   * scroller's `scrollTop` are all measured from the top of the dataset. They
   * differ by {@link PretableIndexedRenderSnapshot.leadingHeight}.
   */
  readonly rowMetrics: {
    readonly rowCount: number;
    getHeight(index: number): number;
    getOffsetForIndex(index: number): number;
    getIndexForOffset(offset: number): number;
    getTotalHeight(): number;
  };
  readonly nodeCount: number;
  readonly totalHeight: number;
  /**
   * The leading spacer's height: the distance between `rowMetrics`' local
   * origin and the global one everything else here uses. `0` on every
   * non-windowed grid.
   */
  readonly leadingHeight: number;
  readonly totalWidth: number;
  readonly pinnedLeftWidth: number;
  readonly pinnedRightWidth: number;
}

export interface UseIndexedPretableOptions<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string = ColumnIdOf<TColumns>,
> {
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  /**
   * The columns to DRAW, whose ids fix `TColumnId`. Not required to be the
   * schema's own columns — see `allowVisualExtras` — which is exactly why
   * their id type is a parameter of its own rather than `ColumnIdOf<TColumns>`.
   */
  readonly columns:
    | readonly DomLayoutColumn<TRow, TColumnId>[]
    | ((
        query: PretableQueryFor<TColumns>,
      ) => readonly DomLayoutColumn<TRow, TColumnId>[]);
  readonly viewportHeight: number;
  readonly viewportWidth?: number;
  readonly overscan?: number;
  readonly onQueryChange?: (query: PretableQueryFor<TColumns>) => void;
  /** @internal Synthetic surface columns may exist outside the model schema. */
  readonly allowVisualExtras?: boolean;
  /**
   * @internal SEED for the engine's `hideGroupedColumns` — read once, when the
   * grid core is created, and never again: the engine owns the value after
   * that (`setHideGroupedColumns` is the write path). Omitted leaves the key
   * ABSENT rather than `false`, which is how a consumer distinguishes "unset"
   * from "explicitly off"; the default that turns absence into "hide" lives in
   * the surface, above this layer.
   */
  readonly hideGroupedColumns?: boolean;
  /**
   * @internal Whether the caller supplies `query` (controlled) or merely
   * observes it via `onQueryChange` (notify-only/uncontrolled). Controls
   * whether `setQuery` applies the transition to the row model itself:
   *
   * - Controlled (`true`): the consumer owns `query` and will supply the next
   *   state, so `setQuery` must report intent via `onQueryChange` and stop —
   *   applying it here too would race the consumer's own re-render.
   * - Uncontrolled (`false`/omitted): the engine owns `query` whether or not
   *   anyone is listening, so `setQuery` must apply the transition itself,
   *   reporting to `onQueryChange` first when present.
   */
  readonly queryControlled?: boolean;
}

function mergeRenderColumns<TRow extends object>(
  columns: readonly DomLayoutColumn<TRow>[],
  layout: readonly {
    readonly id: string;
    readonly widthPx: number;
    readonly pinned?: "left" | "right";
    readonly hidden?: boolean;
  }[],
  autoWidthIds: ReadonlySet<string>,
): readonly DomLayoutColumn<TRow>[] {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const hasSameIds =
    layout.length === columns.length &&
    layout.every((entry) => byId.has(entry.id));
  const effectiveLayout = (
    hasSameIds
      ? layout
      : columns.map(
          (column) =>
            layout.find((entry) => entry.id === column.id) ?? {
              id: column.id,
              widthPx: column.widthPx ?? 160,
              ...(column.pinned === undefined ? {} : { pinned: column.pinned }),
            },
        )
  )
    // DRAWN columns only: this feeds the row-layout controller and, through
    // it, every rendered header and body cell. A hidden column stays in the
    // engine layout (width and pin persist) but must not paint or contribute
    // to row-height estimation. Present only when `true`, so truthiness, not
    // a comparison against `false`.
    .filter((entry) => (entry as { hidden?: boolean }).hidden !== true);
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

/**
 * Public result shared by both `usePretable` ownership modes.
 *
 * See {@link PretableReactGrid} for the `TColumns` (schema) versus
 * `TColumnId` (drawn) distinction.
 *
 * @public
 */
export interface PretableModel<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string = ColumnIdOf<TColumns>,
> {
  readonly grid: PretableReactGrid<TRow, TRowId, TColumns, TColumnId>;
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly gridSnapshot: PretableGridUiSnapshot<TRowId, TColumns, TColumnId>;
  readonly rowModelSnapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  readonly renderSnapshot: PretableIndexedRenderSnapshot<
    TRow,
    TRowId,
    TColumns
  >;
  readonly status: PretableRowModelStatus;
}

/**
 * Row counts for the unloaded population before/after the loaded window —
 * see {@link CreateRowLayoutControllerOptions.getWindowSpacers} in
 * `@pretable-internal/renderer-dom`, which this shape mirrors.
 *
 * @internal Not part of {@link PretableModel}'s public surface. It is a
 * private bridge from `PretableSurface` (which has `resultMeta` and the
 * honesty gate that governs whether a window may be trusted) to the row
 * layout controller (built once per row model, before any per-render prop
 * exists to construct it from) — pushed in via a mutable channel (see
 * {@link createLatestValueChannel}) rather than threaded through
 * `usePretable`'s options because the drop-in's public options intentionally
 * say nothing about rendering internals. A channel, not a `useRef`: the
 * react-hooks `refs` rule forbids any value reachable from a `useRef` —
 * even indirectly, through a wrapping getter — from flowing into a function
 * called during render, and `createRowLayoutController` below is exactly
 * that call.
 */
export interface WindowSpacers {
  readonly leadingRows?: number;
  readonly trailingRows?: number;
  /**
   * `resultMeta.datasetKey`, carried on the same honesty-gated push as the
   * row counts rather than on a second channel — a dataset position and the
   * population it was measured in must never be able to disagree. The row
   * layout controller ignores it; only `getWindowing` below reads it, to
   * invalidate selection spans when the QUERY changes.
   */
  readonly datasetKey?: string;
  /**
   * `resultMeta.total.count` — exact by the time this object exists, because
   * the gate that builds it does not pass otherwise. The row layout
   * controller ignores it too; `getWindowing` reads it to invalidate
   * selection spans when the POPULATION changes, which `datasetKey` does not
   * report and is not meant to. See
   * `PretableIndexedDatasetRowSpan.datasetTotal`.
   */
  readonly datasetTotal?: number;
}

/**
 * The window channel's value: what this render knows about the loaded window.
 *
 * Two facts, pushed together because separating them is what caused a
 * windowed grid to be mistaken for a local one. `spacers` is honesty-gated
 * and null whenever the gate does not pass; `windowed` says only whether the
 * consumer publishes `resultMeta.window` at all, which no gate can change.
 * A grid that is windowed with null `spacers` has an UNKNOWN window this
 * render — not an absent one — and the engine must not read absence as
 * deletion there. See {@link PretableIndexedEvictionContext.windowed}.
 *
 * @internal
 */
export interface WindowState {
  readonly spacers: WindowSpacers | null;
  readonly windowed: boolean;
}

/** Internal indexed implementation shared by the public ownership overloads. */
export function usePretableModelInternal<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string = ColumnIdOf<TColumns>,
>(
  options: UseIndexedPretableOptions<TRow, TRowId, TColumns, TColumnId>,
): PretableModel<TRow, TRowId, TColumns, TColumnId> & {
  /** @internal See {@link WindowState}. */
  readonly setWindowState: (next: WindowState) => void;
} {
  const columnSource = options.columns;
  const rowModel = options.rowModel;
  const onQueryChange = options.onQueryChange;
  const queryControlled = options.queryControlled ?? false;
  const initialColumns =
    typeof columnSource === "function"
      ? columnSource(rowModel.getState().snapshot.query)
      : columnSource;
  const [queryChangeChannel] = useState(() =>
    createLatestValueChannel(onQueryChange),
  );
  const [queryControlledChannel] = useState(() =>
    createLatestValueChannel(queryControlled),
  );
  const presentationColumnsRef = useRef(initialColumns);
  // Read by `getWindowSpacers` below — resolved lazily per plan rather than
  // captured once, because the window changes on a timescale of its own
  // (see `WindowSpacers`). A plain mutable channel rather than `useRef`: the
  // row layout controller is constructed inside the `useMemo` below, which
  // runs during render, and the react-hooks `refs` rule forbids passing
  // anything reachable from a `useRef` into a function called there — even a
  // getter that only reads `.current` when invoked later. Same reasoning as
  // `queryChangeChannel` just above using `createLatestValueChannel` instead
  // of a ref. `setWindowState` and `getWindowSpacers` both have stable
  // identity, so a caller never has to list either as a changing dependency.
  const [windowSpacersChannel] = useState(() =>
    createLatestValueChannel<WindowState>({ spacers: null, windowed: false }),
  );
  const setWindowState = useCallback(
    (next: WindowState) => windowSpacersChannel.set(next),
    [windowSpacersChannel],
  );
  const getWindowSpacers = useCallback(
    () => windowSpacersChannel.get().spacers,
    [windowSpacersChannel],
  );
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
    const gridCore = createGridUiCore<TRow, TRowId, TColumns, TColumnId>({
      rowModel,
      columns: initialColumns,
      // Spread-or-omit, not `?? false`: grid-core keeps the key ABSENT when
      // the option is absent, and that distinction is the whole reason the
      // option is optional. This `useMemo` runs once per row model, so this
      // really is a mount-time seed.
      ...(options.hideGroupedColumns === undefined
        ? {}
        : { hideGroupedColumns: options.hideGroupedColumns }),
      viewport: {
        scrollTop: 0,
        scrollLeft: 0,
        height: options.viewportHeight,
        width: options.viewportWidth ?? 0,
      },
      // Adapts the window channel (see `WindowState` above) to the
      // dataset-index span `reconcileIndexedSelection` needs to tell an
      // evicted row from a deleted one — the SAME honesty-gated channel the
      // row layout controller reads, not a second one. `leadingRows` is
      // already the window's absolute start under that gate;
      // `sourceRowCount` is the loaded length, read fresh because eviction
      // can change it independently of a `windowSpacers` push. So `start`
      // and `length` below can come from two different instants: `start` as
      // of the last committed render's `useInsertionEffect`, `length` as of
      // right now. That is safe only under two conditions, both structural
      // rather than incidental: `start` cannot move without a render that
      // also carries the matching `rows` (insertion effects run before the
      // layout effects that call `setRows` and `observeRowModelRevision`,
      // so a stale `start` is never paired with rows from a newer window);
      // and a stale-LARGER `length` is the safe direction only while
      // `start` is unchanged — it just over-covers the still-correct span.
      // If a consumer ever lands rows in a commit whose
      // `resultMeta.window.start` has not caught up, this pairing is a
      // chimera and a genuinely evicted row can be judged deleted.
      getWindowing: () => {
        // ONE read of the channel. `windowed` and `spacers` describing
        // different instants is precisely the confusion this shape exists to
        // prevent.
        const { spacers, windowed } = windowSpacersChannel.get();
        if (!windowed) return null;
        if (
          spacers?.leadingRows === undefined ||
          spacers.datasetTotal === undefined
        ) {
          // Windowed, but this revision's window cannot be trusted. NOT the
          // same as local mode: the engine must hold what it has rather than
          // conclude that every unloaded row was deleted.
          return { window: null };
        }
        return {
          window: {
            start: spacers.leadingRows,
            length: rowModel.getState().snapshot.sourceRowCount,
            datasetTotal: spacers.datasetTotal,
            ...(spacers.datasetKey === undefined
              ? {}
              : { datasetKey: spacers.datasetKey }),
          },
        };
      },
    });
    const autoWidths = createAutoWidthStore(initialColumns);
    const initialRenderColumns = mergeRenderColumns(
      initialColumns,
      gridCore.getState().columnLayout,
      autoWidths.getState(),
    );
    const controller = createRowLayoutController<TRow, TRowId, TColumns>({
      model: rowModel,
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
      // Late-bound for the same reason as the metrics getters above: resolved
      // fresh per plan, since the channel it reads is written by a surface
      // that renders after this controller is constructed and can update the
      // window without this row model ever changing.
      getWindowSpacers,
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
      // ALL columns, hidden included: `setColumnOrder` demands the full
      // layout roster, and this is a no-op replay of it, not a reorder.
      const currentLayout = stores.gridCore.getState().columnLayout;
      stores.gridCore.setColumnOrder(currentLayout.map((column) => column.id));
      const callback = queryChangeChannel.get();
      callback?.(query);
      // Controlled: the consumer owns `query` and will supply the next state,
      // so the engine must NOT also apply it — that would race the
      // consumer's own re-render. Uncontrolled-but-observed (notify-only):
      // the engine owns `query` regardless of whether anyone is listening,
      // so it reports AND applies.
      if (queryControlledChannel.get()) return;
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
    facade.setColumnWidth = (columnId: TColumnId, width: number) => {
      stores.gridCore.setColumnWidth(columnId, width);
      stores.autoWidths.setAuto(columnId, false);
    };
    return facade as PretableReactGrid<TRow, TRowId, TColumns, TColumnId>;
  }, [
    presentationColumnsRef,
    queryChangeChannel,
    queryControlledChannel,
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
    queryControlledChannel.set(queryControlled);
  }, [
    columns,
    onQueryChange,
    queryChangeChannel,
    queryControlled,
    queryControlledChannel,
  ]);

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
      stores.gridCore.setColumns(columns);
    } else if (previousOrder.some((id, index) => id !== nextOrder[index])) {
      // ALL columns: visibility is engine state, not a prop, so the prop
      // roster names every layout column — hidden ones included — which is
      // exactly what `setColumnOrder` demands.
      stores.gridCore.setColumnOrder(nextOrder);
    }
    for (const column of columns) {
      const prior = previous.get(column.id);
      if (prior === undefined || prior.widthPx !== column.widthPx) {
        stores.gridCore.setColumnWidth(column.id, column.widthPx ?? 160);
        stores.autoWidths.setAuto(column.id, column.widthPx === undefined);
      }
      if (prior?.pinned !== column.pinned) {
        stores.gridCore.setColumnPinned(column.id, column.pinned ?? null);
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
    gridSnapshot,
    rowModelSnapshot: rowModelState.snapshot,
    renderSnapshot,
    status: rowModelState.status,
    setWindowState,
  };
}
