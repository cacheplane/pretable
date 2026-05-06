import type {
  AutosizeOptions,
  LayoutSpan,
} from "@pretable-internal/layout-core";

export type GridCoreRow = Record<string, unknown>;
export type GridCoreSortDirection = "asc" | "desc" | null;

export interface GridCoreColumn<TRow extends GridCoreRow = GridCoreRow> {
  id: string;
  header?: string;
  wrap?: boolean;
  widthPx?: number;
  pinned?: "left";
  sortable?: boolean;
  filterable?: boolean;
  value?: (row: TRow) => unknown;
  format?: (input: GridCoreFormatInput<TRow>) => string;
  // new in sub-project C:
  minWidthPx?: number;
  maxWidthPx?: number;
  resizable?: boolean;
  reorderable?: boolean;
}

export interface GridCoreFormatInput<TRow extends GridCoreRow = GridCoreRow> {
  value: unknown;
  row: TRow;
  column: GridCoreColumn<TRow>;
}

export interface GridCoreOptions<TRow extends GridCoreRow = GridCoreRow> {
  columns: GridCoreColumn<TRow>[];
  rows: TRow[];
  getRowId?: (row: TRow, index: number) => string;
  autosize?: boolean | AutosizeOptions;
}

export interface GridCoreSortState {
  columnId: string | null;
  direction: GridCoreSortDirection;
}

export interface GridCoreCellAddress {
  rowId: string;
  columnId: string;
}

export interface GridCoreCellRange {
  startRowId: string;
  endRowId: string;
  startColumnId: string;
  endColumnId: string;
}

export interface GridCoreSelectionState {
  ranges: GridCoreCellRange[];
  anchor: GridCoreCellAddress | null;
}

export interface GridCoreFocusState {
  rowId: string | null;
  columnId: string | null;
}

export interface GridCoreViewportState {
  scrollTop: number;
  scrollLeft: number;
  height: number;
  width: number;
}

export interface GridCoreTransaction<TRow extends GridCoreRow = GridCoreRow> {
  add?: TRow[];
  update?: Partial<TRow>[];
  remove?: string[];
}

export interface GridCoreRowModel<TRow extends GridCoreRow = GridCoreRow> {
  id: string;
  row: TRow;
  sourceIndex: number;
}

export interface GridCoreSnapshot<TRow extends GridCoreRow = GridCoreRow> {
  viewport: GridCoreViewportState;
  sort: GridCoreSortState;
  filters: Record<string, string>;
  selection: GridCoreSelectionState;
  focus: GridCoreFocusState;
  totalRowCount: number;
  visibleRows: GridCoreRowModel<TRow>[];
  visibleRange: LayoutSpan;
}

export interface GridCoreStore<TRow extends GridCoreRow = GridCoreRow> {
  options: GridCoreOptions<TRow>;
  subscribe(listener: () => void): () => void;
  getSnapshot(): GridCoreSnapshot<TRow>;
  setSort(columnId: string | null, direction: GridCoreSortDirection): void;
  setFilter(columnId: string, value: string): void;
  clearFilters(): void;
  replaceFilters(nextFilters: Record<string, string>): void;
  // selection actions
  setSelection(state: GridCoreSelectionState): void;
  selectAll(): void;
  clearSelection(): void;
  addRange(range: GridCoreCellRange): void;
  extendRangeFromAnchor(addr: GridCoreCellAddress): void;
  toggleRowSelection(rowId: string): void;
  setSelectAllVisible(checked: boolean): void;

  // focus actions
  setFocus(addr: GridCoreCellAddress | null): void;
  moveFocus(
    direction: GridCoreFocusDirection,
    options?: GridCoreMoveFocusOptions,
  ): void;
  setViewport(viewport: GridCoreViewportState): void;
  autosizeColumns(autosizeOptions?: AutosizeOptions): void;
  applyTransaction(transaction: GridCoreTransaction<TRow>): void;

  // column-layout actions (sub-project C):
  setColumnWidth(columnId: string, width: number): void;
  moveColumn(columnId: string, toIndex: number): void;
  setColumnPinned(columnId: string, pinned: "left" | null): void;
  autosizeColumn(columnId: string, options?: AutosizeOptions): void;
  resetColumnLayout(): void;
  mergeColumnsFromProps(nextColumns: GridCoreColumn<TRow>[]): void;
}

export type GridCoreFocusDirection = "up" | "down" | "left" | "right";

export interface GridCoreMoveFocusOptions {
  extend?: boolean;
  jumpToEdge?: boolean;
  byPage?: boolean;
}

export interface GridCoreFrame<TRow extends GridCoreRow = GridCoreRow> {
  snapshot: GridCoreSnapshot<TRow>;
}
