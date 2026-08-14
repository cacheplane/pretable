export interface Position {
  id: string;
  desk: string;
  sector: string;
  symbol: string;
  shares: number;
  price: number;
}

/**
 * Each group mixes one very large position with several small ones — a
 * plain arithmetic mean and a shares-weighted mean diverge visibly, which is
 * the whole point: it's proof the custom aggregator did something a preset
 * couldn't, not just algebra on paper.
 */
export const positions: Position[] = [
  {
    id: "p1",
    desk: "Equities",
    sector: "Technology",
    symbol: "NVDA",
    shares: 9000,
    price: 118,
  },
  {
    id: "p2",
    desk: "Equities",
    sector: "Technology",
    symbol: "MSFT",
    shares: 300,
    price: 410,
  },
  {
    id: "p3",
    desk: "Equities",
    sector: "Technology",
    symbol: "AAPL",
    shares: 250,
    price: 227,
  },
  {
    id: "p4",
    desk: "Equities",
    sector: "Healthcare",
    symbol: "LLY",
    shares: 6200,
    price: 780,
  },
  {
    id: "p5",
    desk: "Equities",
    sector: "Healthcare",
    symbol: "UNH",
    shares: 180,
    price: 512,
  },
  {
    id: "p6",
    desk: "Equities",
    sector: "Healthcare",
    symbol: "PFE",
    shares: 220,
    price: 28,
  },
  {
    id: "p7",
    desk: "Credit",
    sector: "Financials",
    symbol: "JPM",
    shares: 7100,
    price: 205,
  },
  {
    id: "p8",
    desk: "Credit",
    sector: "Financials",
    symbol: "GS",
    shares: 140,
    price: 460,
  },
  {
    id: "p9",
    desk: "Credit",
    sector: "Financials",
    symbol: "MS",
    shares: 190,
    price: 98,
  },
  {
    id: "p10",
    desk: "Credit",
    sector: "Energy",
    symbol: "XOM",
    shares: 5400,
    price: 112,
  },
  {
    id: "p11",
    desk: "Credit",
    sector: "Energy",
    symbol: "CVX",
    shares: 210,
    price: 155,
  },
];
