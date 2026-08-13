export interface Position {
  id: string;
  symbol: string;
  qty: number;
  price: number;
}

export const positions: Position[] = [
  { id: "p1", symbol: "NVDA", qty: 500, price: 118.32 },
  { id: "p2", symbol: "MSFT", qty: 200, price: 421.9 },
  { id: "p3", symbol: "AAPL", qty: 300, price: 227.5 },
  { id: "p4", symbol: "GOOGL", qty: 150, price: 165.2 },
  { id: "p5", symbol: "AMZN", qty: 100, price: 178.75 },
];
