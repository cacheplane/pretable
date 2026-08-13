import type { PretableColumn } from "@pretable/react";

import type { Instrument } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

// Plain `PretableColumn<Instrument>[]`, not `createColumnHelper` + `as const`:
// pin, order, and widths are all owned by this demo's own controlled state
// below rather than by the column declarations, so nothing here needs the
// helper's literal column-id tuple.
export const columns: PretableColumn<Instrument>[] = [
  { id: "symbol", header: "Symbol", widthPx: 90, minWidthPx: 60 },
  { id: "name", header: "Name", widthPx: 160 },
  { id: "sector", header: "Sector", widthPx: 120 },
  {
    id: "price",
    header: "Price",
    type: "number",
    widthPx: 90,
    format: ({ value }) => usd.format(value as number),
  },
  { id: "note", header: "Note", widthPx: 160, minWidthPx: 100 },
];
