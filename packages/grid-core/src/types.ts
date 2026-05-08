import type {
  AutosizeOptions,
  PretableRowRange,
} from "@pretable-internal/layout-core";

export type PretableRow = Record<string, unknown>;
export type PretableSortDirection = "asc" | "desc" | null;

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

export interface PretableFormatInput<TRow extends PretableRow = PretableRow> {
  value: unknown;
  row: TRow;
  column: PretableColumn<TRow>;
}

export interface PretableGridOptions<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn<TRow>[];
  rows: TRow[];
  getRowId?: (row: TRow, index: number) => string;
  autosize?: boolean | AutosizeOptions;
}

export interface PretableSortState {
  columnId: string | null;
  direction: PretableSortDirection;
}

export interface PretableCellAddress {
  rowId: string;
  columnId: string;
}

export interface PretableCellRange {
  startRowId: string;
  endRowId: string;
  startColumnId: string;
  endColumnId: string;
}

export interface PretableSelectionState {
  ranges: PretableCellRange[];
  anchor: PretableCellAddress | null;
}

export interface PretableFocusState {
  rowId: string | null;
  columnId: string | null;
}

export interface PretableViewportState {
  scrollTop: number;
  scrollLeft: number;
  height: number;
  width: number;
}

export interface PretableTransaction<TRow extends PretableRow = PretableRow> {
  add?: TRow[];
  update?: Partial<TRow>[];
  remove?: string[];
}

export interface PretableVisibleRow<TRow extends PretableRow = PretableRow> {
  id: string;
  row: TRow;
  sourceIndex: number;
}

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

export type PretableFocusDirection = "up" | "down" | "left" | "right";

export interface PretableMoveFocusOptions {
  extend?: boolean;
  jumpToEdge?: boolean;
  byPage?: boolean;
}

export interface PretableFrame<TRow extends PretableRow = PretableRow> {
  snapshot: PretableGridSnapshot<TRow>;
}
