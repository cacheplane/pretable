import { numberFormats, type PretableColumn } from "@pretable/react";

import type { Order } from "./data";

export const columns: PretableColumn<Order>[] = [
  { id: "region", header: "Region" },
  { id: "channel", header: "Channel" },
  {
    id: "revenue",
    header: "Revenue",
    type: "number",
    aggregate: "sum",
    numberFormat: numberFormats.money({ currency: "USD" }),
  },
  {
    id: "refunds",
    header: "Refunds",
    type: "number",
    aggregate: "sum",
    numberFormat: numberFormats.accounting({ currency: "USD" }),
  },
  {
    id: "marginPct",
    header: "Margin",
    type: "number",
    aggregate: "avg",
    numberFormat: { style: "percent", maximumFractionDigits: 1 },
  },
];
