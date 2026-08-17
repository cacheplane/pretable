/**
 * Public API of `@pretable/core`. Hand-curated re-exports — do not edit
 * `index.ts` directly. Internal symbols stay in their source files and
 * are not re-exported here.
 *
 * @packageDocumentation
 */

export { createGrid } from "./create-grid";
export { createColumnHelper } from "./create-column-helper";
export { createLocalRowModel } from "./create-local-row-model";
export { numberFormats } from "./number-formats";
export type { PretableCurrencyFormatOptions } from "./number-formats";
export {
  PretableDisposedModelError,
  PretableInvalidGroupKeyError,
  PretableReentrantMutationError,
  PretableRowIdentityChangeError,
  PretableRowModelError,
  PretableTransitionCancelledError,
  PretableUnsupportedRowUpdateError,
} from "@pretable-internal/row-model";
export {
  describeRowSelection,
  GROUP_COLUMN_ID,
} from "@pretable-internal/grid-core";

export type {
  AutosizeOptions,
  ColumnFilter,
  ColumnAggregateValueOf,
  ColumnIdOf,
  FilterOperator,
  ColumnOption,
  ColumnAlign,
  ColumnType,
  CreateGridUiCoreOptions,
  FilterValue,
  ColumnValueOf,
  ColumnsOf,
  CreateLocalRowModelOptions,
  CreateLocalRowModelWithDefaultIdOptions,
  PretableAggregateFormatInput,
  PretableAggregateOutputOf,
  PretableAggregateSpec,
  PretableAggregator,
  PretableAggregatesFor,
  PretableBuiltinAggregate,
  PretableChangeOperation,
  PretableChangeSequence,
  PretableChangeSet,
  PretableGroupColumnOptions,
  PretableCellAddress,
  PretableCellRange,
  PretableColumn,
  PretableColumnAccessorKind,
  PretableColumnCallbackContext,
  PretableColumnDefinition,
  PretableColumnDerivation,
  PretableColumnHelper,
  PretableColumnOptions,
  PretableColumnType,
  PretableColumnTypeFor,
  PretableCompatibleAggregateSpec,
  PretableCompatibleAggregator,
  PretableDataRow,
  PretableDerivationTransition,
  PretableDerivationsFor,
  PretableDistinctColumnIdOf,
  PretableDistinctValueOptions,
  PretableDistinctValueQuery,
  PretableDistinctValueResult,
  PretableEditInput,
  PretableEditState,
  PretableEditStatus,
  PretableExpansionDefault,
  PretableExpansionState,
  PretableFilterFor,
  PretableFilterOperandFor,
  PretableFocusDirection,
  PretableFocusState,
  PretableFormatInput,
  PretableGroupRow,
  PretableGroupId,
  PretableGroupKey,
  PretableMatchingTotal,
  PretableMoveFocusOptions,
  PretableMutationIssue,
  PretableMutationResult,
  PretableQueryFor,
  PretableQueryTransition,
  PretableProcessingAuthority,
  PretableProcessingOptions,
  PretableResultMeta,
  PretableRow,
  PretableRowGroupFor,
  PretableRowId,
  PretableRowModel,
  PretableRowModelErrorCode,
  PretableRowModelErrorContext,
  PretableRowModelOperation,
  PretableRowModelSnapshot,
  PretableRowModelState,
  PretableRowModelStatus,
  PretableRowUpdate,
  PretableRowRange,
  PretableRowSelectionState,
  PretableSelectionState,
  PretableSortDirection,
  PretableSortEntry,
  PretableSortFor,
  PretableTransaction,
  PretableTransitionCancellationReason,
  PretableViewportState,
  PretableHeaderRowRef,
  PretableGridUiColumn,
  PretableGridUiColumnLayout,
  PretableGridUiCore,
  PretableGridUiState,
  PretableIndexedCellAddress,
  PretableIndexedCellRange,
  PretableIndexedCellSelectionSummary,
  PretableIndexedDatasetRowSpan,
  PretableIndexedEditingState,
  PretableIndexedFocusMovement,
  PretableIndexedFocusRef,
  PretableIndexedFocusState,
  PretableIndexedRowRange,
  PretableIndexedRowRangeIndex,
  PretableIndexedRowSelection,
  PretableIndexedSelectionState,
  PretableIndexedSelectionSummary,
  PretableVisibleRow,
  PretableVisibleRowField,
  PretableVisibleRowRef,
  Prettify,
  RowIdOf,
  RowOf,
} from "./types";

// Internal-but-exported (ɵ-prefix marks these as not API-stable)
// Named by `CreateGridUiCoreOptions.getSelectionWindow`'s signature, so it has
// to ship with it — `scripts/__tests__/public-api-forgotten-exports.test.mjs`
// fails otherwise. The option is `@internal`: the loaded span is how the engine
// tells an evicted row from a deleted one, and `@pretable/react` is the only
// caller that knows whether the honesty gate has passed.
export type { PretableIndexedSelectionWindow as ɵPretableIndexedSelectionWindow } from "@pretable-internal/grid-core";
// Named by `CreateGridUiCoreOptions.getWindowing`'s signature, so it ships
// alongside the window type it wraps.
export type { PretableIndexedWindowing as ɵPretableIndexedWindowing } from "@pretable-internal/grid-core";
// Re-declares who selected the loaded records on a model this package created.
// Exported because `processing` is a render-time prop on `@pretable/react`, so
// the authority a rows-mode model is built with can change while it is alive,
// and react cannot reach the row model package directly without duplicating the
// registry this reads. Not for consumer models — see the function's own doc.
export { ɵsetLocalRowModelFilterAuthority } from "@pretable-internal/row-model";
