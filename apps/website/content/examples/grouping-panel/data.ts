export interface Position {
  id: string;
  desk: string;
  sector: string;
  symbol: string;
  shares: number;
  marketValue: number;
}

/**
 * Deliberately low cardinality on `desk` and `sector` — grouping is only
 * legible when a level has a handful of distinct keys, not hundreds.
 */
export const positions: Position[] = [
  {
    id: "p1",
    desk: "Equities",
    sector: "Technology",
    symbol: "NVDA",
    shares: 4200,
    marketValue: 512_400,
  },
  {
    id: "p2",
    desk: "Equities",
    sector: "Technology",
    symbol: "MSFT",
    shares: 1800,
    marketValue: 748_900,
  },
  {
    id: "p3",
    desk: "Equities",
    sector: "Healthcare",
    symbol: "LLY",
    shares: 620,
    marketValue: 486_100,
  },
  {
    id: "p4",
    desk: "Equities",
    sector: "Healthcare",
    symbol: "UNH",
    shares: 950,
    marketValue: 501_300,
  },
  {
    id: "p5",
    desk: "Equities",
    sector: "Energy",
    symbol: "XOM",
    shares: 3100,
    marketValue: 364_800,
  },
  {
    id: "p6",
    desk: "Credit",
    sector: "Financials",
    symbol: "JPM",
    shares: 2400,
    marketValue: 623_500,
  },
  {
    id: "p7",
    desk: "Credit",
    sector: "Financials",
    symbol: "GS",
    shares: 780,
    marketValue: 419_700,
  },
  {
    id: "p8",
    desk: "Credit",
    sector: "Energy",
    symbol: "CVX",
    shares: 1500,
    marketValue: 238_200,
  },
  {
    id: "p9",
    desk: "Macro",
    sector: "Financials",
    symbol: "TLT",
    shares: 5600,
    marketValue: 497_800,
  },
  {
    id: "p10",
    desk: "Macro",
    sector: "Energy",
    symbol: "USO",
    shares: 8800,
    marketValue: 611_600,
  },
  {
    id: "p11",
    desk: "Macro",
    sector: "Technology",
    symbol: "SMH",
    shares: 1250,
    marketValue: 329_400,
  },
  {
    id: "p12",
    desk: "Macro",
    sector: "Technology",
    symbol: "QQQ",
    shares: 900,
    marketValue: 452_700,
  },
];
