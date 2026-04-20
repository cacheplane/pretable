export type PretableRow = Record<string, unknown>;
export type {
  GridCoreFocusState as PretableFocusState,
  GridCoreRowModel as PretableVisibleRow,
  GridCoreSelectionState as PretableSelectionState,
  GridCoreSnapshot as PretableGridSnapshot,
  GridCoreSortDirection as PretableSortDirection,
  GridCoreSortState as PretableSortState,
  GridCoreViewportState as PretableViewportState,
} from "@pretable-internal/grid-core";
import type {
  GridCoreColumn,
  GridCoreOptions,
  GridCoreSnapshot,
  GridCoreSortDirection,
  GridCoreStore,
} from "@pretable-internal/grid-core";

export type PretableColumn<TRow extends PretableRow = PretableRow> =
  GridCoreColumn<TRow>;

export type PretableGridOptions<TRow extends PretableRow = PretableRow> =
  GridCoreOptions<TRow>;

export interface PretableGrid<
  TRow extends PretableRow = PretableRow,
> extends Omit<GridCoreStore<TRow>, "options"> {
  kind: "pretable-grid";
  options: PretableGridOptions<TRow>;
  getSnapshot(): GridCoreSnapshot<TRow>;
  setSort(columnId: string | null, direction: GridCoreSortDirection): void;
}
