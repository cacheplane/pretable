import {
  numberFormats,
  PretableBadge,
  PretableDelta,
  PretableEntity,
  PretableStatus,
  type PretableColumn,
} from "@pretable/react";

/**
 * Compile-time fixture for the code fences on `grid/cell-presentations.mdx`.
 *
 * Each `// docs-fence:` marker below binds everything up to the next marker to
 * one fence on that page, and `docs-api-surface.test.ts` holds the two
 * together. Everything above the first marker is the shared preamble: the four
 * fences each import what they use, and one file cannot repeat an import
 * statement four times.
 */

interface Position extends Record<string, unknown> {
  id: string;
  symbol: string;
  name: string;
  dayPnl: number;
  settled: boolean;
  settlementState: string;
  flag: "risk" | "watch";
}

// docs-fence: grid/cell-presentations.mdx#PretableDelta
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

// docs-fence: grid/cell-presentations.mdx#PretableStatus
export const settlementColumn: PretableColumn<Position> = {
  id: "settlementState",
  header: "Settlement",
  render: ({ row }) => (
    <PretableStatus tone={row.settled ? "positive" : "warning"}>
      {row.settlementState}
    </PretableStatus>
  ),
};

// docs-fence: grid/cell-presentations.mdx#PretableBadge
export const flagColumn: PretableColumn<Position> = {
  id: "flag",
  header: "Flag",
  render: ({ row }) => (
    <PretableBadge tone={row.flag === "risk" ? "negative" : "warning"}>
      {row.flag}
    </PretableBadge>
  ),
};

// docs-fence: grid/cell-presentations.mdx#PretableEntity
export const symbolColumn: PretableColumn<Position> = {
  id: "symbol",
  header: "Position",
  render: ({ row }) => (
    <PretableEntity primary={row.symbol} secondary={row.name} />
  ),
};
