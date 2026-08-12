import {
  numberFormats,
  PretableBadge,
  PretableDelta,
  PretableEntity,
  PretableStatus,
  type PretableColumn,
} from "@pretable/react";

interface Position extends Record<string, unknown> {
  id: string;
  symbol: string;
  name: string;
  dayPnl: number;
  settled: boolean;
  settlementState: string;
  flag: "risk" | "watch";
}

/** Compile-time fixture for the `PretableDelta` example on the cell presentations page. */
export const deltaColumns: PretableColumn<Position>[] = [
  {
    id: "dayPnl",
    header: "Day P&L",
    numberFormat: numberFormats.money({
      currency: "USD",
      signDisplay: "always",
    }),
    render: ({ row, formattedValue }) => (
      <PretableDelta value={row.dayPnl}>{formattedValue}</PretableDelta>
    ),
  },
];

/** Compile-time fixture for the `PretableStatus` example on the cell presentations page. */
export const settlementColumn: PretableColumn<Position> = {
  id: "settlementState",
  header: "Settlement",
  render: ({ row }) => (
    <PretableStatus tone={row.settled ? "positive" : "warning"}>
      {row.settlementState}
    </PretableStatus>
  ),
};

/** Compile-time fixture for the `PretableBadge` example on the cell presentations page. */
export const flagColumn: PretableColumn<Position> = {
  id: "flag",
  header: "Flag",
  render: ({ row }) => (
    <PretableBadge tone={row.flag === "risk" ? "negative" : "warning"}>
      {row.flag}
    </PretableBadge>
  ),
};

/** Compile-time fixture for the `PretableEntity` example on the cell presentations page. */
export const symbolColumn: PretableColumn<Position> = {
  id: "symbol",
  header: "Position",
  render: ({ row }) => (
    <PretableEntity primary={row.symbol} secondary={row.name} />
  ),
};
