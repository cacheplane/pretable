// apps/website/app/components/heroGrid/roster.ts
export interface RosterEntry {
  symbol: string;
  name: string;
  sector: string;
  /** Starting share count. */
  qty: number;
  /** Starting price (USD). */
  price: number;
  /** Per-name volatility multiplier for tick generation (0.5 calm – 1.6 hot). */
  vol: number;
}

/**
 * Illustrative, synthetic portfolio. Real tickers (public facts) with invented
 * holdings and prices. Ordered so the default weight-desc sort reads naturally.
 */
export const ROSTER: RosterEntry[] = [
  { symbol: "NVDA", name: "NVIDIA Corp", sector: "Technology", qty: 12500, price: 870.0, vol: 1.6 },
  { symbol: "MSFT", name: "Microsoft Corp", sector: "Technology", qty: 15300, price: 418.0, vol: 0.9 },
  { symbol: "AAPL", name: "Apple Inc", sector: "Technology", qty: 24000, price: 226.0, vol: 0.9 },
  { symbol: "AMZN", name: "Amazon.com Inc", sector: "Consumer", qty: 18000, price: 184.0, vol: 1.1 },
  { symbol: "GOOGL", name: "Alphabet Inc", sector: "Technology", qty: 16000, price: 178.0, vol: 1.0 },
  { symbol: "META", name: "Meta Platforms", sector: "Technology", qty: 9000, price: 512.0, vol: 1.2 },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Financials", qty: 14000, price: 214.0, vol: 0.8 },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", qty: 22000, price: 112.0, vol: 1.0 },
  { symbol: "UNH", name: "UnitedHealth Group", sector: "Health Care", qty: 5200, price: 498.0, vol: 0.9 },
  { symbol: "PFE", name: "Pfizer Inc", sector: "Health Care", qty: 40000, price: 28.5, vol: 1.1 },
  { symbol: "TSLA", name: "Tesla Inc", sector: "Consumer", qty: 8200, price: 240.0, vol: 1.6 },
  { symbol: "V", name: "Visa Inc", sector: "Financials", qty: 11000, price: 276.0, vol: 0.7 },
  { symbol: "AVGO", name: "Broadcom Inc", sector: "Technology", qty: 4200, price: 1380.0, vol: 1.3 },
  { symbol: "COST", name: "Costco Wholesale", sector: "Consumer", qty: 3400, price: 880.0, vol: 0.7 },
  { symbol: "HD", name: "Home Depot", sector: "Consumer", qty: 6000, price: 360.0, vol: 0.8 },
  { symbol: "CVX", name: "Chevron Corp", sector: "Energy", qty: 12000, price: 158.0, vol: 0.9 },
  { symbol: "ABBV", name: "AbbVie Inc", sector: "Health Care", qty: 9500, price: 178.0, vol: 0.8 },
  { symbol: "BAC", name: "Bank of America", sector: "Financials", qty: 30000, price: 39.0, vol: 0.9 },
  { symbol: "KO", name: "Coca-Cola Co", sector: "Consumer", qty: 26000, price: 62.0, vol: 0.5 },
  { symbol: "WMT", name: "Walmart Inc", sector: "Consumer", qty: 17000, price: 68.0, vol: 0.6 },
];
