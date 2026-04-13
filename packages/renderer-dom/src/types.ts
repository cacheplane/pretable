import type {
  GridCoreColumn,
  GridCoreFrame,
  GridCoreRow,
  GridCoreSnapshot,
} from "@pretable-internal/grid-core";

export interface DomRenderInput<
  TRow extends GridCoreRow = GridCoreRow,
> {
  columns: GridCoreColumn<TRow>[];
  snapshot: GridCoreSnapshot<TRow>;
  scrollTop: number;
  viewportHeight: number;
  overscan: number;
  measuredHeights?: Record<string, number>;
}

export interface DomRenderRow<
  TRow extends GridCoreRow = GridCoreRow,
> {
  id: string;
  row: TRow;
  rowIndex: number;
  top: number;
  height: number;
}

export interface DomRenderSnapshot<
  TRow extends GridCoreRow = GridCoreRow,
> {
  frame: GridCoreFrame<TRow>;
  rows: DomRenderRow<TRow>[];
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
}
