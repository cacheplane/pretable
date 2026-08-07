import type { PretableAggregateSpec, PretableAggregator } from "./types";

export type { PretableAggregator } from "./types";

/**
 * Built-in aggregators.
 *
 * Every one is a monoid: `merge` is associative and `init()` is its identity.
 * v1 folds each group over its full set of descendant leaf rows, so `merge` is
 * currently only exercised by tests — but it is part of the contract from day
 * one so that a later child-aggregate rollup stays an internal optimization.
 *
 * Conventions, shared by all built-ins:
 * - `sum`/`avg`/`min`/`max` consider numeric values only; `null`, `undefined`
 *   and non-numbers (including `NaN`) are skipped.
 * - `count` counts *rows*, not values.
 * - An empty accumulator finalizes to `null`, never `0`, so an empty group
 *   renders blank rather than a misleading zero.
 */

interface SumAcc {
  sum: number;
  count: number;
}

interface ExtremumAcc {
  value: number | null;
}

interface CountAcc {
  count: number;
}

function isAggregatableNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

const sum: PretableAggregator<SumAcc, number | null> = {
  init: () => ({ sum: 0, count: 0 }),
  accumulate(acc, value) {
    if (!isAggregatableNumber(value)) return acc;
    acc.sum += value;
    acc.count += 1;
    return acc;
  },
  merge: (a, b) => ({ sum: a.sum + b.sum, count: a.count + b.count }),
  finalize: (acc) => (acc.count === 0 ? null : acc.sum),
};

const avg: PretableAggregator<SumAcc, number | null> = {
  init: () => ({ sum: 0, count: 0 }),
  accumulate: sum.accumulate,
  merge: sum.merge,
  finalize: (acc) => (acc.count === 0 ? null : acc.sum / acc.count),
};

const min: PretableAggregator<ExtremumAcc, number | null> = {
  init: () => ({ value: null }),
  accumulate(acc, value) {
    if (!isAggregatableNumber(value)) return acc;
    if (acc.value === null || value < acc.value) acc.value = value;
    return acc;
  },
  merge: (a, b) => ({
    value:
      a.value === null
        ? b.value
        : b.value === null
          ? a.value
          : Math.min(a.value, b.value),
  }),
  finalize: (acc) => acc.value,
};

const max: PretableAggregator<ExtremumAcc, number | null> = {
  init: () => ({ value: null }),
  accumulate(acc, value) {
    if (!isAggregatableNumber(value)) return acc;
    if (acc.value === null || value > acc.value) acc.value = value;
    return acc;
  },
  merge: (a, b) => ({
    value:
      a.value === null
        ? b.value
        : b.value === null
          ? a.value
          : Math.max(a.value, b.value),
  }),
  finalize: (acc) => acc.value,
};

const count: PretableAggregator<CountAcc, number | null> = {
  init: () => ({ count: 0 }),
  accumulate(acc) {
    acc.count += 1;
    return acc;
  },
  merge: (a, b) => ({ count: a.count + b.count }),
  finalize: (acc) => (acc.count === 0 ? null : acc.count),
};

/** @internal */
export const builtinAggregators = {
  sum,
  avg,
  min,
  max,
  count,
};

/** Name of a built-in aggregator. @internal */
export type BuiltinAggregatorName = keyof typeof builtinAggregators;

/**
 * Resolve a column's `aggregate` config to an aggregator instance.
 * Returns `null` when there is no aggregate (or the name is unrecognized).
 *
 * @internal
 */
export function resolveAggregator(
  spec: PretableAggregateSpec | undefined,
): PretableAggregator | null {
  if (spec === undefined || spec === null) return null;

  if (typeof spec === "string") {
    return (builtinAggregators[spec] as PretableAggregator | undefined) ?? null;
  }

  return spec;
}
