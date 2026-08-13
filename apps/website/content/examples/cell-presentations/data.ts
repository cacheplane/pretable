export interface Position {
  id: string;
  symbol: string;
  name: string;
  dayPnl: number;
  settled: boolean;
  settlementState: string;
  flag: "risk" | "watch";
}

/**
 * Deliberately decorrelated: settlement state, day P&L direction, and flag
 * each vary independently across rows, so no single column's tone can be
 * read off another's.
 */
export const positions: Position[] = [
  {
    id: "p1",
    symbol: "NVDA",
    name: "NVIDIA Corp.",
    dayPnl: 8420.5,
    settled: true,
    settlementState: "Settled",
    flag: "watch",
  },
  {
    id: "p2",
    symbol: "TSLA",
    name: "Tesla, Inc.",
    dayPnl: -3190.25,
    settled: false,
    settlementState: "Pending",
    flag: "risk",
  },
  {
    id: "p3",
    symbol: "AAPL",
    name: "Apple Inc.",
    dayPnl: 1205.1,
    settled: true,
    settlementState: "Settled",
    flag: "risk",
  },
  {
    id: "p4",
    symbol: "META",
    name: "Meta Platforms, Inc.",
    dayPnl: -640.75,
    settled: true,
    settlementState: "Settled",
    flag: "watch",
  },
  {
    id: "p5",
    symbol: "MSFT",
    name: "Microsoft Corp.",
    dayPnl: 0,
    settled: false,
    settlementState: "Pending",
    flag: "watch",
  },
  {
    id: "p6",
    symbol: "AMZN",
    name: "Amazon.com, Inc.",
    dayPnl: 2755.4,
    settled: false,
    settlementState: "Pending",
    flag: "risk",
  },
];
