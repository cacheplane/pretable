import type { PretableColumn } from "@pretable/react";

/**
 * Deterministic positions fixture for the rejected-writes showcase. Every
 * value is a pure function of (ticker, tick) so the component test can prove
 * "the grid still shows the pre-corruption page" against exact numbers —
 * a tick-invariant price would make that assertion vacuous.
 */
export interface Position extends Record<string, unknown> {
  id: string;
  ticker: string;
  qty: number;
  price: number;
}

const TICKERS = [
  "AAPL",
  "MSFT",
  "NVDA",
  "AMZN",
  "GOOG",
  "META",
  "TSLA",
  "AVGO",
  "COST",
  "LLY",
  "JPM",
  "UNH",
] as const;

export const POSITION_COUNT = TICKERS.length;

const BASE_QTY = 250;

/** Deterministic drifting price: base per ticker + a tick-dependent wobble. */
export function priceFor(ticker: string, tick: number): number {
  let hash = 0;
  for (const ch of ticker) hash = (hash * 31 + ch.charCodeAt(0)) % 9973;
  const base = 40 + (hash % 400);
  const wobble = Math.sin(tick * 0.7 + hash) * 4;
  return Math.round((base + wobble) * 100) / 100;
}

export function cleanPage(tick: number): Position[] {
  return TICKERS.map((ticker, index) => ({
    id: ticker,
    ticker,
    qty: BASE_QTY + index * 25,
    price: priceFor(ticker, tick),
  }));
}

/**
 * A clean page with one row's id overwritten by another's — the
 * `duplicate-row-id` fault. `variant` picks WHICH id is duplicated so a
 * second corruption produces a different fault detail (the demo's quiet
 * "nothing latches" beat).
 */
export function corruptPage(tick: number, variant: number): Position[] {
  const rows = cleanPage(tick);
  const source = variant % 2 === 0 ? 0 : 2;
  const target = source + 1;
  rows[target] = { ...rows[target]!, id: rows[source]!.id };
  return rows;
}

export function makePositionColumns(): PretableColumn<Position>[] {
  return [
    { id: "ticker", header: "Ticker", widthPx: 96, value: (row) => row.ticker },
    { id: "qty", header: "Qty", widthPx: 88, value: (row) => row.qty },
    {
      id: "price",
      header: "Price",
      widthPx: 104,
      value: (row) => row.price,
      format: ({ value }) => `$${(value as number).toFixed(2)}`,
    },
    {
      id: "value",
      header: "Value",
      widthPx: 120,
      value: (row) => Math.round(row.qty * row.price * 100) / 100,
      format: ({ value }) => `$${(value as number).toLocaleString("en-US")}`,
    },
  ];
}
