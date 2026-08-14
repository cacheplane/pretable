import { createColumnHelper } from "@pretable/core";

import type { Row } from "./data";

// `createColumnHelper` + `as const` — the idiom the "Selection model" section
// on this page teaches — produces a `readonly` literal-id column tuple. That
// tuple is what narrows the controlled `state.selection` prop's `columnId` to
// a checked union via `PretableSelectionFor<typeof columns>`, rather than the
// broad `startColumnId: string` on `@pretable/core`'s `PretableCellRange`.
const column = createColumnHelper<Row>();

export const columns = [
  column.accessor("name", { type: "text", header: "Name" }),
  column.accessor("city", { type: "text", header: "City" }),
  column.accessor("region", { type: "text", header: "Region" }),
  column.accessor("status", { type: "enum", header: "Status" }),
] as const;
