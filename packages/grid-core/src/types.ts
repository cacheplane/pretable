import type {
  ColumnIdOf,
  ColumnValueOf,
  PretableFormatInput,
  PretableRowId as IndexedPretableRowId,
  PretableRowModel,
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

/** Who applies a query slice to the loaded rows. @experimental @public */
export type PretableProcessingAuthority = "engine" | "external";

/** Per-slice processing authority for remotely fulfilled queries. @experimental @public */
export interface PretableProcessingOptions {
  filter?: PretableProcessingAuthority;
  sort?: PretableProcessingAuthority;
}

/** Population size represented by a loaded result window. @experimental @public */
export type PretableMatchingTotal =
  | { kind: "exact"; count: number }
  | { kind: "estimate"; count: number }
  | { kind: "unknown"; atLeast?: number };

/** Metadata accompanying a remotely fulfilled result window. @experimental @public */
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

/** Inclusive data-cell range; group rows can never be endpoints. @public */
export interface PretableIndexedCellRange<
  TRowId extends IndexedPretableRowId,
  TColumnId extends string,
> {
  readonly start: PretableIndexedCellAddress<TRowId, TColumnId>;
  readonly end: PretableIndexedCellAddress<TRowId, TColumnId>;
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

/** Header-checkbox state derived without visiting every visible row. @public */
export interface PretableIndexedSelectionSummary {
  readonly state: "none" | "some" | "all";
  readonly selectedCount: number;
  readonly visibleCount: number;
}

/** Group and data rows share one focus path while preserving runtime identity. @public */
export interface PretableIndexedFocusState<
  TRowId extends IndexedPretableRowId,
  TColumnId extends string,
> {
  readonly ref: PretableVisibleRowRef<TRowId> | null;
  readonly columnId: TColumnId | null;
}

/** Keyboard movements supported by indexed focus navigation. @public */
export type PretableIndexedFocusMovement =
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
  | "parent";

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

/** The long-lived grid store's complete observable UI state. @public */
export interface PretableGridUiState<
  TRowId extends IndexedPretableRowId,
  TColumns,
> {
  readonly viewport: Readonly<PretableViewportState>;
  readonly focus: Readonly<
    PretableIndexedFocusState<TRowId, ColumnIdOf<TColumns>>
  >;
  readonly selection: Readonly<
    PretableIndexedSelectionState<TRowId, ColumnIdOf<TColumns>>
  >;
  readonly editing: PretableIndexedEditingState<TRowId, TColumns> | null;
  readonly columnLayout: readonly Readonly<
    PretableGridUiColumnLayout<ColumnIdOf<TColumns>>
  >[];
  readonly observedRowModelRevision: number | null;
}

declare const gridUiCoreType: unique symbol;

/** Framework-independent UI-only indexed grid store. @public */
export interface PretableGridUiCore<
  TRow extends object,
  TRowId extends IndexedPretableRowId,
  TColumns,
> {
  readonly rowModel: PretableRowModel<TRow, TRowId, TColumns>;
  readonly getState: () => PretableGridUiState<TRowId, TColumns>;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setViewport: (viewport: PretableViewportState) => void;
  readonly setFocus: (
    focus: PretableIndexedFocusState<TRowId, ColumnIdOf<TColumns>>,
  ) => void;
  readonly moveFocus: (
    movement: PretableIndexedFocusMovement,
    options?: { readonly pageRows?: number },
  ) => void;
  readonly setSelection: (
    selection: PretableIndexedSelectionState<TRowId, ColumnIdOf<TColumns>>,
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
  /** Reconciles the current visual column set without changing row schema. */
  readonly setColumns: (
    columns: readonly PretableGridUiColumn<ColumnIdOf<TColumns>>[],
  ) => void;
  readonly setColumnWidth: (
    columnId: ColumnIdOf<TColumns>,
    width: number,
  ) => void;
  readonly setColumnPinned: (
    columnId: ColumnIdOf<TColumns>,
    pinned: "left" | "right" | null,
  ) => void;
  readonly setColumnOrder: (columnIds: readonly ColumnIdOf<TColumns>[]) => void;
  /** @internal Called only after renderer geometry for this exact revision exists. */
  readonly observeRowModelRevision: (revision: number) => void;
  readonly dispose: () => void;
  /** @internal Compile-time-only invariant descriptor. */
  readonly [gridUiCoreType]?: (
    value: readonly [TRow, TRowId, TColumns],
  ) => readonly [TRow, TRowId, TColumns];
}
