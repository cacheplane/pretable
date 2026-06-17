import type { PretableColumn } from "@pretable/react";

export interface LayoutRow {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  qty: number;
  last: number;
  mktValue: number;
  dayPnl: number;
  weight: number;
  note: string;
}

const mk = (
  symbol: string,
  name: string,
  sector: string,
  qty: number,
  last: number,
  dayPnl: number,
  weight: number,
  note: string,
): LayoutRow => ({
  id: symbol,
  symbol,
  name,
  sector,
  qty,
  last,
  mktValue: Math.round(qty * last),
  dayPnl,
  weight,
  note,
});

export const LAYOUT_ROWS: LayoutRow[] = [
  mk("NVDA", "NVIDIA", "Technology", 12000, 121.4, 18420, 6.4, "Trim into strength"),
  mk("MSFT", "Microsoft", "Technology", 8200, 432.1, -9100, 5.8, "Core hold"),
  mk("AAPL", "Apple", "Technology", 9400, 224.3, 4200, 5.1, "Hold"),
  mk("AMZN", "Amazon", "Consumer", 6100, 186.7, 7300, 4.4, "Add on dips"),
  mk("JPM", "JPMorgan", "Financials", 7300, 211.9, -2600, 4.1, "Watch rates"),
  mk("LLY", "Eli Lilly", "Health Care", 2100, 812.5, 15800, 3.9, "Hold"),
  mk("XOM", "Exxon Mobil", "Energy", 9800, 112.6, -3300, 3.2, "Trim"),
  mk("UNH", "UnitedHealth", "Health Care", 1900, 528.4, 2100, 3.0, "Hold"),
  mk("V", "Visa", "Financials", 4200, 289.1, 1500, 2.8, "Core hold"),
  mk("CVX", "Chevron", "Energy", 5600, 158.2, -1200, 2.3, "Watch"),
  mk("HD", "Home Depot", "Consumer", 2400, 392.7, 3600, 2.1, "Hold"),
  mk("PFE", "Pfizer", "Health Care", 14500, 28.4, -900, 1.1, "Under review"),
];

export function makeLayoutColumns(): PretableColumn<LayoutRow>[] {
  const usd = (n: number) =>
    `$${Math.round(n).toLocaleString("en-US")}`;
  const signedUsd = (n: number) =>
    `${n < 0 ? "-" : "+"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
  return [
    { id: "symbol", header: "Symbol", widthPx: 110, value: (r) => r.symbol },
    { id: "sector", header: "Sector", widthPx: 130, value: (r) => r.sector },
    {
      id: "qty",
      header: "Qty",
      widthPx: 96,
      value: (r) => r.qty,
      format: ({ value }) => (value as number).toLocaleString("en-US"),
    },
    {
      id: "last",
      header: "Last",
      widthPx: 96,
      value: (r) => r.last,
      format: ({ value }) => usd(value as number),
    },
    {
      id: "mktValue",
      header: "Mkt Value",
      widthPx: 120,
      value: (r) => r.mktValue,
      format: ({ value }) => usd(value as number),
    },
    {
      id: "dayPnl",
      header: "Day P&L",
      widthPx: 110,
      value: (r) => r.dayPnl,
      format: ({ value }) => signedUsd(value as number),
    },
    {
      id: "weight",
      header: "Weight",
      widthPx: 96,
      value: (r) => r.weight,
      format: ({ value }) => `${(value as number).toFixed(1)}%`,
    },
    { id: "note", header: "Analyst note", widthPx: 180, value: (r) => r.note },
  ];
}
