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

// Component prop / message / config types
export type { PretableProps } from "./pretable";
export type {
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
  PretableModel,
  PretableRenderRow,
  PretableRenderSnapshot,
  PretableSurfaceState,
  PretableTelemetry,
  UsePretableOptions,
} from "./use-pretable";

// React-extended column type + render-input shapes
export type {
  PretableCellRenderInput,
  PretableColumn,
  PretableFormatInput,
  PretableHeaderRenderInput,
} from "./types";

// Copy / clipboard
export { defaultCoerceForCopy, serializeRangesAsTsv } from "./copy";
export type { CopyPayload, SerializeRangesArgs } from "./copy";

// Density
export type { DensityHeights } from "./density";

// Re-exports from @pretable/core (the engine types react users typically
// touch — full headless surface lives in @pretable/core)
export type {
  PretableGrid,
  PretableGridOptions,
  PretableGridSnapshot,
  PretableRow,
} from "@pretable/core";

// Internal-but-exported (ɵ-prefix marks these as not API-stable)
export { useResolvedHeights as ɵuseResolvedHeights } from "./density";
export { measureRenderedRowHeight as ɵmeasureRenderedRowHeight } from "./row-height";
export { ROW_SELECT_COLUMN_ID as ɵROW_SELECT_COLUMN_ID } from "./constants";
