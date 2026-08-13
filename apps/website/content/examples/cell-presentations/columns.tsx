import {
  numberFormats,
  PretableBadge,
  PretableDelta,
  PretableEntity,
  PretableStatus,
  type PretableColumn,
} from "@pretable/react";

import type { Position } from "./data";

export const columns: PretableColumn<Position>[] = [
  {
    id: "symbol",
    header: "Position",
    widthPx: 170,
    render: ({ row }) => (
      <PretableEntity primary={row.symbol} secondary={row.name} />
    ),
  },
  {
    id: "dayPnl",
    header: "Day P&L",
    type: "number",
    widthPx: 130,
    numberFormat: numberFormats.money({
      currency: "USD",
      signDisplay: "always",
    }),
    render: ({ row, formattedValue }) => (
      <PretableDelta value={row.dayPnl}>{formattedValue}</PretableDelta>
    ),
  },
  {
    id: "settlementState",
    header: "Settlement",
    widthPx: 130,
    render: ({ row }) => (
      <PretableStatus tone={row.settled ? "positive" : "warning"}>
        {row.settlementState}
      </PretableStatus>
    ),
  },
  {
    id: "flag",
    header: "Flag",
    widthPx: 90,
    render: ({ row }) => (
      <PretableBadge tone={row.flag === "risk" ? "negative" : "warning"}>
        {row.flag}
      </PretableBadge>
    ),
  },
];
