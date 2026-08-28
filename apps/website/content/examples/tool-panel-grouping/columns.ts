import type { PretableColumn } from "@pretable/react";

import type { Holding } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const count = new Intl.NumberFormat("en-US");

// `marketValue` declares `aggregate: "sum"`, so its picker in the pane opens
// on `Default (Sum)`; `quantity` declares nothing, so its picker opens on
// `Default (None)` — the difference between "the prop's choice" and "an
// override" is the thing the pane makes visible.
export const columns: PretableColumn<Holding>[] = [
  { id: "symbol", header: "Symbol", widthPx: 90 },
  { id: "desk", header: "Desk", type: "enum", widthPx: 110 },
  { id: "sector", header: "Sector", type: "enum", widthPx: 120 },
  {
    id: "quantity",
    header: "Qty",
    type: "number",
    widthPx: 90,
    format: ({ value }) => count.format(value as number),
    // NOT `format`. `PretableFormatInput.row` is non-optional and a group row
    // has no row behind it, so the cell formatter above is not a legal
    // aggregate formatter — this is the hook that is.
    formatAggregate: ({ value }) =>
      typeof value === "number" ? count.format(value) : "",
  },
  {
    id: "marketValue",
    header: "Market value",
    type: "number",
    widthPx: 120,
    aggregate: "sum",
    format: ({ value }) => usd.format(value as number),
    formatAggregate: ({ value }) =>
      typeof value === "number" ? usd.format(value) : "",
  },
];
