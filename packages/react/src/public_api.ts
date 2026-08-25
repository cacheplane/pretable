/**
 * Public API of `@pretable/react`. Hand-curated re-exports — do not edit
 * `index.ts` directly. Internal symbols stay in their source files and are
 * re-exported here under the `ɵ`-prefix when other `@pretable/*` packages
 * (or future internal hooks) need them.
 *
 * @packageDocumentation
 */

// Components
export { Pretable } from "./pretable";
export { PretableSurface } from "./pretable-surface";
export { LabeledGridSurface } from "./labeled-grid-surface";

export {
  PretableBadge,
  PretableDelta,
  PretableEntity,
  PretableStatus,
} from "./cells";
export type {
  PretableBadgeProps,
  PretableBadgeTone,
  PretableDeltaDirection,
  PretableDeltaProps,
  PretableEntityProps,
  PretableStatusProps,
  PretableStatusTone,
} from "./cells";

// Hooks
export { usePretable } from "./use-pretable";
export { useLocalRowModel } from "./use-local-row-model";
export { usePretableColumns } from "./use-pretable-columns";
export { useDisposeOnUnmount } from "./use-dispose-on-unmount";

// Component prop / message / config types
export type { PretableBaseProps, PretableProps } from "./pretable";
export type { PretableDisposable } from "./use-dispose-on-unmount";
export type {
  PretableRowActivateInput,
  PretableSurfaceBodyCellInput,
  PretableSurfaceBodyCellInputForColumn,
  PretableSurfaceColumn,
  PretableSurfaceGrid,
  PretableSurfaceHeaderCellInput,
  PretableSurfaceHeaderCellRenderInput,
  PretableSurfaceMessages,
  PretableSurfaceModelProps,
  PretableSurfaceProps,
  PretableSurfaceQueryColumns,
  PretableSurfaceRowChange,
  PretableSurfaceRowsProps,
  PretableSurfaceRowInput,
  PretableSurfaceSharedProps,
  PretableSurfaceSyntheticColumnId,
  PretableToolPanelConfig,
  RowSelectionColumnConfig,
} from "./pretable-surface";
export type { ToolPanelSectionId } from "./tool-panel";
export type { PretableBodyStateKind, PretableDataState } from "./data-state";
export type {
  LabeledGridSurfaceBaseProps,
  LabeledGridSurfaceFormatValueInput,
  LabeledGridSurfaceProps,
} from "./labeled-grid-surface";

// Hook input + output shapes
export type {
  PretableCellAddressFor,
  PretableCellRangeFor,
  PretableConventionalRowId,
  PretableExactModelPresentationColumns,
  PretableModel,
  PretableQueryOptions,
  PretableRowForColumns,
  PretableRowsModeBaseOptions,
  PretableSelectionFor,
  PretableSurfaceColumnId,
  PretableSurfaceFocusState,
  PretableSurfaceInteractionColumnId,
  PretableSurfaceState,
  PretableTelemetry,
  PretableViewportOptions,
  UsePretableModelOptions,
  UsePretableRowsOptions,
  UsePretableRowsWithIdOptions,
} from "./use-pretable";
export type {
  UseLocalRowModelOptions,
  UseLocalRowModelWithDefaultIdOptions,
} from "./use-local-row-model";
export type {
  PretableGridUiSnapshot,
  PretableIndexedRenderSnapshot,
  PretableReactGrid,
} from "./pretable-model";

// React-extended column type + render-input shapes
export type {
  PretableCellRenderInput,
  PretableColumn,
  PretableColumnEditInput,
  PretableColumnEditablePredicate,
  PretableColumnFactoryOptions,
  PretableEditorInput,
  PretableEditInput,
  PretableEffectiveColumn,
  PretableFormatInput,
  PretableHeaderRenderInput,
  PretableColumnPresentation,
  PretableColumnPresentationOptions,
  PretableColumnRow,
  PretableColumnRowId,
  PretableColumnValue,
  PretableColumnVisualPresentation,
  PretableEditableColumnRequirement,
  PretableRowIdRequirement,
  PretablePresentationColumns,
  PretablePresentationEditRequirement,
  PretableReactColumnDefinition,
  PretableReactColumnContext,
  PretableReactColumnTypeFor,
  PretableReactColumns,
  PretableRowChange,
  PretableSetValueInput,
} from "./types";

// Copy / clipboard
export { defaultCoerceForCopy, serializeRanges } from "./copy";
export type { CopyPayload, SerializeRangesArgs } from "./copy";
export { serializeCsv } from "./csv";
export type {
  PretableCsvFile,
  PretableCsvOmission,
  PretableCsvOptions,
  PretableExportScope,
  PretableFormulaEscapeInput,
  PretableFormulaEscapePredicate,
  SerializeCsvArgs,
} from "./csv";
export { resolveDataScope } from "./data-scope";
export type { DataHonestyInput } from "./data-scope";
export { buildExportFileName, defaultSaveFile, toCsvBlob } from "./save-file";
export type { BuildExportFileNameArgs, SaveFileOptions } from "./save-file";

