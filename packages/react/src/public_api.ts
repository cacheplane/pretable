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

// Cell presentations. Unlike the icon set — which is internal, because it is
// this grid's own chrome — these ARE for consumers: they are the markup half of
// the presentation rules in @pretable/ui's grid.css, and a consumer who
// hand-rolled the same data attributes would be writing against a contract that
// only these components are tested to keep.
export { PretableDelta, PretableStatus } from "./cells";
export type {
  PretableDeltaDirection,
  PretableDeltaProps,
  PretableStatusProps,
  PretableStatusTone,
} from "./cells";

// Hooks
export { usePretable } from "./use-pretable";

// Component prop / message / config types
export type { PretableProps } from "./pretable";
export type {
  PretableRowActivateInput,
  PretableSurfaceHeaderCellInput,
  PretableSurfaceHeaderCellRenderInput,
  PretableSurfaceMessages,
  PretableSurfaceProps,
  PretableSurfaceRowInput,
  RowSelectionColumnConfig,
} from "./pretable-surface";
export type { PretableBodyStateKind, PretableDataState } from "./data-state";
export type {
  LabeledGridSurfaceFormatValueInput,
  LabeledGridSurfaceProps,
} from "./labeled-grid-surface";

// Render-snapshot geometry. Declared in @pretable-internal/layout-core, which
// is bundled into this package's `dist` — so these are only nameable if this
// entry point re-exports them, and `PretableRenderSnapshot` puts both in a
// public signature.
export type {
  PlannedColumn,
  RowMetricsReader,
} from "@pretable-internal/renderer-dom";

// Hook input + output shapes
export type {
  PretableModel,
  PretableRenderDataRow,
  PretableRenderGroupRow,
  PretableRenderRow,
  PretableRenderRowGeometry,
  PretableRenderSnapshot,
  PretableSurfaceState,
  PretableTelemetry,
  UsePretableOptions,
} from "./use-pretable";

// React-extended column type + render-input shapes
export type {
  PretableCellRenderInput,
  PretableColumn,
  PretableEditorInput,
  PretableFormatInput,
  PretableHeaderRenderInput,
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
export { numberFormats } from "@pretable/core";
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
  PretableCellAddress,
  PretableCellRange,
  PretableCurrencyFormatOptions,
  PretableDataRow,
  PretableEditInput,
  PretableEditState,
  PretableEditStatus,
  PretableFocusDirection,
  PretableFocusState,
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableGroupColumnOptions,
  PretableGroupRow,
  PretableMatchingTotal,
  PretableMoveFocusOptions,
  PretableProcessingAuthority,
  PretableProcessingOptions,
  PretableResultMeta,
  PretableRow,
  PretableRowRange,
  PretableSelectionState,
  PretableSortDirection,
  PretableSortEntry,
  PretableTransaction,
  PretableViewportState,
  PretableVisibleRow,
} from "@pretable/core";

// This package's `PretableColumn` extends the engine's, so the base sits in a
// public `extends` clause. Re-exported under the name this package's own
// sources already use for it, since `PretableColumn` here means the extended
// React column.
export type { PretableColumn as PretableBaseColumn } from "@pretable/core";

// Internal-but-exported (ɵ-prefix marks these as not API-stable)
export { useResolvedHeights as ɵuseResolvedHeights } from "./density";
export { measureRenderedRowHeight as ɵmeasureRenderedRowHeight } from "./row-height";
export { ROW_SELECT_COLUMN_ID as ɵROW_SELECT_COLUMN_ID } from "./constants";
