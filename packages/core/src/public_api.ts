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
  PretableUninferredColumnValue,
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
  PretableIndexedMoveFocusOptions,
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
//
// The indexed UI engine, for `@pretable/react` ONLY. `@pretable/core` already
// bundles `@pretable-internal/grid-core` (`noExternal`), so a react that also
// imports the package directly compiles against a SECOND emission of the same
// declarations and ships a SECOND copy of the engine at runtime. Two emissions
// are two types to TypeScript wherever a declaration is not purely structural —
// nominally for a `unique symbol` brand, and structurally for a deferred
// conditional like `PretableAggregateOutputOf<TAggregate>`, which is compared by
// alias identity while its argument is still generic. That is what the
// `as unknown as` casts in `pretable-model.ts` were paying for. Reaching the
// engine through this re-export gives react one declaration and one runtime
// copy; `CreateGridUiCoreOptions` and `PretableGridUiCore` were already public,
// so this only adds the factory that produces them.
export {
  createGridUiCore as ɵcreateGridUiCore,
  getIndexedCellSelectionSummary as ɵgetIndexedCellSelectionSummary,
  indexedRangeContainsCell as ɵindexedRangeContainsCell,
  HEADER_FOCUS_REF as ɵHEADER_FOCUS_REF,
} from "@pretable-internal/grid-core";

// Named by `CreateGridUiCoreOptions.getSelectionWindow`'s signature, so it has
// to ship with it — `scripts/__tests__/public-api-forgotten-exports.test.mjs`
// fails otherwise. The option is `@internal`: the loaded span is how the engine
// tells an evicted row from a deleted one, and `@pretable/react` is the only
// caller that knows whether the honesty gate has passed.
export type { PretableIndexedSelectionWindow as ɵPretableIndexedSelectionWindow } from "@pretable-internal/grid-core";
