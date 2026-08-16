import type {
  ColumnIdOf,
  ColumnValueOf,
  PretableFormatInput,
  PretableRowId as IndexedPretableRowId,
  PretableRowModel,
  PretableRowModelSnapshot,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

/**
 * Base row constraint. Concrete row shapes remain fully generic.
 *
 * @public
 */
export type PretableRow = object;

/**
 * Sort direction — `null` means unsorted.
 *
 * @public
 */
export type PretableSortDirection = "asc" | "desc" | null;

/**
 * Phase of an in-progress cell edit.
 *
 * @public
 */
export type PretableEditStatus =
  "checking" | "editing" | "validating" | "saving" | "error";

/**
 * Input passed to a column's edit hooks (`editable`, `validate`, `parseEditValue`,
 * `formatEditValue`).
 *
 * @public
 */
export interface PretableEditInput<TRow extends PretableRow = PretableRow> {
  rowId: string;
  columnId: string;
  row: TRow;
  column: PretableColumn<TRow>;
  value: unknown;
}

/**
 * In-progress cell edit observed through the UI grid state.
 * `error` carries the validation message (status `"editing"`) or the commit
 * failure message (status `"error"`).
 *
 * @public
 */
export interface PretableEditState {
  rowId: string;
  columnId: string;
  draft: unknown;
  status: PretableEditStatus;
  error?: string;
}

/** @public */
export type ColumnType = "text" | "number" | "date" | "enum" | "boolean";

/** @public */
export type ColumnAlign = "start" | "center" | "end";

/** @public */
export type FilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "endsWith"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "isAnyOf"
  | "isNoneOf"
  | "on"
  | "before"
  | "after"
  | "dateBetween"
  | "isEmpty"
  | "isNotEmpty";

/** @public */
export type FilterValue =
  | string
  | number
  | readonly [number, number]
  | readonly [string, string]
  | readonly string[]
  | null;

/** @public — one column's active filter. `value` is omitted for isEmpty/isNotEmpty. */
export interface ColumnFilter {
  operator: FilterOperator;
  value?: FilterValue;
}

/** @public */
export interface ColumnOption {
  value: string;
  label?: string;
}

/**
 * Engine-level column definition. `@pretable/react` extends this with React-specific render fields.
 *
 * @public
 */
export interface PretableColumn<TRow extends PretableRow = PretableRow> {
  id: string;
  header?: string;
  wrap?: boolean;
  widthPx?: number;
  pinned?: "left" | "right";
  sortable?: boolean;
  /** Number-editor increment for ArrowUp/Down and steppers. Default 1. */
  step?: number;
  filterable?: boolean;
  /** Restrict the filter menu to operators the current processor can honor. */
  filterOperators?: FilterOperator[];
  type?: ColumnType;
  /** Horizontal alignment. Number columns default to `"end"`. */
  align?: ColumnAlign;
  options?: ColumnOption[];
  value?: (row: TRow) => unknown;
  format?: (
    input: PretableFormatInput<TRow, unknown, PretableColumn<TRow>>,
  ) => string;
  /** Native number presentation; derivation and editing continue to use raw values. */
  numberFormat?: Intl.NumberFormatOptions;
  /**
   * Render this column's aggregate on a group row.
   *
   * Deliberately not `format`: the plain-cell formatter's `row` is non-optional, so
   * every consumer formatter is entitled to dereference it, and a group row has
   * no row. Columns without `formatAggregate` fall back to the same default
   * stringification a plain cell uses.
   */
  formatAggregate?: (input: {
    value: unknown;
    column: PretableColumn<TRow>;
    group: {
      readonly id: string;
      readonly groupId: string;
      readonly depth: number;
      readonly columnId: string;
      readonly value: unknown;
      readonly childCount: number;
      readonly aggregates: Readonly<Record<string, unknown>>;
      readonly expanded: boolean;
    };
    /** Whether the aggregate covers the full result or only loaded rows. */
    scope: "all" | "loaded";
  }) => string;
  // new in sub-project C:
  minWidthPx?: number;
  maxWidthPx?: number;
  /**
   * Share of the width the fixed columns leave over, so the row ends exactly at
   * the viewport edge instead of underfilling or overflowing it. Weights are
   * relative: two columns at `flex: 1` split the remainder evenly, `1` and `3`
   * split it a quarter to three quarters. `minWidthPx`/`maxWidthPx` still
   * apply, and a column that has been resized (which sets `widthPx`) stops
   * flexing — an explicit width outranks a computed one.
   */
  flex?: number;
  resizable?: boolean;
  reorderable?: boolean;
  /** Aggregate shown for this column on group rows. */
  aggregate?: unknown;
  // cell editing (v1):
  editable?:
    boolean | ((input: PretableEditInput<TRow>) => boolean | Promise<boolean>);
  validate?: (
    value: unknown,
    input: PretableEditInput<TRow>,
  ) => (true | string) | Promise<true | string>;
  parseEditValue?: (raw: string, input: PretableEditInput<TRow>) => unknown;
  formatEditValue?: (value: unknown, input: PretableEditInput<TRow>) => string;
}

/** Who applies a query slice to the loaded rows. @public */
export type PretableProcessingAuthority = "engine" | "external";

/** Per-slice processing authority for remotely fulfilled queries. @public */
export interface PretableProcessingOptions {
  filter?: PretableProcessingAuthority;
  sort?: PretableProcessingAuthority;
}

/** Population size represented by a loaded result window. @public */
export type PretableMatchingTotal =
  | { kind: "exact"; count: number }
  | { kind: "estimate"; count: number }
  | { kind: "unknown"; atLeast?: number };

/** Metadata accompanying a remotely fulfilled result window. @public */
export interface PretableResultMeta {
  total?: PretableMatchingTotal;
  /** Stable identity for the query/result population represented by the rows. */
  datasetKey?: string;
  /**
   * Where the loaded rows sit inside the population, when they are a window
   * rather than a prefix. Absent means the classic prefix case.
   *
   * `hasMore` rather than a remaining count: a keyset cursor walks forward, so
   * the extent must promise only what is fetchable. A count would invite a
   * scrollbar that reaches rows the cursor cannot serve.
   */
  window?: {
    /** Dataset index of `rows[0]`. */
    readonly start: number;
    /** Whether anything follows this window. NOT how much. */
    readonly hasMore: boolean;
  };
}

/**
 * One entry in the ordered sort list; index in the list = priority.
 *
 * @public
 */
export interface PretableSortEntry {
  columnId: string;
  direction: "asc" | "desc";
}

/**
 * Cell address — the (rowId, columnId) pair that uniquely identifies a cell.
 *
 * @public
 */
export interface PretableCellAddress {
  rowId: string;
  columnId: string;
}

/**
 * Inclusive cell range — both bounds (start and end) are inside the selection.
 *
 * @public
 */
export interface PretableCellRange {
  startRowId: string;
  endRowId: string;
  startColumnId: string;
  endColumnId: string;
  /**
   * Dataset positions of this range's endpoints, when the grid is serving a
   * window under the honesty gate — see
   * {@link PretableIndexedDatasetRowSpan}. Present on every range the grid
   * emits through `onSelectionChange`, and accepted back through the
   * controlled `state.selection` prop so a selection that is persisted and
   * restored stays countable while its rows are evicted. Omitting it on the
   * way back in is safe: the engine recovers the positions by row id from
   * the selection it is replacing.
   */
  datasetRowSpan?: PretableIndexedDatasetRowSpan;
}

/**
 * Cell-range selection state including the optional anchor for shift-extension.
 *
 * @public
 */
export interface PretableSelectionState {
  ranges: PretableCellRange[];
  anchor: PretableCellAddress | null;
}

/**
 * Currently focused cell — both fields are null when nothing is focused.
 *
 * @public
 */
export interface PretableFocusState {
  rowId: string | null;
  columnId: string | null;
}

/**
 * Viewport-level scroll + size state.
 *
 * @public
 */
export interface PretableViewportState {
  scrollTop: number;
  scrollLeft: number;
  height: number;
  width: number;
}

/**
 * Direction passed to the UI grid's focus movement action.
 *
 * @public
 */
export type PretableFocusDirection = "up" | "down" | "left" | "right";

/**
 * Optional behavior modifiers for UI-grid focus movement.
 *
 * @public
 */
export interface PretableMoveFocusOptions {
  extend?: boolean;
  jumpToEdge?: boolean;
  byPage?: boolean;
}

/** A typed data-cell address owned by the indexed UI layer. @public */
export interface PretableIndexedCellAddress<
  TRowId extends IndexedPretableRowId,
  TColumnId extends string,
> {
  readonly rowId: TRowId;
  readonly columnId: TColumnId;
}

/**
 * Where a cell range's two endpoints sit in the DATASET — the coordinate
 * system `PretableIndexedSelectionWindow` is expressed in, not snapshot
 * indices, which shift under the loaded window every time it moves.
 *
 * Under the honesty gate this is the range's IDENTITY, not an annotation on
 * it: a range named by row ids stops meaning anything once those rows are
 * evicted, because an id cannot be resolved to a position without the row.
 * A dataset position survives the row. So `end - start + 1` stays answerable
 * with nothing loaded, and so does "is this rendered row inside it?".
 *
 * `start`/`end` mirror the range's own `start`/`end` endpoints and are NOT
 * normalized — `start` may exceed `end` for a range dragged upwards. Count
 * and containment order them; keeping the orientation is what lets a range
 * with one evicted endpoint resolve the survivor live and the absentee from
 * memory, instead of guessing which remembered bound belongs to which.
 *
 * @public
 */
export interface PretableIndexedDatasetRowSpan {
  /** Dataset position of the range's `start` endpoint. */
  readonly start: number;
  /** Dataset position of the range's `end` endpoint. */
  readonly end: number;
  /**
   * The population these positions were measured in — `resultMeta.datasetKey`
   * as of the measurement. A re-sort or a filter change re-fills the same
   * dataset positions with different rows, so a span carrying a different key
   * than the window currently reports is not stale-but-usable, it is about a
   * different table. Count and containment both refuse it rather than
   * answering from it: `indexedRangeContainsCell` returns a bare boolean and
   * has no `verified` channel to downgrade through, and a wrong `true` there
   * paints the wrong rows.
   *
   * **This is load-bearing, and it fails CLOSED.** An absent key is not a
   * match — it is the absence of any evidence about the population, which
   * leaves the engine unable to tell a scroll from a re-sort, so it refuses.
   * A grid that publishes `resultMeta.window` but no `resultMeta.datasetKey`
   * therefore gets no span at all: its selections degrade to the loaded
   * window, visibly, in `rowCount` and `verified`. `@pretable/react` warns
   * once when it sees that combination.
   *
   * Local mode is a different case and is genuinely unaffected: with no
   * window there are no dataset positions to record, so there is nothing a
   * key could qualify.
   */
  readonly datasetKey?: string;
}

/** Inclusive data-cell range; group rows can never be endpoints. @public */
export interface PretableIndexedCellRange<
  TRowId extends IndexedPretableRowId,
  TColumnId extends string,
> {
  readonly start: PretableIndexedCellAddress<TRowId, TColumnId>;
  readonly end: PretableIndexedCellAddress<TRowId, TColumnId>;
  /**
   * Where `start` and `end` sit in the dataset. Absent in local mode and
   * outside the honesty gate, where dataset positions are meaningless and
   * every endpoint is loaded anyway.
   *
   * Derived by the engine on every write — `setSelection` fills it in from
   * the loaded snapshot, and from the positions the selection being replaced
   * already remembers, so a gesture extending from an EVICTED anchor still
   * produces a countable range. Reconciliation refreshes it. A consumer that
   * echoes a selection back through the controlled `state` prop may
   * round-trip it verbatim, but does not have to: dropping it costs nothing,
   * because the engine recovers it by row id from the selection it replaces.
   */
  readonly datasetRowSpan?: PretableIndexedDatasetRowSpan;
}

/** Inclusive data-row span stored by its stable endpoint IDs. @public */
export interface PretableIndexedRowRange<TRowId extends IndexedPretableRowId> {
  readonly startRowId: TRowId;
  readonly endRowId: TRowId;
}

/** Immutable normalized interval index for symbolic row selections. @public */
export interface PretableIndexedRowRangeIndex<
  TRowId extends IndexedPretableRowId,
> extends Iterable<PretableIndexedRowRange<TRowId>> {
  readonly size: number;
}

/** Sparse row-checkbox state. Select-all never materializes the data population. @public */
export type PretableIndexedRowSelection<TRowId extends IndexedPretableRowId> =
  | {
      readonly kind: "explicit";
      readonly rowIds: ReadonlySet<TRowId>;
      readonly ranges?: PretableIndexedRowRangeIndex<TRowId>;
      readonly excludedRanges?: PretableIndexedRowRangeIndex<TRowId>;
    }
  | {
      readonly kind: "all";
      readonly excludedRanges?: PretableIndexedRowRangeIndex<TRowId>;
    };

/**
 * The row-checkbox slice as a consumer WRITES it — the settable counterpart of
 * {@link PretableIndexedRowSelection}, which is what the engine holds.
 *
 * Same two cases and the same discriminant, because they describe the same
 * thing; only the containers differ. The engine stores a `ReadonlySet` and an
 * opaque normalized interval index, neither of which a consumer can build; this
 * shape takes plain arrays and the engine indexes them at the boundary.
 *
 * The sparseness survives that conversion, which is the point of not flattening
 * this to a list of ids:
 *
 *   - `{ kind: "all" }` is symbolic. Applying it is O(1) whatever the row
 *     count — it never enumerates the population, so select-all over a million
 *     rows stays free.
 *   - `ranges` carries a shift-checked span as its two endpoints, so a 100k-row
 *     span costs two ids rather than 100k.
 *   - `excludedRowIds` is POINTS, not spans, matching what the engine can
 *     actually store: unticking one row out of a symbolic "all" records that
 *     one row. A span-shaped exclusion would read as though it could untick a
 *     range, which nothing here can do.
 *
 * @public
 */
export type PretableRowSelectionState<TRowId extends IndexedPretableRowId> =
  | {
      readonly kind: "explicit";
      readonly rowIds: readonly TRowId[];
      readonly ranges?: readonly PretableIndexedRowRange<TRowId>[];
      readonly excludedRowIds?: readonly TRowId[];
    }
  | {
      readonly kind: "all";
      readonly excludedRowIds?: readonly TRowId[];
    };

/** Data-only selection owned by the indexed UI layer. @public */
export interface PretableIndexedSelectionState<
  TRowId extends IndexedPretableRowId,
  TColumnId extends string,
> {
  readonly rows: PretableIndexedRowSelection<TRowId>;
  readonly ranges: readonly PretableIndexedCellRange<TRowId, TColumnId>[];
  readonly anchor: PretableIndexedCellAddress<TRowId, TColumnId> | null;
}

/**
 * Loaded span, in dataset-index terms, that `reconcileIndexedSelection` uses
 * to tell an evicted row (outside `[start, start + length)`) from a deleted
 * one (inside it) — see `resultMeta.window` on `PretableResultMeta`, which
 * this mirrors with `length` standing in for `rows.length`. `@internal`
 * rather than derived from `PretableResultMeta` directly: grid-core has no
 * dependency on the react-level honesty gate that decides whether a window
 * may be trusted, so callers pass this only once that gate has passed.
 *
 * @internal
 */
export interface PretableIndexedSelectionWindow {
  readonly start: number;
  readonly length: number;
  /**
   * `resultMeta.datasetKey` for the population this window is a slice of.
   * Carried here rather than on a channel of its own because a span is only
   * meaningful paired with the population it was measured in, and the two
   * must never be able to disagree — see
   * {@link PretableIndexedDatasetRowSpan.datasetKey}.
   *
   * Absent switches spans off entirely for this window: none are recorded and
   * none are read back. That is fail-closed by design, not an oversight.
   */
  readonly datasetKey?: string;
}

/**
 * What a reconciliation pass needs in order to tell an evicted row from a
 * deleted one. Absent, or a null `window` (local mode, or the honesty gate not
 * passing), makes every consumer behave exactly as it did before eviction
 * existed: absence alone still means deletion.
 *
 * ONE shape, shared by `reconcileIndexedSelection` and
 * `reconcileIndexedFocus`, because the two must agree about what happened to a
 * row. A selection that survives an eviction under a cursor that does not is
 * not a coherent grid.
 *
 * @internal
 */
export interface PretableIndexedEvictionContext<
  TRow extends object,
  TRowId extends IndexedPretableRowId,
  TColumns,
> {
  /** The loaded span for the snapshot being reconciled, in dataset-index
   * terms. See {@link PretableIndexedSelectionWindow}. */
  readonly window: PretableIndexedSelectionWindow | null;
  /**
   * The snapshot/window pairing as of the last successful reconciliation, if
   * any — read to prove deletion (see `provenDeletedRow`); never mutated. A
   * single paired object, not two positional arguments: `snapshot` and
   * `window` must move together or a data-only rank gets converted through the
   * wrong offset.
   */
  readonly previous?: {
    readonly snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
    readonly window: PretableIndexedSelectionWindow | null;
  };
}

/** Header-checkbox state derived without visiting every visible row. @public */
export interface PretableIndexedSelectionSummary {
  readonly state: "none" | "some" | "all";
  readonly selectedCount: number;
  readonly visibleCount: number;
}

/**
 * How many data rows the CELL-RANGE slice covers — `ranges`, the slice a
 * click/shift-click/marquee builds. Distinct from
 * {@link PretableIndexedSelectionSummary}, which counts the separate sparse
 * row-selection program behind the checkbox column; the two answer different
 * questions and neither is derived from the other.
 *
 * @public
 */
export interface PretableIndexedCellSelectionSummary {
  /**
   * Distinct data rows covered, counted by arithmetic over spans — O(ranges),
   * independent of how many rows are selected or how many are loaded.
   * Overlapping ranges are unioned, never double-counted.
   */
  readonly rowCount: number;
  /**
   * Whether every contributing range had both endpoints loaded, so
   * `rowCount` is a fact about rows that are provably still there.
   *
   * `false` means the count came wholly or partly from remembered dataset
   * positions: the rows are evicted, and a row deleted server-side while
   * evicted cannot be detected, so `rowCount` may overstate. It is still the
   * best available number — the loaded-rows-only alternative understates a
   * genuine selection by whatever fraction is evicted — but it may not be
   * presented as a proven one. Same rule as `PretableMatchingTotal`'s
   * `"exact" | "estimate"`: keep the number, qualify the claim, and let the
   * boundary that must speak a bare integer downgrade (see
   * `resolveAriaRowCount`).
   */
  readonly verified: boolean;
}

/**
 * The column-header strip as a focus target.
 *
 * Deliberately NOT a variant of `PretableVisibleRowRef`. That type is the row
 * model's own address space — `indexOf`, `nearestVisibleRef`, the row-height
 * index and the transaction draft all speak it — and the row model has no
 * header row to produce. Widening it there would force ~50 sites in
 * `@pretable-internal/row-model` and `@pretable-internal/renderer-dom` to
 * branch on a variant they can never see.
 *
 * The FOCUS ref is a different, wider space: a focus cursor addresses a cell,
 * and a header cell is a cell. Widening here is what makes the compiler demand
 * that every site handing `focus.ref` to a row-model API says what it does with
 * a header first — which is the whole point of the encoding.
 *
 * It carries no column: the column lives in `PretableIndexedFocusState.columnId`
 * exactly as it does for a data row. `{ref: null, columnId}` was ruled out by
 * measurement, not argument — `reconcileIndexedFocus` normalizes a null ref to
 * `emptyFocus()`, so it collapses to "no focus" on the first round trip.
 *
 * @public
 */
export interface PretableHeaderRowRef {
  readonly kind: "header";
}

/**
 * Everywhere the focus cursor can sit: any visible row, or the header strip.
 *
 * @public
 */
export type PretableIndexedFocusRef<TRowId extends IndexedPretableRowId> =
  PretableVisibleRowRef<TRowId> | PretableHeaderRowRef;

/** Group rows, data rows and the header share one focus path while preserving runtime identity. @public */
export interface PretableIndexedFocusState<
  TRowId extends IndexedPretableRowId,
  TColumnId extends string,
> {
  readonly ref: PretableIndexedFocusRef<TRowId> | null;
  readonly columnId: TColumnId | null;
}

/**
 * Keyboard movements supported by indexed focus navigation.
 *
 * The four edge jumps come in two axes, and which axis a movement belongs to
 * is the whole reason they are named separately:
 *
 * - `"home"` / `"end"` are the VERTICAL edges — the first and last row of the
 *   current column.
 * - `"first-column"` / `"last-column"` are the HORIZONTAL edges — the first
 *   and last column of the current row.
 *
 * On the header, which is a single row, every edge is a column edge, so
 * `"home"` and `"end"` land on the first and last column there. That is the
 * one place the two axes coincide, and it is what made the distinction easy to
 * lose: `Cmd/Ctrl + Left` and `Cmd/Ctrl + Right` were both mapped onto
 * `"home"` / `"end"`, so on a data cell they jumped to the first and last ROW
 * while behaving correctly on the header.
 *
 * @public
 */
export type PretableIndexedFocusMovement =
  | "up"
  | "down"
  | "left"
  | "right"
  | "page-up"
  | "page-down"
  | "home"
  | "end"
  | "first-column"
  | "last-column"
  | "tab"
  | "shift-tab"
  | "parent";

/**
 * Optional modifiers for {@link PretableIndexedFocusMovement}.
 *
 * Named rather than spelled inline at each `moveFocus` so the react handle can
 * import it: an inline object literal is a copy, and a copy drifts. `pageRows`
 * is how many rows `"page-up"` / `"page-down"` travel.
 *
 * @public
 */
export interface PretableIndexedMoveFocusOptions {
  readonly pageRows?: number;
}

/** Visual-column input; derivation behavior remains in the row model. @public */
export interface PretableGridUiColumn<TColumnId extends string> {
  readonly id: TColumnId;
  readonly widthPx?: number;
  readonly pinned?: "left" | "right";
}

/** Normalized visual-only column layout published by the UI store. @public */
export interface PretableGridUiColumnLayout<TColumnId extends string> {
  readonly id: TColumnId;
  readonly widthPx: number;
  readonly pinned?: "left" | "right";
}

/** A correlated, data-row-only editing session. @public */
export type PretableIndexedEditingState<
  TRowId extends IndexedPretableRowId,
  TColumns,
> = {
  readonly [TColumnId in ColumnIdOf<TColumns>]: {
    readonly rowId: TRowId;
    readonly columnId: TColumnId;
    readonly value: ColumnValueOf<TColumns, TColumnId>;
    readonly status: "editing" | "validating" | "saving" | "error";
    readonly error?: string;
  };
}[ColumnIdOf<TColumns>];

/**
 * The long-lived grid store's complete observable UI state.
 *
 * `TColumns` and `TColumnId` are two different column vocabularies and are
 * deliberately separate parameters. `TColumns` is the row model's SCHEMA: it
 * is the only thing that correlates a column to the type of the value in it,
 * so `editing` is written against it. `TColumnId` is what the grid DRAWS,
 * which is a superset — a presentation layer may add columns the schema never
 * declared (`@pretable/react` draws a grouped-row column and a row-checkbox
 * column), and those ids appear in `columnLayout`, under the focus cursor and
 * inside a selection range exactly like a schema column's do.
 *
 * Collapsing the two is not merely imprecise, it disables checking: a
 * consumer's `columnOrder` naming a drawn-but-unschema'd id has to be
 * comparable against what the engine holds, or the mismatch is discoverable
 * only at runtime. Defaulted to {@link ColumnIdOf} so the schema-exact case —
 * a grid with no presentation extras, which is most of them — needs no
 * annotation and keeps the narrow ids it has always had.
 *
 * @public
 */
export interface PretableGridUiState<
  TRowId extends IndexedPretableRowId,
  TColumns,
  TColumnId extends string = ColumnIdOf<TColumns>,
> {
  readonly viewport: Readonly<PretableViewportState>;
  readonly focus: Readonly<PretableIndexedFocusState<TRowId, TColumnId>>;
  readonly selection: Readonly<
    PretableIndexedSelectionState<TRowId, TColumnId>
  >;
  readonly editing: PretableIndexedEditingState<TRowId, TColumns> | null;
  readonly columnLayout: readonly Readonly<
    PretableGridUiColumnLayout<TColumnId>
  >[];
  readonly observedRowModelRevision: number | null;
}

/**
 * Framework-independent UI-only indexed grid store.
 *
 * See {@link PretableGridUiState} for why the schema column tuple
 * (`TColumns`) and the drawn column-id vocabulary (`TColumnId`) are separate
 * parameters.
 *
 * @public
 */
export interface PretableGridUiCore<
  TRow extends object,
  TRowId extends IndexedPretableRowId,
  TColumns,
  TColumnId extends string = ColumnIdOf<TColumns>,
> {
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly getState: () => PretableGridUiState<TRowId, TColumns, TColumnId>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setViewport: (viewport: PretableViewportState) => void;
  readonly setFocus: (
    focus: PretableIndexedFocusState<TRowId, TColumnId>,
  ) => void;
  readonly moveFocus: (
    movement: PretableIndexedFocusMovement,
    options?: PretableIndexedMoveFocusOptions,
  ) => void;
  readonly setSelection: (
    selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  ) => void;
  /**
   * Replace the row-checkbox slice, leaving the cell ranges and anchor alone.
   *
   * The write-side counterpart of `getState().selection.rows`. `setSelection`
   * cannot do this job: it takes the engine's own containers, which a consumer
   * has no way to construct.
   *
   * Idempotent — applying a value the slice already holds publishes nothing, so
   * a controlled caller can push on every render without looping.
   */
  readonly setRowSelection: (rows: PretableRowSelectionState<TRowId>) => void;
  readonly toggleRowSelection: (rowId: TRowId) => void;
  readonly selectRowRange: (startRowId: TRowId, endRowId: TRowId) => void;
  readonly isRowSelected: (rowId: TRowId) => boolean;
  readonly getSelectionSummary: () => PretableIndexedSelectionSummary;
  /**
   * How many data rows the CELL-RANGE slice covers, and whether that number
   * is proven. Counted by arithmetic over dataset spans, so it stays correct
   * — and O(ranges) — while most of the selection is evicted.
   *
   * A separate method from {@link getSelectionSummary} because they count
   * different slices: that one counts the sparse row-selection program the
   * checkbox column drives, this one counts `selection.ranges`.
   */
  readonly getCellSelectionSummary: () => PretableIndexedCellSelectionSummary;
  readonly selectAllVisibleRows: () => void;
  readonly clearSelection: () => void;
  /**
   * `TEditColumnId` ranges over the SCHEMA ids, not the drawn ones: an edit
   * carries a value, and only the schema says what type the value in a given
   * column has. A drawn-but-unschema'd column (a checkbox gutter, a group
   * label) has no value to edit, and this signature is what says so.
   */
  readonly beginEdit: <TEditColumnId extends ColumnIdOf<TColumns>>(input: {
    readonly rowId: TRowId;
    readonly columnId: TEditColumnId;
    readonly value: ColumnValueOf<TColumns, TEditColumnId>;
  }) => void;
  readonly setEditDraft: (value: unknown) => void;
  readonly setEditStatus: (
    status: "editing" | "validating" | "saving" | "error",
    error?: string,
  ) => void;
  readonly cancelEdit: () => void;
  /** Reconciles the current visual column set without changing row schema. */
  readonly setColumns: (
    columns: readonly PretableGridUiColumn<TColumnId>[],
  ) => void;
  readonly setColumnWidth: (columnId: TColumnId, width: number) => void;
  readonly setColumnPinned: (
    columnId: TColumnId,
    pinned: "left" | "right" | null,
  ) => void;
  readonly setColumnOrder: (columnIds: readonly TColumnId[]) => void;
  /** @internal Called only after renderer geometry for this exact revision exists. */
  readonly observeRowModelRevision: (revision: number) => void;
  readonly dispose: () => void;
  /**
   * @internal Compile-time-only invariant descriptor. Keyed by a string
   * literal, not a `unique symbol` — see `PretableGroupId` in
   * `@pretable-internal/row-model`'s `types.ts` for why a symbol brand does not
   * survive `tsup`'s bundled `.d.ts` re-emitting this declaration into
   * `core/dist`.
   */
  readonly "~pretableGridUiCore"?: (
    value: readonly [TRow, TRowId, TColumns, TColumnId],
  ) => readonly [TRow, TRowId, TColumns, TColumnId];
}
