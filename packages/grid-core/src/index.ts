import type { LayoutSpan } from "@pretable-internal/layout-core";
import type { PreparedTextRecord } from "@pretable-internal/text-core";

export interface GridCoreFrame {
  text: PreparedTextRecord;
  layout: LayoutSpan;
}
