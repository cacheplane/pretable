export { createDomRenderSnapshot, planColumnLayout } from "./create-renderer";
export type {
  DomRenderDataRow,
  DomRenderGroupRow,
  DomRenderInput,
  DomRenderRow,
  DomRenderRowGeometry,
  DomRenderSnapshot,
} from "./types";
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
