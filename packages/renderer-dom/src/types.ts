import type {
  GridCoreColumn,
  GridCoreFrame,
  GridCoreRow,
  GridCoreSnapshot,
} from "@pretable-internal/grid-core";
import type { PlannedColumn } from "@pretable-internal/layout-core";

export interface DomRenderInput<TRow extends GridCoreRow = GridCoreRow> {
  columns: GridCoreColumn<TRow>[];
  snapshot: GridCoreSnapshot<TRow>;
  scrollTop: number;
  scrollLeft?: number;
  viewportHeight: number;
  viewportWidth?: number;
  overscan: number;
  measuredHeights?: Record<string, number>;
}

export interface DomRenderRow<TRow extends GridCoreRow = GridCoreRow> {
  id: string;
  row: TRow;
  rowIndex: number;
  top: number;
  height: number;
}

export interface DomRenderSnapshot<TRow extends GridCoreRow = GridCoreRow> {
  frame: GridCoreFrame<TRow>;
  rows: DomRenderRow<TRow>[];
  columns: PlannedColumn[];
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
}
