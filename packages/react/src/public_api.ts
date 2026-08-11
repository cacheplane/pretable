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
export { InspectionGrid } from "./inspection-grid";
export { LabeledGridSurface } from "./labeled-grid-surface";

// Hooks
export { usePretable } from "./use-pretable";
export { useLocalRowModel } from "./use-local-row-model";
export { usePretableColumns } from "./use-pretable-columns";

// Component prop / message / config types
export type { PretableProps } from "./pretable";
export type {
  PretableRowActivateInput,
  PretableSurfaceMessages,
  PretableSurfaceProps,
  RowSelectionColumnConfig,
} from "./pretable-surface";
export type { InspectionGridProps } from "./inspection-grid";
export type {
  LabeledGridSurfaceFormatValueInput,
  LabeledGridSurfaceProps,
} from "./labeled-grid-surface";

// Hook input + output shapes
export type {
  PretableControlledQueryOptions,
  PretableConventionalRowId,
  PretableModel,
  PretableRowForColumns,
  PretableRowsModeBaseOptions,
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
} from "./use-indexed-pretable";

// React-extended column type + render-input shapes
export type {
  PretableCellRenderInput,
  PretableColumn,
  PretableEditorInput,
  PretableFormatInput,
  PretableHeaderRenderInput,
  PretableColumnPresentation,
  PretableColumnRow,
  PretableColumnValue,
  PretableEditableColumnRequirement,
  PretablePresentationColumns,
  PretablePresentationEditRequirement,
  PretableReactColumns,
  PretableRowChange,
  PretableSetValueInput,
} from "./types";

// Copy / clipboard
export { defaultCoerceForCopy, serializeRanges } from "./copy";
export type { CopyPayload, SerializeRangesArgs } from "./copy";

// Paste (mapPasteToTargets stays internal)
export { parseTsv } from "./paste";
export type { PastedCell, PastePayload, RejectedPasteCell } from "./paste";

// Density (canonical home is @pretable/ui)
export type { DensityHeights } from "@pretable/ui";

// Re-exports from @pretable/core (the engine types react users typically
// touch — full headless surface lives in @pretable/core)
export type {
  AutosizeOptions,
  ColumnIdOf,
  ColumnFilter,
  ColumnValueOf,
  ColumnsOf,
  CreateLocalRowModelOptions,
  CreateLocalRowModelWithDefaultIdOptions,
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
  PretableEditInput,
  PretableEditState,
  PretableEditStatus,
  PretableFocusDirection,
  PretableFocusState,
  PretableFilterFor,
  PretableFilterOperandFor,
  PretableGrid,
  PretableGridDataRow,
  PretableGridGroupRow,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableGridTransaction,
  PretableGridVisibleRow,
  PretableGroupRow,
  PretableGroupColumnOptions,
  PretableGroupKey,
  PretableGroupId,
  PretableMoveFocusOptions,
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
  PretableRowUpdate,
  PretableSelectionState,
  PretableRow,
  PretableSortEntry,
  PretableSortFor,
  PretableTransaction,
  PretableExpansionDefault,
  PretableExpansionState,
  PretableMutationResult,
  PretableMutationIssue,
  PretableVisibleRowRef,
  Prettify,
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
export { measureRenderedRowHeight as ɵmeasureRenderedRowHeight } from "./row-height";
export { ROW_SELECT_COLUMN_ID as ɵROW_SELECT_COLUMN_ID } from "./constants";
