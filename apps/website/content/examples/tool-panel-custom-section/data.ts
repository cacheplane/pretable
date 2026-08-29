export interface Trade {
  id: string;
  symbol: string;
  side: string;
  desk: string;
  quantity: number;
  price: number;
}

const SYMBOLS = [
  ["NVDA", 122],
  ["MSFT", 416],
  ["AAPL", 213],
  ["LLY", 784],
  ["UNH", 528],
  ["XOM", 118],
  ["JPM", 260],
  ["GS", 538],
  ["CVX", 159],
  ["TLT", 89],
  ["USO", 70],
  ["QQQ", 503],
] as const;

const DESKS = ["Equities", "Credit", "Macro"] as const;

// Deterministic on purpose: a docs example that rendered differently on every
// load would make its own prose wrong.
export const trades: Trade[] = Array.from({ length: 28 }, (_, i) => {
  const [symbol, price] = SYMBOLS[i % SYMBOLS.length] as readonly [
    string,
    number,
  ];
  return {
    id: `t${i + 1}`,
    symbol,
    side: i % 3 === 0 ? "Sell" : "Buy",
    desk: DESKS[i % DESKS.length] as string,
    quantity: 50 + ((i * 37) % 400),
    price,
  };
});
