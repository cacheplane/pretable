/**
 * Public API of `@pretable/core`. Hand-curated re-exports — do not edit
 * `index.ts` directly. Internal symbols stay in their source files and
 * are not re-exported here.
 *
 * @packageDocumentation
 */

export { createGrid } from "./create-grid";
export type { PretableGrid } from "./pretable-grid";
export { numberFormats } from "./number-formats";
export type { PretableCurrencyFormatOptions } from "./number-formats";
export { GROUP_COLUMN_ID } from "@pretable-internal/grid-core";

export type {
  AutosizeOptions,
  ColumnFilter,
  FilterOperator,
  ColumnOption,
  ColumnAlign,
  ColumnType,
  FilterValue,
  PretableAggregateFormatInput,
  PretableAggregateSpec,
  PretableAggregator,
  PretableGroupColumnOptions,
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
  PretableMatchingTotal,
  PretableMoveFocusOptions,
  PretableProcessingAuthority,
  PretableProcessingOptions,
  PretableResultMeta,
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