// Paste (mapPasteToTargets stays internal)
export { parseTsv } from "./paste";
export type { PastedCell, PastePayload, RejectedPasteCell } from "./paste";

// Density (canonical home is @pretable/ui)
export type { DensityHeights } from "@pretable/ui";

// Re-exports from @pretable/core (the engine types react users typically
// touch — full headless surface lives in @pretable/core)
export { describeRowSelection, numberFormats } from "@pretable/core";
export type {
  AutosizeOptions,
  ColumnAlign,
  ColumnIdOf,
  ColumnFilter,
  ColumnValueOf,
  ColumnsOf,
  CreateLocalRowModelOptions,
  CreateLocalRowModelWithDefaultIdOptions,
  CreateGridUiCoreOptions,
  FilterOperator,
  ColumnOption,
  ColumnType,
  FilterValue,
  PretableAggregateSpec,
  PretableAggregateFormatInput,
  PretableAggregateOutputOf,
  PretableAggregatesFor,
  PretableAggregator,
  PretableBuiltinAggregate,
  PretableCellAddress,
  PretableCellRange,
  PretableCurrencyFormatOptions,
  PretableColumnAccessorKind,
  PretableColumnDefinition,
  PretableColumnDerivation,
  PretableColumnType,
  PretableCompatibleAggregator,
  PretableCompatibleAggregateSpec,
  PretableChangeOperation,
  PretableChangeSequence,
  PretableChangeSet,
  PretableDataRow,
  PretableDerivationsFor,
  PretableDerivationTransition,
  PretableDistinctColumnIdOf,
  PretableDistinctValueOptions,
  PretableDistinctValueQuery,
  PretableDistinctValueResult,
  PretableEditState,
  PretableEditStatus,
  PretableFocusDirection,
  PretableFocusState,
  PretableFilterFor,
  PretableFilterOperandFor,
  PretableHeaderRowRef,
  PretableGridUiColumn,
  PretableGridUiColumnLayout,
  PretableGridUiCore,
  PretableGridUiState,
  PretableGroupRow,
  PretableGroupColumnOptions,
  PretableGroupKey,
  PretableGroupId,
  PretableMoveFocusOptions,
  PretableMatchingTotal,
  PretableOpenEditStatus,
  PretableProcessingAuthority,
  PretableProcessingOptions,
  PretableResultMeta,
  PretableQueryFor,
  PretableQueryTransition,
  PretableRowId,
  PretableRowModel,
  PretableRowModelError,
  PretableRowModelErrorCode,
  PretableRowModelErrorContext,
  PretableRowModelOperation,
  PretableRowModelState,
  PretableRowModelSnapshot,
  PretableRowModelStatus,
  PretableRowRange,
  PretableRowGroupFor,
  PretableRowSelectionState,
  PretableRowUpdate,
  PretableSelectionState,
  PretableRow,
  PretableSortEntry,
  PretableSortDirection,
  PretableSortFor,
  PretableTransaction,
  PretableExpansionDefault,
  PretableExpansionState,
  PretableMutationResult,
  PretableMutationIssue,
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
  PretableVisibleRowRef,
  Prettify,
  PretableUninferredColumnValue,
  PretableViewportState,
  PretableVisibleRow,
  PretableVisibleRowField,
  RowIdOf,
  RowOf,
} from "@pretable/core";

// Core's column format input shares the historical React alias name.
export type { PretableFormatInput as PretableCoreFormatInput } from "@pretable/core";

// Internal-but-exported (ɵ-prefix marks these as not API-stable)
export { useResolvedHeights as ɵuseResolvedHeights } from "./density";
// Named by ɵuseResolvedHeights's signature, so it has to ship with it —
// `scripts/__tests__/public-api-forgotten-exports.test.mjs` fails otherwise.
export type { DensityScopeRef as ɵDensityScopeRef } from "./density";
export { measureRenderedRowHeight as ɵmeasureRenderedRowHeight } from "./row-height";
export { ROW_SELECT_COLUMN_ID as ɵROW_SELECT_COLUMN_ID } from "./constants";
// Named by `CreateGridUiCoreOptions.getWindowing`'s signature, which this
// package re-exports from `@pretable/core`, so both have to ship with it here
// too.
export type {
  ɵPretableIndexedSelectionWindow,
  ɵPretableIndexedWindowing,
} from "@pretable/core";
