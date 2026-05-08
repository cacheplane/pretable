import type {
  AutosizeOptions,
  PretableRowRange,
} from "@pretable-internal/layout-core";

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
 * Engine-level column definition. `@pretable/react` extends this with React-specific render fields.
 *
 * @public
 */
export interface PretableColumn<TRow extends PretableRow = PretableRow> {
  id: string;
  header?: string;
  wrap?: boolean;
  widthPx?: number;
  pinned?: "left";
  sortable?: boolean;
  filterable?: boolean;
  value?: (row: TRow) => unknown;
  format?: (input: PretableFormatInput<TRow>) => string;
  // new in sub-project C:
  minWidthPx?: number;
  maxWidthPx?: number;
  resizable?: boolean;
  reorderable?: boolean;
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
 * Options accepted by `createGrid`.
 *
 * @public
 */
export interface PretableGridOptions<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn<TRow>[];
  rows: TRow[];
  getRowId?: (row: TRow, index: number) => string;
  autosize?: boolean | AutosizeOptions;
}

/**
 * Active sort. `columnId` is null when no column is sorted.
 *
 * @public
 */
export interface PretableSortState {
  columnId: string | null;
  direction: PretableSortDirection;
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
 * A row currently in the visible window — includes its source-array index for stable identity.
 *
 * @public
 */
export interface PretableVisibleRow<TRow extends PretableRow = PretableRow> {
  id: string;
  row: TRow;
  sourceIndex: number;
}

/**
 * Read-only state observed via `PretableGrid.getSnapshot`.
 *
 * @public
 */
export interface PretableGridSnapshot<TRow extends PretableRow = PretableRow> {
  viewport: PretableViewportState;
  sort: PretableSortState;
  filters: Record<string, string>;
  selection: PretableSelectionState;
  focus: PretableFocusState;
  totalRowCount: number;
  visibleRows: PretableVisibleRow<TRow>[];
  visibleRange: PretableRowRange;
}

/** @internal */
export interface PretableEngine<TRow extends PretableRow = PretableRow> {
  options: PretableGridOptions<TRow>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): PretableGridSnapshot<TRow>;
  setSort(columnId: string | null, direction: PretableSortDirection): void;
  setFilter(columnId: string, value: string): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, string>): void;
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

  // column-layout actions (sub-project C):
  setColumnWidth(columnId: string, width: number): void;
  moveColumn(columnId: string, toIndex: number): void;
  setColumnPinned(columnId: string, pinned: "left" | null): void;
  autosizeColumn(columnId: string, options?: AutosizeOptions): void;
  resetColumnLayout(): void;
  mergeColumnsFromProps(nextColumns: PretableColumn<TRow>[]): void;
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
