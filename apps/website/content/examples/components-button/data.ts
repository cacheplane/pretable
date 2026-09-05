export interface Trade {
  id: string;
  symbol: string;
  side: "Buy" | "Sell";
  qty: number;
  price: number;
}

export const trades: Trade[] = [
  { id: "t1", symbol: "AAPL", side: "Buy", qty: 100, price: 226.11 },
  { id: "t2", symbol: "MSFT", side: "Sell", qty: 40, price: 418.38 },
  { id: "t3", symbol: "NVDA", side: "Buy", qty: 25, price: 869.63 },
  { id: "t4", symbol: "AMZN", side: "Buy", qty: 60, price: 183.91 },
  { id: "t5", symbol: "META", side: "Sell", qty: 15, price: 509.62 },
];
