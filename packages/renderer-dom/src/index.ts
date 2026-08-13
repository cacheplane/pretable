export { createDomRenderSnapshot, planColumnLayout } from "./create-renderer";
export { createRowLayoutController } from "./row-layout-controller";
export type {
  CreateRowLayoutControllerOptions,
  DomLayoutColumn,
  IndexedDomRenderDataRow,
  IndexedDomRenderGroupRow,
  IndexedDomRenderInput,
  IndexedDomRenderRow,
  IndexedDomRenderRowGeometry,
  IndexedDomRenderSnapshot,
  RowBoxMetrics,
  RowLayoutController,
  RowLayoutControllerState,
  RowLayoutControllerStatus,
  RowLayoutScheduler,
  RowLayoutViewport,
  RowLayoutWindowRow,
  SegmentMeasurer,
} from "./types";
export { RowLayoutControllerError } from "./types";
export type {
  ColumnPlan,
  PlannedColumn,
  RowMetricsReader,
} from "@pretable-internal/layout-core";
// Re-exported for @pretable/react, whose only window onto layout-core is this
// package (see the PlannedColumn / RowMetricsReader types above). The scroll
// math is pure and DOM-free; it lives here purely so the dependency graph stays
// react -> renderer-dom -> layout-core.
export {
  scrollLeftToReveal,
  scrollTopToReveal,
} from "@pretable-internal/layout-core";
