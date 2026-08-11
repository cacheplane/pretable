import type {
  AutosizeOptions,
  PretableRowRange,
} from "@pretable-internal/layout-core";
import type {
  ColumnIdOf,
  ColumnValueOf,
  PretableRowId as IndexedPretableRowId,
  PretableRowModel,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";
import type { PretableGroupColumnOptions } from "./group-column";

/**
 * Base row constraint — every row is at minimum a string-keyed record.
 *
 * @public
 */
export type PretableRow = Record<string, unknown>;

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
 * In-progress cell edit observed via `PretableGrid.getSnapshot().editing`.
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
  type?: ColumnType;
  options?: ColumnOption[];
  value?: (row: TRow) => unknown;
  format?: (input: PretableFormatInput<TRow>) => string;
  /**
   * Render this column's aggregate on a group row.
   *
   * Deliberately not `format`: `PretableFormatInput.row` is non-optional, so
   * every consumer formatter is entitled to dereference it, and a group row has
   * no row. Columns without `formatAggregate` fall back to the same default
   * stringification a plain cell uses.
   */
  formatAggregate?: (input: PretableAggregateFormatInput<TRow>) => string;
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
  // row grouping (v1):
  /** Group rows by this column by default; levels follow column order. */
  rowGroup?: boolean;
  /** Aggregate shown for this column on group rows. */
  aggregate?: PretableAggregateSpec;
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

/**
 * Input passed to a column's `format` function.
 *
 * @public
 */
export interface PretableFormatInput<TRow extends PretableRow = PretableRow> {
  value: unknown;
  row: TRow;
  column: PretableColumn<TRow>;
}

/**
 * Input passed to a column's `formatAggregate` function. Carries the group row
 * in place of a data row — an aggregate has no row behind it.
 *
 * @public
 */
export interface PretableAggregateFormatInput<
  TRow extends PretableRow = PretableRow,
> {
  value: unknown;
  column: PretableColumn<TRow>;
  group: PretableGroupRow;
}

/**
 * Options accepted by `createGrid`.
 *
 * @public
 */
export interface PretableGridOptions<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn<TRow>[];
  rows: TRow[];
  getRowId?: (row: TRow, index: number) => string;
  autosize?: boolean | AutosizeOptions;
  // row grouping (v1):
  /**
   * Fold group aggregates over rows the active filter hides. Default `false`,
   * so a group total always equals the sum of the rows visible beneath it.
   * `childCount` is post-filter either way.
   */
  aggregateFilteredRows?: boolean;
  /**
   * Expanded state for groups with no entry in `groupExpansionOverrides`.
   * Default `true`. Groups appearing mid-stream inherit it with no bookkeeping.
   */
  groupsDefaultExpanded?: boolean;
  /**
   * How many per-group expand/collapse decisions the grid remembers. Default
   * `10_000`. Past the limit the least-recently-decided group is forgotten and
   * reverts to `groupsDefaultExpanded`.
   *
   * **Why a limit exists.** Expansion state is keyed by a path-derived group id
   * rather than owned by a node, which is what lets a group survive emptying and
   * returning mid-stream. The price is that ids for groups which never return
   * would otherwise accumulate forever under a stream whose grouping keys churn.
   *
   * Values below 1 clamp to 1; a non-finite value other than `Infinity` falls
   * back to the default. Pass `Infinity` to opt out of the cap entirely and
   * accept unbounded growth.
   *
   * `expandAll()` / `collapseAll()` are unaffected — they flip the default and
   * clear the set, so "collapse everything" costs one entry-free operation no
   * matter how many groups exist.
   */
  groupExpansionOverrideLimit?: number;
  /**
   * Configure the derived group column — the synthetic column that carries the
   * label, twisty and child count for every grouping level. Present in
   * `getColumns()` exactly while `rowGroups` is non-empty.
   */
  groupColumn?: PretableGroupColumnOptions;
  /**
   * Drop the grouped columns from the data area while grouping is active.
   * Default `true`, uniformly — whether the grouping came from `rowGroup: true`
   * on a column or from a later `setRowGroups` call.
   */
  hideGroupedColumns?: boolean;
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
 * Streaming transaction — incremental row mutations applied via `PretableGrid.applyTransaction`.
 *
 * @public
 */
export interface PretableTransaction<TRow extends PretableRow = PretableRow> {
  add?: TRow[];
  update?: Partial<TRow>[];
  remove?: string[];
}

/**
 * A data row in the flat visible list — includes its source-array index for stable identity.
 *
 * @public
 */
export interface PretableDataRow<TRow extends PretableRow = PretableRow> {
  kind: "data";
  id: string;
  row: TRow;
  sourceIndex: number;
  /** Nesting depth beneath its group ancestors; `0` when ungrouped. */
  depth: number;
}

/**
 * A group header row in the flat visible list.
 *
 * @public
 */
export interface PretableGroupRow {
  kind: "group";
  /** Stable, path-derived id (see `makeGroupId`). */
  id: string;
  /** Nesting depth; the outermost group level is `0`. */
  depth: number;
  /** The column this level groups by. */
  columnId: string;
  /** The group key value, as read from the grouping column. */
  value: unknown;
  /** Data rows beneath this group, post-filter. */
  childCount: number;
  /** Finalized aggregate values, keyed by column id. */
  aggregates: Record<string, unknown>;
}

/**
 * One entry in the flat visible-row list. The list stays flat — virtualization,
 * selection ranges, focus and copy all depend on that — and the union is
 * deliberately open: total/footer rows will join it later.
 *
 * @public
 */
export type PretableVisibleRow<TRow extends PretableRow = PretableRow> =
  PretableDataRow<TRow> | PretableGroupRow;

/**
 * An aggregate function, defined as a monoid rather than as `(values) => result`.
 *
 * The engine folds over a group's descendant leaf rows (`init`, then
 * `accumulate` per leaf, then `finalize`), so order-sensitive statistics such as
 * median remain expressible. `merge` must nevertheless be associative with
 * `init()` as its identity: that contract is what allows a future switch to
 * child-aggregate rollup to be a pure internal optimization instead of a
 * breaking change to every consumer's aggregate function.
 *
 * `accumulate` may mutate and return `acc` — the engine hands each fold a fresh
 * `init()` and never retains an earlier accumulator. `merge` must NOT mutate
 * either argument.
 *
 * @public
 */
export interface PretableAggregator<TAcc = unknown, TOut = unknown> {
  /** Empty accumulator. */
  init(): TAcc;
  /** Fold one leaf cell value into the accumulator. */
  accumulate(acc: TAcc, value: unknown, row: PretableRow): TAcc;
  /** Combine two accumulators (must be associative; `init()` is the identity). */
  merge(a: TAcc, b: TAcc): TAcc;
  /** Produce the display value — always a plain scalar, never a wrapper object. */
  finalize(acc: TAcc): TOut;
}

/**
 * A column's aggregate: a built-in name or a custom {@link PretableAggregator}.
 *
 * @public
 */
export type PretableAggregateSpec =
  "sum" | "avg" | "min" | "max" | "count" | PretableAggregator;

/**
 * Read-only state observed via `PretableGrid.getSnapshot`.
 *
 * @public
 */
export interface PretableGridSnapshot<TRow extends PretableRow = PretableRow> {
  viewport: PretableViewportState;
  sort: PretableSortEntry[];
  filters: Record<string, ColumnFilter>;
  selection: PretableSelectionState;
  focus: PretableFocusState;
  totalRowCount: number;
  visibleRows: PretableVisibleRow<TRow>[];
  visibleRange: PretableRowRange;
  editing: PretableEditState | null;
  /** Grouping columns, outermost first; `[]` when ungrouped. */
  rowGroups: string[];
  /** Group ids whose expanded state differs from {@link groupsDefaultExpanded}. */
  groupExpansionOverrides: ReadonlySet<string>;
  /** Expanded state for every group with no entry in the override set. */
  groupsDefaultExpanded: boolean;
}

/** @internal */
export interface PretableEngine<TRow extends PretableRow = PretableRow> {
  options: PretableGridOptions<TRow>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): PretableGridSnapshot<TRow>;
  /**
   * The columns a renderer should draw: `options.columns` plus the derived
   * group column, minus the grouped columns, while `rowGroups` is non-empty.
   * Identical to `options.columns` — by identity — when ungrouped.
   *
   * Every React-side column read goes through here. `options.columns` stays
   * the consumer's truth, so the column mutators keep operating on real
   * columns and need no synthetic-column special case.
   */
  getColumns(): readonly PretableColumn<TRow>[];
  setSort(columnId: string | null, direction: PretableSortDirection): void;
  replaceSort(entries: PretableSortEntry[]): void;
  setColumnFilter(columnId: string, filter: ColumnFilter | null): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, ColumnFilter>): void;
  distinctColumnValues(columnId: string): string[];
  // selection actions
  setSelection(state: PretableSelectionState): void;
  selectAll(): void;
  clearSelection(): void;
  addRange(range: PretableCellRange): void;
  extendRangeFromAnchor(addr: PretableCellAddress): void;
  toggleRowSelection(rowId: string): void;
  setSelectAllVisible(checked: boolean): void;

  // focus actions
  setFocus(addr: PretableCellAddress | null): void;
  moveFocus(
    direction: PretableFocusDirection,
    options?: PretableMoveFocusOptions,
  ): void;
  setViewport(viewport: PretableViewportState): void;
  autosizeColumns(autosizeOptions?: AutosizeOptions): void;
  applyTransaction(transaction: PretableTransaction<TRow>): void;
  setRows(rows: TRow[]): void;

  // row grouping (v1):
  /** Replace the grouping levels, outermost first. `[]` ungroups. */
  setRowGroups(columnIds: readonly string[]): void;
  /** Flip one group's expanded state. */
  toggleGroup(groupId: string): void;
  setGroupExpanded(groupId: string, expanded: boolean): void;
  /** Expand every group — including ones that do not exist yet. */
  expandAll(): void;
  /** Collapse every group — including ones that do not exist yet. */
  collapseAll(): void;

  // column-layout actions (sub-project C):
  setColumnWidth(columnId: string, width: number): void;
  moveColumn(columnId: string, toIndex: number): void;
  setColumnOrder(ids: readonly string[]): void;
  setColumnPinned(columnId: string, pinned: "left" | "right" | null): void;
  autosizeColumn(columnId: string, options?: AutosizeOptions): void;
  resetColumnLayout(): void;
  mergeColumnsFromProps(nextColumns: PretableColumn<TRow>[]): void;

  // cell editing (v1):
  beginEdit(
    addr: PretableCellAddress,
    opts?: { draft?: unknown; status?: "checking" | "editing" },
  ): void;
  setEditDraft(value: unknown): void;
  markEditing(): void;
  markEditValidating(): void;
  markEditSaving(): void;
  markEditInvalid(message: string): void;
  markEditError(message: string): void;
  commitEditSucceeded(): void;
  cancelEdit(): void;
}

/**
 * Direction passed to `PretableGrid.moveFocus`.
 *
 * @public
 */
export type PretableFocusDirection = "up" | "down" | "left" | "right";

/**
 * Optional behavior modifiers for `PretableGrid.moveFocus`.
 *
 * @public
 */
export interface PretableMoveFocusOptions {
  extend?: boolean;
  jumpToEdge?: boolean;
  byPage?: boolean;
}

/** @internal */
export interface PretableFrame<TRow extends PretableRow = PretableRow> {
  snapshot: PretableGridSnapshot<TRow>;
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

/** Sparse row-checkbox state. Select-all never materializes the data population. @public */
export type PretableIndexedRowSelection<TRowId extends IndexedPretableRowId> =
  | {
      readonly kind: "explicit";
      readonly rowIds: ReadonlySet<TRowId>;
    }
  | {
      readonly kind: "all";
      readonly excludedRowIds: ReadonlySet<TRowId>;
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
  readonly toggleRowSelection: (rowId: TRowId) => void;
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
