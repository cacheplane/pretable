import { describe, expect, test } from "vitest";

import {
  createAggregateTree,
  createScalarAggregateCell,
  type AggregateTree,
  type AggregateTreeLeaf,
} from "../persistent/aggregate-tree";

/**
 * #500 cycle 2 invariant 1: scalar accumulator cells for `sum`/`avg`/`count`
 * are EXACT inverses of the ordered aggregate tree. The tree is the oracle;
 * randomized insert/remove sequences (NaN, ±Infinity, negative zero,
 * duplicates) must agree with it at EVERY intermediate finalize, not just at
 * the end — that is what makes remove a true inverse rather than a rebuild.
 */

type Kind = "sum" | "avg" | "count";
const KINDS: readonly Kind[] = ["sum", "avg", "count"];

interface Row {
  readonly id: string;
}

function leaf(
  id: string,
  value: unknown,
): AggregateTreeLeaf<string, Row, unknown, unknown> {
  return Object.freeze({ id, row: { id }, value, dependency: null });
}

/** Deterministic mulberry32 PRNG — the fuzz must replay exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Values chosen so the pool can DISPROVE: NaN and non-numbers probe admission
// symmetry, ±Infinity probes the flag-vs-counter semantics, negative zero and
// the extreme magnitudes probe the bigint superaccumulator inverse, and
// repeated values probe duplicate handling.
const VALUE_POOL: readonly unknown[] = [
  0,
  -0,
  1,
  1,
  2.5,
  -3.75,
  0.1,
  0.2,
  1e300,
  -1e300,
  5e-324,
  -5e-324,
  Number.MAX_SAFE_INTEGER,
  Infinity,
  -Infinity,
  -Infinity,
  NaN,
  null,
  undefined,
  "not a number",
];

function makeOracle(kind: Kind) {
  return createAggregateTree({
    columnId: "m",
    aggregator: kind,
  } as never) as AggregateTree<string, Row, unknown, unknown, number | null>;
}

describe("scalar aggregate cell vs tree oracle (#500 cycle 2)", () => {
  for (const kind of KINDS) {
    test(`randomized insert/remove fuzz stays exact for ${kind}`, () => {
      const random = mulberry32(0xc0ffee ^ kind.length);
      let oracle = makeOracle(kind);
      let cell = createScalarAggregateCell<string, Row, unknown>({
        columnId: "m",
        aggregator: kind,
      });
      const live = new Map<
        string,
        AggregateTreeLeaf<string, Row, unknown, unknown>
      >();
      let nextId = 0;
      let removals = 0;
      for (let step = 0; step < 1_000; step += 1) {
        const removeBiased = live.size > 0 && random() < 0.45;
        if (removeBiased) {
          const ids = [...live.keys()];
          const id = ids[Math.floor(random() * ids.length)]!;
          const removed = live.get(id)!;
          live.delete(id);
          oracle = oracle.remove(id);
          cell = cell.remove(id, removed);
          removals += 1;
        } else {
          const id = `row-${nextId++}`;
          const entry = leaf(
            id,
            VALUE_POOL[Math.floor(random() * VALUE_POOL.length)],
          );
          live.set(id, entry);
          oracle = oracle.insertOrReplace(entry);
          cell = cell.insertOrReplace(entry);
        }
        // Exactness at EVERY intermediate step, and Object.is so NaN
        // agreement and a +0/-0 disagreement both count.
        expect(Object.is(cell.finalize(), oracle.finalize())).toBe(true);
        expect(cell.size).toBe(oracle.size);
      }
      // The run must have exercised the inverse, not just accumulation.
      expect(removals).toBeGreaterThan(100);
    });

    test(`draining every row returns ${kind} to the empty output`, () => {
      const random = mulberry32(0xdead ^ kind.length);
      let oracle = makeOracle(kind);
      let cell = createScalarAggregateCell<string, Row, unknown>({
        columnId: "m",
        aggregator: kind,
      });
      const inserted: AggregateTreeLeaf<string, Row, unknown, unknown>[] = [];
      for (let index = 0; index < 200; index += 1) {
        const entry = leaf(
          `row-${index}`,
          VALUE_POOL[Math.floor(random() * VALUE_POOL.length)],
        );
        inserted.push(entry);
        oracle = oracle.insertOrReplace(entry);
        cell = cell.insertOrReplace(entry);
      }
      // Remove in a shuffled order, checking parity the whole way down.
      for (const entry of inserted.sort(() => random() - 0.5)) {
        oracle = oracle.remove(entry.id);
        cell = cell.remove(entry.id, entry);
        expect(Object.is(cell.finalize(), oracle.finalize())).toBe(true);
      }
      expect(cell.size).toBe(0);
      expect(cell.finalize()).toBeNull();
    });
  }

  test("±Infinity flags are counters: a removal clears exactly one side", () => {
    // Invariant 3: Inf + (−Inf) → NaN must SURVIVE removals. A boolean flag
    // implementation cannot un-set itself, and a single-counter one cannot
    // tell which side cleared — this walks both directions explicitly.
    for (const kind of ["sum", "avg"] as const) {
      const a = leaf("a", Infinity);
      const b = leaf("b", -Infinity);
      const c = leaf("c", 5);
      const d = leaf("d", Infinity);
      let oracle = makeOracle(kind);
      let cell = createScalarAggregateCell<string, Row, unknown>({
        columnId: "m",
        aggregator: kind,
      });
      for (const entry of [a, b, c, d]) {
        oracle = oracle.insertOrReplace(entry);
        cell = cell.insertOrReplace(entry);
      }
      expect(cell.finalize()).toBeNaN();
      // Remove ONE of the two +Infinity rows: still mixed → still NaN.
      cell = cell.remove("d", d);
      oracle = oracle.remove("d");
      expect(cell.finalize()).toBeNaN();
      expect(Object.is(cell.finalize(), oracle.finalize())).toBe(true);
      // Remove the -Infinity row: only +Infinity remains.
      cell = cell.remove("b", b);
      oracle = oracle.remove("b");
      expect(cell.finalize()).toBe(Infinity);
      expect(Object.is(cell.finalize(), oracle.finalize())).toBe(true);
      // Remove the last +Infinity: the finite remainder resurfaces.
      cell = cell.remove("a", a);
      oracle = oracle.remove("a");
      expect(cell.finalize()).toBe(5);
      expect(Object.is(cell.finalize(), oracle.finalize())).toBe(true);
    }
  });

  test("NaN and non-number admission is symmetric on remove", () => {
    const values = [NaN, null, undefined, "x", 7];
    let cell = createScalarAggregateCell<string, Row, unknown>({
      columnId: "m",
      aggregator: "avg",
    });
    const leaves = values.map((value, index) => leaf(`r${index}`, value));
    for (const entry of leaves) cell = cell.insertOrReplace(entry);
    // Only the 7 was admitted.
    expect(cell.finalize()).toBe(7);
    expect(cell.size).toBe(5);
    // Removing the inadmissible rows must not disturb the accumulator.
    for (const entry of leaves.slice(0, 4)) {
      cell = cell.remove(entry.id, entry);
    }
    expect(cell.finalize()).toBe(7);
    expect(cell.size).toBe(1);
    cell = cell.remove("r4", leaves[4]!);
    expect(cell.finalize()).toBeNull();
    expect(cell.size).toBe(0);
  });

  test("a scalar cell removal requires the originally-inserted leaf", () => {
    // The cell holds no per-row values, so remove(id) alone cannot invert;
    // the update paths hand it the removal record's leaf. Calling without
    // one is a caller bug and must fail loudly, not corrupt silently.
    let cell = createScalarAggregateCell<string, Row, unknown>({
      columnId: "m",
      aggregator: "sum",
    });
    cell = cell.insertOrReplace(leaf("a", 3));
    expect(() => cell.remove("a")).toThrow(TypeError);
    expect(() => cell.remove("a")).toThrow(/leaf/i);
  });

  test("removing more rows than were inserted fails loudly", () => {
    let cell = createScalarAggregateCell<string, Row, unknown>({
      columnId: "m",
      aggregator: "count",
    });
    const entry = leaf("a", 1);
    cell = cell.insertOrReplace(entry);
    cell = cell.remove("a", entry);
    expect(() => cell.remove("a", entry)).toThrow(/insert/i);
  });

  test("firstId is undefined and finalize of an empty cell is null", () => {
    for (const kind of KINDS) {
      const cell = createScalarAggregateCell<string, Row, unknown>({
        columnId: "m",
        aggregator: kind,
      });
      expect(cell.firstId()).toBeUndefined();
      expect(cell.finalize()).toBeNull();
      expect(cell.insertOrReplace(leaf("a", 1)).firstId()).toBeUndefined();
    }
  });

  test("the transient cell accumulates in place and freezes to a persistent cell", () => {
    const persistent = createScalarAggregateCell<string, Row, unknown>({
      columnId: "m",
      aggregator: "sum",
    });
    const transient = persistent.asTransient();
    transient.insertOrReplace(leaf("a", 2));
    transient.insertOrReplace(leaf("b", 3));
    expect(transient.finalize()).toBe(5);
    // Scalar cells hold no deferred measures: nothing to seal, ever.
    const deferred = transient as unknown as {
      pendingMeasureCount: number;
      sealMeasureStep(): boolean;
    };
    expect(deferred.pendingMeasureCount).toBe(0);
    const frozen = transient.freeze();
    expect(frozen.finalize()).toBe(5);
    expect(frozen.size).toBe(2);
    // Freezing detaches the draft, matching the tree draft contract.
    expect(() => transient.insertOrReplace(leaf("c", 1))).toThrow(/frozen/i);
    // The original persistent cell was never mutated.
    expect(persistent.finalize()).toBeNull();
  });
});
