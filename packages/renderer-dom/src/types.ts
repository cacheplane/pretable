import type {
  PretableColumn,
  PretableFrame,
  PretableRow,
  PretableGridSnapshot,
} from "@pretable-internal/grid-core";
import type { PlannedColumn } from "@pretable-internal/layout-core";

export interface DomRenderInput<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn<TRow>[];
  snapshot: PretableGridSnapshot<TRow>;
  scrollTop: number;
  scrollLeft?: number;
  viewportHeight: number;
  viewportWidth?: number;
  overscan: number;
  measuredHeights?: Record<string, number>;
}

export interface DomRenderRow<TRow extends PretableRow = PretableRow> {
  id: string;
  row: TRow;
  rowIndex: number;
  top: number;
  height: number;
}

export interface DomRenderSnapshot<TRow extends PretableRow = PretableRow> {
  frame: PretableFrame<TRow>;
  rows: DomRenderRow<TRow>[];
  columns: PlannedColumn[];
  nodeCount: number;
  totalHeight: number;
  totalWidth: number;
}
