import type { LayoutSpan } from "@pretable-internal/layout-core";

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
  getValue?: (row: TRow) => unknown;
}

export interface GridCoreOptions<TRow extends GridCoreRow = GridCoreRow> {
  columns: GridCoreColumn<TRow>[];
  rows: TRow[];
  getRowId?: (row: TRow, index: number) => string;
}

export interface GridCoreSortState {
  columnId: string | null;
  direction: GridCoreSortDirection;
}

export interface GridCoreSelectionState {
  rowIds: string[];
  anchorRowId: string | null;
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
  selectRow(rowId: string | null): void;
  setFocus(rowId: string | null, columnId: string | null): void;
  moveFocus(delta: number): void;
  setViewport(viewport: GridCoreViewportState): void;
}

export interface GridCoreFrame<TRow extends GridCoreRow = GridCoreRow> {
  snapshot: GridCoreSnapshot<TRow>;
}
