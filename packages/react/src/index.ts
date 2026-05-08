// Components
export { Pretable } from "./pretable";
export { PretableSurface } from "./pretable-surface";
export { InspectionGrid } from "./inspection-grid";
export { LabeledGridSurface } from "./labeled-grid-surface";

// Hooks
export { usePretable } from "./use-pretable";
export { useResolvedHeights } from "./density";

// Helpers
export { measureRenderedRowHeight } from "./row-height";

// Component prop types
export type { PretableProps } from "./pretable";
export type {
  PretableSurfaceMessages,
  PretableSurfaceProps,
  RowSelectionColumnConfig,
} from "./pretable-surface";
export { ROW_SELECT_COLUMN_ID } from "./pretable-surface";

// Copy / clipboard
export { defaultCoerceForCopy, serializeRangesAsTsv } from "./copy";
export type { CopyPayload, SerializeRangesArgs } from "./copy";
export type { InspectionGridProps } from "./inspection-grid";
export type {
  LabeledGridSurfaceFormatValueInput,
  LabeledGridSurfaceProps,
} from "./labeled-grid-surface";

// Hook + model types
export type {
  PretableModel,
  PretableRenderRow,
  PretableRenderSnapshot,
  PretableSurfaceState,
  PretableTelemetry,
  UsePretableOptions,
} from "./use-pretable";

// Density
export type { DensityHeights } from "./density";

// Re-exports from @pretable/core
export type {
  PretableColumn as PretableCoreColumn,
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableRow,
} from "@pretable/core";

// React-extended column type + render-input shapes
export type {
  PretableCellRenderInput,
  PretableColumn,
  PretableFormatInput,
  PretableHeaderRenderInput,
} from "./types";
