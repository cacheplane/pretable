/**
 * Public API of `@pretable/core`. Hand-curated re-exports — do not edit
 * `index.ts` directly. Internal symbols stay in their source files and
 * are not re-exported here.
 *
 * @packageDocumentation
 */

export { createGrid } from "./create-grid";
export type { PretableGrid } from "./pretable-grid";

export type {
  AutosizeOptions,
  ColumnFilter,
  FilterOperator,
  ColumnOption,
  ColumnType,
  FilterValue,
  PretableAggregateSpec,
  PretableAggregator,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableDataRow,
  PretableEditInput,
  PretableEditState,
  PretableEditStatus,
  PretableFocusDirection,
  PretableFocusState,
  PretableFormatInput,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableGroupRow,
  PretableMoveFocusOptions,
  PretableRow,
  PretableRowRange,
  PretableRowSelectionTriState,
  PretableSelectionState,
  PretableSortDirection,
  PretableSortEntry,
  PretableTransaction,
  PretableViewportState,
  PretableVisibleRow,
} from "./types";
