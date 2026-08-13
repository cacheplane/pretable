import type { PretableColumn } from "@pretable/react";

import type { Row } from "./data";

// Plain `PretableColumn<Row>[]`, not `createColumnHelper` + `as const`: the
// helper's literal column-id tuple narrows the controlled `state.selection`
// prop to `PretableSurfaceSelectionState<string, typeof columns>`, whose
// `columnId` is a literal union — incompatible with the broad
// `startColumnId: string` on `PretableCellRange` from `@pretable/core`, the
// type this page's "Selection model" section teaches importing directly.
// Confirmed via `tsc`, not assumed; see the range-selection task report.
export const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", widthPx: 160, value: (r) => r.name },
  { id: "city", header: "City", widthPx: 130, value: (r) => r.city },
  { id: "region", header: "Region", widthPx: 90, value: (r) => r.region },
  { id: "status", header: "Status", widthPx: 90, value: (r) => r.status },
];
