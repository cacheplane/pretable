import type { PretableColumn } from "@pretable/react";

import type { Position } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const count = new Intl.NumberFormat("en-US");

export const columns: PretableColumn<Position>[] = [
  { id: "desk", header: "Desk" },
  { id: "sector", header: "Sector" },
  { id: "symbol", header: "Symbol" },
  {
    id: "shares",
    header: "Shares",
    type: "number",
    aggregate: "sum",
    format: ({ value }) => count.format(value as number),
    formatAggregate: ({ value }) =>
      typeof value === "number" ? count.format(value) : "",
  },
  {
    id: "marketValue",
    header: "Market value",
    type: "number",
    aggregate: "sum",
    format: ({ value }) => usd.format(value as number),
    formatAggregate: ({ value }) =>
      typeof value === "number" ? usd.format(value) : "",
  },
];
