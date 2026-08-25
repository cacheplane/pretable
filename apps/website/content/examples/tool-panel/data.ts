export interface Holding {
  id: string;
  symbol: string;
  desk: string;
  sector: string;
  quantity: number;
  price: number;
  marketValue: number;
}

export const holdings: Holding[] = [
  {
    id: "h1",
    symbol: "NVDA",
    desk: "Equities",
    sector: "Technology",
    quantity: 4200,
    price: 122,
    marketValue: 512_400,
  },
  {
    id: "h2",
    symbol: "MSFT",
    desk: "Equities",
    sector: "Technology",
    quantity: 1800,
    price: 416,
    marketValue: 748_900,
  },
  {
    id: "h3",
    symbol: "LLY",
    desk: "Equities",
    sector: "Healthcare",
    quantity: 620,
    price: 784,
    marketValue: 486_100,
  },
  {
    id: "h4",
    symbol: "UNH",
    desk: "Equities",
    sector: "Healthcare",
    quantity: 950,
    price: 528,
    marketValue: 501_300,
  },
  {
    id: "h5",
    symbol: "XOM",
    desk: "Equities",
    sector: "Energy",
    quantity: 3100,
    price: 118,
    marketValue: 364_800,
  },
  {
    id: "h6",
    symbol: "JPM",
    desk: "Credit",
    sector: "Financials",
    quantity: 2400,
    price: 260,
    marketValue: 623_500,
  },
  {
    id: "h7",
    symbol: "GS",
    desk: "Credit",
    sector: "Financials",
    quantity: 780,
    price: 538,
    marketValue: 419_700,
  },
  {
    id: "h8",
    symbol: "CVX",
    desk: "Credit",
    sector: "Energy",
    quantity: 1500,
    price: 159,
    marketValue: 238_200,
  },
  {
    id: "h9",
    symbol: "TLT",
    desk: "Macro",
    sector: "Financials",
    quantity: 5600,
    price: 89,
    marketValue: 497_800,
  },
  {
    id: "h10",
    symbol: "USO",
    desk: "Macro",
    sector: "Energy",
    quantity: 8800,
    price: 70,
    marketValue: 611_600,
  },
  {
    id: "h11",
    symbol: "SMH",
    desk: "Macro",
    sector: "Technology",
    quantity: 1250,
    price: 264,
    marketValue: 329_400,
  },
  {
    id: "h12",
    symbol: "QQQ",
    desk: "Macro",
    sector: "Technology",
    quantity: 900,
    price: 503,
    marketValue: 452_700,
  },
];
