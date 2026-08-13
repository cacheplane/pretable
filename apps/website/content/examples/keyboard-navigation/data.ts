export interface Trade {
  id: string;
  time: string;
  account: string;
  symbol: string;
  side: "Buy" | "Sell";
  quantity: number;
  price: number;
  status: "Filled" | "Partial" | "Working" | "Cancelled";
}

const SYMBOLS = [
  "NVDA",
  "MSFT",
  "AAPL",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "JPM",
  "XOM",
  "UNH",
];
const ACCOUNTS = ["Acct-104", "Acct-118", "Acct-142", "Acct-207"];
const STATUSES: Trade["status"][] = [
  "Filled",
  "Partial",
  "Working",
  "Cancelled",
];

const ROW_COUNT = 140;
const START_SECONDS = 9 * 3600 + 30 * 60; // market open, 09:30:00
const SECONDS_PER_TRADE = 11;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function timeAt(index: number): string {
  const totalSeconds = START_SECONDS + index * SECONDS_PER_TRADE;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// Generated rather than hand-written: this table exists to exercise keyboard
// scrolling past the fold, and 140 hand-typed rows would bury that behind
// noise. Time is monotonic, so jumping to the last row visibly reads as "end
// of the trading day" rather than an arbitrary cutoff.
export const trades: Trade[] = Array.from({ length: ROW_COUNT }, (_, i) => ({
  id: `T-${1000 + i}`,
  time: timeAt(i),
  account: ACCOUNTS[i % ACCOUNTS.length],
  symbol: SYMBOLS[i % SYMBOLS.length],
  side: i % 2 === 0 ? "Buy" : "Sell",
  quantity: 100 + (i % 12) * 25,
  price: 50 + ((i * 13) % 400) + (i % 4) * 0.25,
  status: STATUSES[i % STATUSES.length],
}));
