import { describe, expect, test } from "vitest";

import {
  builtinAggregators,
  resolveAggregator,
  type PretableAggregator,
} from "../aggregators";
import type { PretableRow } from "../types";

const ROW: PretableRow = {};

function fold(agg: PretableAggregator, values: unknown[]): unknown {
  let acc = agg.init();
  for (const value of values) {
    acc = agg.accumulate(acc, value, ROW);
  }
  return acc;
}

function run(agg: PretableAggregator, values: unknown[]): unknown {
  return agg.finalize(fold(agg, values));
}

/** Deterministic PRNG so a property failure is reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const builtinNames = ["sum", "avg", "min", "max", "count"] as const;

describe("resolveAggregator", () => {
  test.each(builtinNames)("resolves the %s built-in", (name) => {
    expect(resolveAggregator(name)).toBe(builtinAggregators[name]);
  });

  test("passes a custom aggregator through unchanged", () => {
    const custom: PretableAggregator<number, number> = {
      init: () => 0,
      accumulate: (acc) => acc + 1,
      merge: (a, b) => a + b,
      finalize: (acc) => acc,
    };

    expect(resolveAggregator(custom)).toBe(custom);
  });

  test("returns null for undefined or an unknown name", () => {
    expect(resolveAggregator(undefined)).toBeNull();
    expect(resolveAggregator("nope" as "sum")).toBeNull();
  });
});

describe("built-in aggregators over a known fixture", () => {
  const values = [10, 20, 30, 40];

  test("sum", () => {
    expect(run(builtinAggregators.sum, values)).toBe(100);
  });

  test("avg", () => {
    expect(run(builtinAggregators.avg, values)).toBe(25);
  });

  test("min", () => {
    expect(run(builtinAggregators.min, values)).toBe(10);
  });

  test("max", () => {
    expect(run(builtinAggregators.max, values)).toBe(40);
  });

  test("count counts rows, not values", () => {
    expect(run(builtinAggregators.count, values)).toBe(4);
    expect(run(builtinAggregators.count, [null, undefined, "x", 1])).toBe(4);
  });

  test("finalize yields plain scalars, never wrapper objects", () => {
    for (const name of builtinNames) {
      const out = run(builtinAggregators[name], values);
      expect(typeof out).toBe("number");
    }
  });
});

describe("non-numeric and null handling", () => {
  const mixed = [10, null, "abc", undefined, 20, Number.NaN, {}, true];

  test("sum skips non-numeric values", () => {
    expect(run(builtinAggregators.sum, mixed)).toBe(30);
  });

  test("avg divides by the numeric count only", () => {
    expect(run(builtinAggregators.avg, mixed)).toBe(15);
  });

  test("min and max ignore non-numeric values", () => {
    expect(run(builtinAggregators.min, mixed)).toBe(10);
    expect(run(builtinAggregators.max, mixed)).toBe(20);
  });

  test("count counts every row including the non-numeric ones", () => {
    expect(run(builtinAggregators.count, mixed)).toBe(8);
  });
});

describe("empty accumulators finalize to null, not 0", () => {
  test.each(builtinNames)("%s of no rows is null", (name) => {
    expect(run(builtinAggregators[name], [])).toBeNull();
  });

  test.each(["sum", "avg", "min", "max"] as const)(
    "%s of rows with no numeric values is null",
    (name) => {
      expect(run(builtinAggregators[name], [null, "x", undefined])).toBeNull();
    },
  );
});

describe("merge associativity (the license for a future rollup optimization)", () => {
  /**
   * Random value lists, random split points: folding the halves separately and
   * merging must be indistinguishable from folding the whole list. This is what
   * lets a later implementation compute a parent from its child accumulators
   * instead of from its descendant leaves.
   */
  test.each(builtinNames)("%s: split-and-merge equals fold-all", (name) => {
    const agg: PretableAggregator = builtinAggregators[name];
    const random = makeRandom(0xc0ffee);

    for (let trial = 0; trial < 200; trial += 1) {
      const length = Math.floor(random() * 12);
      const values: unknown[] = Array.from({ length }, () => {
        const roll = random();
        if (roll < 0.15) return null;
        if (roll < 0.25) return "not a number";
        if (roll < 0.3) return undefined;
        return Math.round(random() * 2000 - 1000);
      });

      const split = Math.floor(random() * (values.length + 1));
      const left = fold(agg, values.slice(0, split));
      const right = fold(agg, values.slice(split));

      expect(agg.finalize(agg.merge(left, right))).toEqual(
        agg.finalize(fold(agg, values)),
      );
    }
  });

  test.each(builtinNames)(
    "%s: merge is associative across three folds",
    (name) => {
      const agg: PretableAggregator = builtinAggregators[name];
      const random = makeRandom(0x5eed);

      for (let trial = 0; trial < 200; trial += 1) {
        const parts = [0, 1, 2].map(() =>
          Array.from({ length: Math.floor(random() * 5) }, () =>
            random() < 0.2 ? null : Math.round(random() * 100),
          ),
        );
        const [a, b, c] = parts.map((part) => fold(agg, part));

        expect(agg.finalize(agg.merge(agg.merge(a, b), c))).toEqual(
          agg.finalize(agg.merge(a, agg.merge(b, c))),
        );
      }
    },
  );

  test.each(builtinNames)("%s: init() is the identity element", (name) => {
    const agg: PretableAggregator = builtinAggregators[name];
    const acc = fold(agg, [1, 2, 3, null, "x"]);
    const expected = agg.finalize(acc);

    expect(agg.finalize(agg.merge(agg.init(), acc))).toEqual(expected);
    expect(agg.finalize(agg.merge(acc, agg.init()))).toEqual(expected);
    expect(agg.finalize(agg.merge(agg.init(), agg.init()))).toBeNull();
  });

  test.each(builtinNames)("%s: merge does not mutate its arguments", (name) => {
    const agg: PretableAggregator = builtinAggregators[name];
    const left = fold(agg, [1, 2, 3]);
    const right = fold(agg, [10, 20]);
    const leftBefore = JSON.stringify(left);
    const rightBefore = JSON.stringify(right);

    agg.merge(left, right);

    expect(JSON.stringify(left)).toBe(leftBefore);
    expect(JSON.stringify(right)).toBe(rightBefore);
  });
});
