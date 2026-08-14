import { createColumnHelper } from "@pretable/core";
import type { PretableAggregator } from "@pretable/core";

import type { Position } from "./data";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const count = new Intl.NumberFormat("en-US");

// A mergeable reducer: `init` seeds an accumulator, `accumulate` folds in
// one leaf row's value, `merge` combines two partial accumulators (so the
// tree can aggregate bottom-up), and `finalize` turns the accumulator into
// the displayed output. `row` is the whole leaf row, so a weight can come
// from a different field than the one being averaged.
const weightedAveragePrice: PretableAggregator<
  Position,
  number,
  { weightedTotal: number; weight: number },
  number | null
> = {
  init: () => ({ weightedTotal: 0, weight: 0 }),
  accumulate: (accumulator, value, row) => ({
    weightedTotal: accumulator.weightedTotal + value * row.shares,
    weight: accumulator.weight + row.shares,
  }),
  merge: (left, right) => ({
    weightedTotal: left.weightedTotal + right.weightedTotal,
    weight: left.weight + right.weight,
  }),
  finalize: ({ weightedTotal, weight }) =>
    weight === 0 ? null : weightedTotal / weight,
};

const column = createColumnHelper<Position>();

export const columns = [
  column.accessor("desk", { type: "text", header: "Desk" }),
  column.accessor("sector", { type: "text", header: "Sector" }),
  column.accessor("symbol", { type: "text", header: "Symbol" }),
  column.accessor("shares", {
    type: "number",
    header: "Shares",
    aggregate: "sum",
    format: ({ value }) => count.format(value),
    formatAggregate: ({ value }) =>
      typeof value === "number" ? count.format(value) : "",
  }),
  column.accessor("price", {
    type: "number",
    header: "Price",
    format: ({ value }) => usd.format(value),
  }),
  // Aggregate-only columns: the leaf cell is blank, so a group row is the
  // only place either number appears — that's what makes the divergence
  // between them legible.
  column.accessor("avgPrice", (row) => row.price, {
    type: "number",
    header: "Avg price",
    aggregate: "avg",
    format: () => "—",
    formatAggregate: ({ value }) =>
      typeof value === "number" ? usd.format(value) : "—",
  }),
  column.accessor("vwap", (row) => row.price, {
    type: "number",
    header: "VWAP (wtd by shares)",
    aggregate: weightedAveragePrice,
    format: () => "—",
    formatAggregate: ({ value }) =>
      typeof value === "number" ? usd.format(value) : "—",
  }),
] as const;
