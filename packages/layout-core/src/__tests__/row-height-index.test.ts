import { describe, expect, test } from "vitest";

import { planViewport } from "../viewport-plan";
import * as rowHeightIndexTesting from "../row-height-index";
import {
  createRowHeightIndex,
  getRowHeightIndexDiagnosticsForTesting,
} from "../row-height-index";
import type {
  RowHeightEntry,
  RowHeightIndex,
  RowHeightReplacementSource,
  RowMetricsReader,
} from "../types";

type Key =
  | { readonly kind: "data"; readonly id: string }
  | { readonly kind: "group"; readonly id: string };

const data = (id: string): Key => ({ kind: "data", id });
const group = (id: string): Key => ({ kind: "group", id });
const stableKey = (key: Key) => `${key.kind}:${key.id}`;
const entry = (key: Key, estimatedHeight?: number): RowHeightEntry<Key> => ({
  key,
  estimatedHeight,
});

const FNV_PRIME = 0x01000193;
const FNV_PRIME_INVERSE = 899_433_627;

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), FNV_PRIME) >>> 0;
  }
  return hash;
}

function sameHashKeys(count: number): string[] {
  const targetHash = 0x4a17c0de;
  const encodedPrefix = "s:5:";
  const targetBeforeLastCharacter =
    Math.imul(targetHash, FNV_PRIME_INVERSE) >>> 0;
  const result: string[] = [];

  for (let identityIndex = 0; identityIndex < count; identityIndex += 1) {
    const first = (identityIndex >>> 16) & 0xffff;
    const second = identityIndex & 0xffff;
    let hash = fnv1a(encodedPrefix);
    hash = Math.imul(hash ^ first, FNV_PRIME) >>> 0;
    hash = Math.imul(hash ^ second, FNV_PRIME) >>> 0;
    let found: string | undefined;

    for (let third = 0; third <= 0xffff && found === undefined; third += 1) {
      const afterThird = Math.imul(hash ^ third, FNV_PRIME) >>> 0;
      for (let fourth = 0; fourth <= 0xffff; fourth += 1) {
        const afterFourth = Math.imul(afterThird ^ fourth, FNV_PRIME) >>> 0;
        const fifth = (afterFourth ^ targetBeforeLastCharacter) >>> 0;
        if (fifth <= 0xffff) {
          found = String.fromCharCode(first, second, third, fourth, fifth);
          break;
        }
      }
    }

    if (found === undefined)
      throw new Error("Unable to generate FNV collision.");
    result.push(found);
  }

  return result;
}

function replacementDiagnostics(builder: unknown): Record<string, unknown> {
  const seam = (
    rowHeightIndexTesting as unknown as {
      getRowHeightReplacementBuilderDiagnosticsForTesting?: (
        value: unknown,
      ) => Record<string, unknown>;
    }
  ).getRowHeightReplacementBuilderDiagnosticsForTesting;
  if (seam === undefined) {
    throw new Error("Replacement-builder diagnostics are unavailable.");
  }
  return seam(builder);
}

function expectReplacementLifecycleError(
  operation: () => unknown,
  code: string,
): void {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({
    name: "RowHeightReplacementLifecycleError",
    code,
  });
}

function createIndex(
  rows: readonly RowHeightEntry<Key>[],
  defaultHeight = 30,
  maxRetainedMeasurements?: number,
): RowHeightIndex<Key> {
  return createRowHeightIndex({
    defaultHeight,
    getKey: stableKey,
    rows,
    maxRetainedMeasurements,
  });
}

describe("persistent row-height index", () => {
  test("tracks default, estimated, and measured heights with clamped boundary reads", () => {
    const first = data("first");
    const second = group("second");
    const third = data("third");
    const initial = createIndex(
      [entry(first, 20.5), entry(second), entry(third, 40)],
      30,
    );

    expect(initial.rowCount).toBe(3);
    expect(initial.getHeight(0)).toBe(20.5);
    expect(initial.getHeight(1)).toBe(30);
    expect(initial.getHeight(2)).toBe(40);
    expect(initial.getTotalHeight()).toBe(90.5);
    expect(initial.getOffsetForIndex(-1)).toBe(0);
    expect(initial.getOffsetForIndex(0)).toBe(0);
    expect(initial.getOffsetForIndex(1)).toBe(20.5);
    expect(initial.getOffsetForIndex(2)).toBe(50.5);
    expect(initial.getOffsetForIndex(3)).toBe(90.5);
    expect(initial.getOffsetForIndex(99)).toBe(90.5);
    expect(initial.getOffsetForIndex(Number.NaN)).toBe(0);
    expect(initial.getIndexForOffset(Number.NaN)).toBe(0);
    expect(initial.getIndexForOffset(-10)).toBe(0);
    expect(initial.getIndexForOffset(0)).toBe(0);
    expect(initial.getIndexForOffset(20.499)).toBe(0);
    expect(initial.getIndexForOffset(20.5)).toBe(1);
    expect(initial.getIndexForOffset(50.5)).toBe(2);
    expect(initial.getIndexForOffset(90.499)).toBe(2);
    expect(initial.getIndexForOffset(90.5)).toBe(3);
    expect(initial.getIndexForOffset(Number.POSITIVE_INFINITY)).toBe(3);

    const measured = initial.measure(1, second, 33.25);
    expect(measured.getHeight(1)).toBe(33.25);
    expect(measured.getTotalHeight()).toBe(93.75);
    expect(initial.getHeight(1)).toBe(30);
    expect(initial.getTotalHeight()).toBe(90.5);
  });

  test("applies sequential insert, remove, move, and update operations atomically", () => {
    const a = data("a");
    const b = data("b");
    const c = data("c");
    const inserted = group("inserted");
    const initial = createIndex([entry(a, 10), entry(b, 20), entry(c, 30)]);
    const next = initial.apply([
      { kind: "remove", ref: a, previousIndex: 0 },
      { kind: "move", ref: c, previousIndex: 1, index: 0 },
      { kind: "insert", ref: inserted, index: 1, estimatedHeight: 15 },
      { kind: "update", ref: b, index: 2, estimatedHeight: 25 },
    ]);

    expect([0, 1, 2].map((index) => next.keyAt(index))).toEqual([
      c,
      inserted,
      b,
    ]);
    expect([0, 1, 2].map((index) => next.getHeight(index))).toEqual([
      30, 15, 25,
    ]);
    expect(next.getTotalHeight()).toBe(70);
    expect([0, 1, 2].map((index) => initial.keyAt(index))).toEqual([a, b, c]);
    expect(initial.getTotalHeight()).toBe(60);
  });

  test("retains measurements across moves and collapse-style remove/reinsert", () => {
    const a = data("a");
    const collapsed = group("same");
    const c = data("c");
    const measured = createIndex([
      entry(a, 20),
      entry(collapsed, 25),
      entry(c, 30),
    ]).measure(1, collapsed, 47);
    const moved = measured.apply([
      { kind: "move", ref: collapsed, previousIndex: 1, index: 2 },
    ]);
    expect(moved.getHeight(2)).toBe(47);

    const removed = moved.apply([
      { kind: "remove", ref: collapsed, previousIndex: 2 },
    ]);
    const reinserted = removed.apply([
      { kind: "insert", ref: group("same"), index: 1, estimatedHeight: 12 },
    ]);
    expect(reinserted.getHeight(1)).toBe(47);
  });

  test("retains a bounded measurement for a currently absent stable key", () => {
    const absent = data("absent");
    const retained = createIndex([], 30, 1).retainMeasurement(absent, 73);
    expect(retained.hasMeasurement(absent)).toBe(true);
    expect(getRowHeightIndexDiagnosticsForTesting(retained)).toMatchObject({
      visibleMeasurementCount: 0,
      tombstoneCount: 1,
      measurementCacheCount: 1,
    });
    const restored = retained.apply([
      { kind: "insert", ref: data("absent"), index: 0 },
    ]);
    expect(restored.getHeight(0)).toBe(73);
    expect(() => restored.retainMeasurement(absent, 80)).toThrow(
      /visible row/i,
    );
    const evicted = retained.retainMeasurement(data("newer"), 81);
    expect(evicted.hasMeasurement(absent)).toBe(false);
    expect(evicted.hasMeasurement(data("newer"))).toBe(true);
    const zero = createIndex([], 30, 0);
    expect(zero.retainMeasurement(absent, 73)).toBe(zero);
    expect(zero.hasMeasurement(absent)).toBe(false);
  });

  test("keeps equal data and group text distinct and rejects identity collisions", () => {
    const distinct = createIndex([
      entry(data("same"), 20),
      entry(group("same"), 40),
    ]);
    expect(distinct.keyAt(0)).toEqual(data("same"));
    expect(distinct.keyAt(1)).toEqual(group("same"));

    expect(() =>
      createRowHeightIndex({
        defaultHeight: 30,
        getKey: (key: Key) => key.id,
        rows: [entry(data("same")), entry(group("same"))],
      }),
    ).toThrow(/duplicate stable row-height key/i);

    const primitiveTypes = createRowHeightIndex({
      defaultHeight: 30,
      getKey: (ref: { readonly id: string | number }) => ref.id,
      rows: [
        { key: { id: "1" }, estimatedHeight: 10 },
        { key: { id: 1 }, estimatedHeight: 20 },
      ],
    });
    expect(primitiveTypes.rowCount).toBe(2);
    expect(primitiveTypes.getTotalHeight()).toBe(30);
  });

  test("keeps distinct stable identities separate when their hash values collide", () => {
    // These encoded string identities collide under the index's FNV-1a hash.
    const first = data("k-ielz1d-1wwy");
    const second = data("k-1i39yng-2umb");
    const collisionKey = (key: Key) => key.id;
    let index = createRowHeightIndex({
      defaultHeight: 30,
      getKey: collisionKey,
      rows: [entry(first, 20), entry(second, 40)],
      maxRetainedMeasurements: 2,
    });
    expect(
      getRowHeightIndexDiagnosticsForTesting(index).identityComparisons,
    ).toBeGreaterThan(0);

    index = index.measure(0, first, 51).measure(1, second, 52);
    index = index.apply([{ kind: "remove", ref: first, previousIndex: 0 }]);

    expect(index.keyAt(0)).toEqual(second);
    expect(index.getHeight(0)).toBe(52);
    expect(index.hasMeasurement(first)).toBe(true);
    expect(index.hasMeasurement(second)).toBe(true);
    expect(
      index.apply([{ kind: "insert", ref: first, index: 1 }]).getHeight(1),
    ).toBe(51);
  });

  test("keeps adversarial full-hash collisions logarithmic and persistent", () => {
    const keys = sameHashKeys(1_600);
    expect(new Set(keys).size).toBe(keys.length);
    expect(
      new Set(keys.map((key) => fnv1a(`s:${key.length}:${key}`))).size,
    ).toBe(1);

    for (const count of [200, 400, 800, 1_600]) {
      const collisionKeys = keys.slice(0, count);
      const index = createRowHeightIndex({
        defaultHeight: 30,
        getKey: (key: string) => key,
        rows: collisionKeys.map((key, rowIndex) => ({
          key,
          estimatedHeight: 10 + (rowIndex % 20),
        })),
      });
      const work = getRowHeightIndexDiagnosticsForTesting(index);
      expect(work.identityComparisons).toBeLessThan(count * 24);
      expect(work.nodesCreated).toBeLessThan(count * 36);
      expect(index.keyAt(0)).toBe(collisionKeys[0]);
      expect(index.keyAt(count - 1)).toBe(collisionKeys[count - 1]);
      expect(index.getHeight(count - 1)).toBe(10 + ((count - 1) % 20));
    }

    const historical = createRowHeightIndex({
      defaultHeight: 30,
      getKey: (key: string) => key,
      rows: keys.map((key, rowIndex) => ({
        key,
        estimatedHeight: 10 + (rowIndex % 20),
      })),
    });
    const removed = historical.apply(
      keys.slice(0, 800).map((key) => ({
        kind: "remove" as const,
        ref: key,
        previousIndex: 0,
      })),
    );
    expect(
      getRowHeightIndexDiagnosticsForTesting(removed).identityComparisons,
    ).toBeLessThan(800 * 30);
    expect(removed.rowCount).toBe(800);
    expect(removed.keyAt(0)).toBe(keys[800]);
    expect(removed.getHeight(0)).toBe(10);
    expect(removed.keyAt(799)).toBe(keys[1_599]);
    expect(historical.rowCount).toBe(1_600);
    expect(historical.keyAt(0)).toBe(keys[0]);
  });

  test("updates invalidate stale measurements while moves leave them intact", () => {
    const key = data("row");
    const measured = createIndex([entry(key, 20)]).measure(0, key, 44);
    const updated = measured.apply([
      { kind: "update", ref: key, index: 0, estimatedHeight: 24 },
    ]);

    expect(measured.getHeight(0)).toBe(44);
    expect(updated.getHeight(0)).toBe(24);
    expect(updated.hasMeasurement(key)).toBe(false);
  });

  test("bulk replacement preserves known measurements and leaves the old root immutable", () => {
    const a = data("a");
    const b = group("b");
    const c = data("c");
    const measured = createIndex([entry(a, 20), entry(b, 30)]).measure(
      1,
      b,
      52,
    );
    const replacement = measured.replace([entry(c, 10), entry(group("b"), 11)]);

    expect(replacement.rowCount).toBe(2);
    expect(replacement.keyAt(0)).toEqual(c);
    expect(replacement.getHeight(0)).toBe(10);
    expect(replacement.getHeight(1)).toBe(52);
    expect(measured.keyAt(0)).toEqual(a);
    expect(measured.getHeight(1)).toBe(52);
  });

  test("captures and restores a same-key scroll anchor after corrections and moves", () => {
    const keys = [data("a"), data("b"), data("anchor"), data("d")];
    const initial = createIndex(keys.map((key) => entry(key, 20)));
    const anchor = initial.captureAnchor(2, 45);
    expect(anchor).toEqual({ ref: keys[2], offset: 5 });

    const corrected = initial.measure(0, keys[0]!, 40);
    expect(corrected.restoreAnchor(anchor!, 2)).toBe(65);

    const moved = corrected.apply([
      { kind: "move", ref: keys[2]!, previousIndex: 2, index: 0 },
    ]);
    expect(moved.restoreAnchor(anchor!, 0)).toBe(5);
    expect(() => moved.restoreAnchor(anchor!, 1)).toThrow(
      /anchor key does not match/i,
    );
  });

  test("returns the same root for semantic no-ops", () => {
    const a = data("a");
    const b = data("b");
    const initial = createIndex([entry(a, 20), entry(b, 30)]);

    expect(initial.apply([])).toBe(initial);
    expect(
      initial.apply([{ kind: "move", ref: a, previousIndex: 0, index: 0 }]),
    ).toBe(initial);
    expect(
      initial.apply([
        { kind: "update", ref: a, index: 0, estimatedHeight: 20 },
      ]),
    ).toBe(initial);
    const measured = initial.measure(0, a, 22);
    expect(measured.measure(0, a, 22)).toBe(measured);
    expect(initial.replace([entry(data("a"), 20), entry(data("b"), 30)])).toBe(
      initial,
    );
  });

  test("rejects invalid operations and callback failures without publishing partial work", () => {
    const initial = createRowHeightIndex<Key>({
      defaultHeight: 30,
      getKey: (key) => {
        if (key.id === "boom") throw new Error("key callback exploded");
        return stableKey(key);
      },
      rows: [entry(data("a"), 20), entry(data("b"), 30)],
    });
    const before = [initial.keyAt(0), initial.keyAt(1)];

    expect(() =>
      initial.apply([
        { kind: "insert", ref: data("c"), index: 2, estimatedHeight: 10 },
        { kind: "insert", ref: data("boom"), index: 3 },
      ]),
    ).toThrow("key callback exploded");
    expect(() =>
      initial.apply([{ kind: "remove", ref: data("wrong"), previousIndex: 0 }]),
    ).toThrow(/does not match/i);
    expect([initial.keyAt(0), initial.keyAt(1)]).toEqual(before);
    expect(initial.getTotalHeight()).toBe(50);
  });

  test("rejects non-positive and non-finite default, estimated, and measured heights", () => {
    const key = data("a");
    for (const height of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createRowHeightIndex({
          defaultHeight: height,
          getKey: stableKey,
          rows: [entry(key)],
        }),
      ).toThrow(RangeError);
    }
    const initial = createIndex([entry(key, 20)]);
    for (const height of [0, -1, Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(() => initial.measure(0, key, height)).toThrow(RangeError);
      expect(() =>
        initial.apply([
          { kind: "update", ref: key, index: 0, estimatedHeight: height },
        ]),
      ).toThrow(RangeError);
    }
  });

  test("bounds removed measurement tombstones while preserving visible measurements", () => {
    const limit = 32;
    const visible = data("always-visible");
    let index = createIndex([entry(visible, 20)], 30, limit).measure(
      0,
      visible,
      77,
    );

    for (let id = 0; id < 2_000; id += 1) {
      const ref = data(`churn-${id}`);
      index = index.apply([
        { kind: "insert", ref, index: 1, estimatedHeight: 10 },
      ]);
      index = index.measure(1, ref, 40 + (id % 10));
      index = index.apply([{ kind: "remove", ref, previousIndex: 1 }]);
    }

    const diagnostics = getRowHeightIndexDiagnosticsForTesting(index);
    expect(diagnostics.visibleMeasurementCount).toBe(1);
    expect(diagnostics.tombstoneCount).toBe(limit);
    expect(diagnostics.measurementCacheCount).toBe(limit + 1);
    expect(index.hasMeasurement(visible)).toBe(true);
    expect(index.hasMeasurement(data("churn-0"))).toBe(false);
    expect(index.hasMeasurement(data("churn-1999"))).toBe(true);

    const restored = index.apply([
      {
        kind: "insert",
        ref: data("churn-1999"),
        index: 1,
        estimatedHeight: 10,
      },
    ]);
    expect(restored.getHeight(1)).toBe(49);
    expect(getRowHeightIndexDiagnosticsForTesting(restored)).toMatchObject({
      visibleMeasurementCount: 2,
      tombstoneCount: limit - 1,
      measurementCacheCount: limit + 1,
    });
  });

  test("supports zero removed-measurement retention and rejects invalid limits", () => {
    const ref = data("row");
    let index = createIndex([entry(ref, 20)], 30, 0).measure(0, ref, 55);
    index = index.apply([{ kind: "remove", ref, previousIndex: 0 }]);
    expect(index.hasMeasurement(ref)).toBe(false);
    expect(getRowHeightIndexDiagnosticsForTesting(index)).toMatchObject({
      visibleMeasurementCount: 0,
      tombstoneCount: 0,
      measurementCacheCount: 0,
    });

    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createRowHeightIndex({
          defaultHeight: 30,
          getKey: stableKey,
          rows: [],
          maxRetainedMeasurements: limit,
        }),
      ).toThrow(RangeError);
    }
  });

  test("reconciles visible measurements and bounded tombstones during replacement", () => {
    const a = data("a");
    const b = data("b");
    const c = data("c");
    const d = data("d");
    let index = createIndex([entry(a, 10), entry(b, 10), entry(c, 10)], 30, 2);
    index = index.measure(0, a, 41).measure(1, b, 42).measure(2, c, 43);
    index = index.apply([
      { kind: "remove", ref: b, previousIndex: 1 },
      { kind: "remove", ref: c, previousIndex: 1 },
    ]);
    expect(index.replace([entry(data("a"), 10)])).toBe(index);

    const replaced = index.replace([entry(data("b"), 10), entry(d, 10)]);
    expect(replaced.getHeight(0)).toBe(42);
    expect(replaced.hasMeasurement(c)).toBe(true);
    expect(replaced.hasMeasurement(a)).toBe(true);
    expect(getRowHeightIndexDiagnosticsForTesting(replaced)).toMatchObject({
      visibleMeasurementCount: 1,
      tombstoneCount: 2,
      measurementCacheCount: 3,
    });
  });

  test("means the measurement cache, and nothing that is not in it", () => {
    // `getMeasuredHeightMean` is what a windowed grid sizes its spacer from:
    // it knows how many rows are out there and not which, so the mean of what
    // rows have actually measured is the only calibration available to it.
    // Every clause below is a way that mean could be wrong while the row
    // heights it is derived from stay right.
    const a = data("a");
    const b = data("b");
    const c = data("c");

    // Estimates are not measurements. A grid that has rendered nothing has no
    // opinion, and says so rather than returning a mean of no samples.
    let index = createIndex([entry(a, 10), entry(b, 20), entry(c, 30)], 30, 2);
    expect(index.getMeasuredHeightMean()).toBeUndefined();

    index = index.measure(0, a, 40).measure(1, b, 60);
    expect(index.getMeasuredHeightMean()).toBe(50);

    // Re-measuring REPLACES. A running total incremented at each `measure`
    // would read 140/2 = 70 here; the structural aggregate reads what the
    // cache holds.
    index = index.measure(0, a, 80);
    expect(index.getMeasuredHeightMean()).toBe(70);

    // Re-estimating a row drops its measurement, and the mean with it.
    index = index.apply([
      { kind: "update", ref: a, index: 0, estimatedHeight: 11 },
    ]);
    expect(index.hasMeasurement(a)).toBe(false);
    expect(index.getMeasuredHeightMean()).toBe(60);

    // The case the spacer exists for: an EVICTED row is no longer drawn, but
    // its height is retained, and it still counts. Anything else and a fully
    // evicted region would fall back to the default height it was measured
    // away from.
    index = index.apply([{ kind: "remove", ref: b, previousIndex: 1 }]);
    expect(index.rowCount).toBe(2);
    expect(index.hasMeasurement(b)).toBe(true);
    expect(index.getMeasuredHeightMean()).toBe(60);

    // Retention is bounded at two here. Tombstoning a third measurement
    // evicts the oldest FROM THE CACHE, so it has to leave the mean too.
    // 30 and 100 average 65; leaving b's 60 in would read 63.33, so this
    // number can tell the two apart.
    index = index
      .measure(0, a, 30)
      .measure(1, c, 100)
      .apply([{ kind: "remove", ref: a, previousIndex: 0 }])
      .apply([{ kind: "remove", ref: c, previousIndex: 0 }]);
    expect(index.hasMeasurement(b)).toBe(false);
    expect(getRowHeightIndexDiagnosticsForTesting(index)).toMatchObject({
      measurementCacheCount: 2,
    });
    expect(index.getMeasuredHeightMean()).toBe(65);

    // Retaining nothing at all: the cache empties, and the caller is back to
    // its default height rather than to a stale mean.
    const unretained = createIndex([entry(a, 10)], 30, 0)
      .measure(0, a, 44)
      .apply([{ kind: "remove", ref: a, previousIndex: 0 }]);
    expect(unretained.getMeasuredHeightMean()).toBeUndefined();
  });

  test("means measurements that share a hash, and survives a rebuild", () => {
    // The collision tree is a second aggregation path, reached only by keys
    // whose identities hash alike — these two do, under the index's FNV-1a.
    const first = data("k-ielz1d-1wwy");
    const second = data("k-1i39yng-2umb");
    let index = createRowHeightIndex({
      defaultHeight: 30,
      getKey: (key: Key) => key.id,
      rows: [entry(first, 20), entry(second, 40)],
      maxRetainedMeasurements: 2,
    });
    expect(
      getRowHeightIndexDiagnosticsForTesting(index).identityComparisons,
    ).toBeGreaterThan(0);

    index = index.measure(0, first, 51).measure(1, second, 61);
    expect(index.getMeasuredHeightMean()).toBe(56);
    index = index.apply([{ kind: "remove", ref: first, previousIndex: 0 }]);
    expect(index.getMeasuredHeightMean()).toBe(56);

    // A cooperative replacement rebuilds every root from scratch. The mean is
    // recomputed with them, not carried over from the index it replaced.
    const builder = index.beginReplacement({
      rowCount: 1,
      entryAt: () => entry(data("k-1i39yng-2umb"), 40),
    });
    while (!builder.done) builder.advance({ maxUnits: 256, now: () => 0 });
    const rebuilt = builder.finish();
    expect(rebuilt.rowCount).toBe(1);
    expect(rebuilt.getHeight(0)).toBe(61);
    expect(rebuilt.getMeasuredHeightMean()).toBe(56);
  });

  test("replaces 100k rows with explicitly linear identity and measurement work", () => {
    const count = 100_000;
    const rows = Array.from({ length: count }, (_, index) =>
      entry(data(String(index)), 20),
    );
    let initial = createIndex(rows, 30, 100_000);
    for (let index = 0; index < count; index += 1_000) {
      initial = initial.measure(index, data(String(index)), 25);
    }

    const replaced = initial.replace([...rows].reverse());
    const work = getRowHeightIndexDiagnosticsForTesting(replaced);
    expect(work.entriesVisited).toBe(count);
    expect(work.measurementEntriesScanned).toBe(100);
    expect(work.previousEntriesScanned).toBe(count);
    expect(work.sortComparisons).toBe(0);
    expect(work.identityLookups).toBeLessThanOrEqual(count * 8 + 1_000);
    expect(work.identityComparisons).toBeLessThanOrEqual(count * 8 + 1_000);
    expect(work.nodesCreated).toBeLessThanOrEqual(count * 12);
    expect(replaced.getHeight(count - 1)).toBe(25);
  }, 30_000);

  test("rebuilds 100k replacement roots cooperatively with a hard slice cap", () => {
    const count = 100_000;
    const rows = Array.from({ length: count }, (_, index) =>
      entry(data(String(index)), 20),
    );
    const base = createIndex(rows, 30, 100_000)
      .measure(0, data("0"), 41)
      .measure(50_000, data("50000"), 42);
    let entryAtCalls = 0;
    const source = {
      rowCount: count,
      entryAt: (index: number) => {
        entryAtCalls += 1;
        return entry(data(String(count - index - 1)), 20);
      },
    };
    const builder = base.beginReplacement(source);

    expect(entryAtCalls).toBe(0);
    expectReplacementLifecycleError(() => builder.finish(), "not-ready");
    expect(() => builder.advance({ maxUnits: 32, deadline: 10 })).toThrow(
      /now.*deadline/i,
    );

    const first = builder.advance({ maxUnits: 10_000, now: () => 0 });
    expect(first.unitsThisSlice).toBe(256);
    expect(first.done).toBe(false);
    expect(first.completedUnits).toBe(256);
    expect(first.totalUnits).toBeGreaterThanOrEqual(first.completedUnits);
    expect(first.sourceRowsIngested).toBeGreaterThan(0);
    expect(replacementDiagnostics(builder)).toMatchObject({
      status: "pending",
      retainedBaseRootCount: 1,
      retainedSourceCount: 1,
      candidateArrayEntryCount: 256,
      candidateStackEntryCount: 0,
      candidateRootCount: 2,
      identitySetEntryCount: 256,
      maxSliceUnits: 256,
    });

    let slices = 1;
    let previousCompleted = first.completedUnits;
    let previousTotal = first.totalUnits;
    while (!builder.done) {
      const progress = builder.advance({ maxUnits: 256, now: () => 0 });
      expect(progress.unitsThisSlice).toBeLessThanOrEqual(256);
      expect(progress.completedUnits).toBeGreaterThan(previousCompleted);
      expect(progress.totalUnits).toBeGreaterThanOrEqual(previousTotal);
      expect(progress.totalUnits).toBeGreaterThanOrEqual(
        progress.completedUnits,
      );
      previousCompleted = progress.completedUnits;
      previousTotal = progress.totalUnits;
      slices += 1;
    }

    expect(slices).toBeGreaterThan(1_000);
    expect(entryAtCalls).toBe(count);
    const doneDiagnostics = replacementDiagnostics(builder);
    expect(doneDiagnostics).toMatchObject({
      status: "done",
      maxSliceUnits: 256,
      retainedBaseRootCount: 1,
      retainedSourceCount: 0,
    });
    expect(
      Object.values(
        doneDiagnostics.phaseUnits as Record<string, number>,
      ).reduce((total, units) => total + units, 0),
    ).toBe(doneDiagnostics.completedUnits);

    const rebuilt = builder.finish();
    const synchronous = base.replace([...rows].reverse());
    expect(rebuilt.rowCount).toBe(count);
    expect(rebuilt.getTotalHeight()).toBe(synchronous.getTotalHeight());
    for (const index of [0, 1, 49_999, 50_000, count - 2, count - 1]) {
      expect(rebuilt.keyAt(index)).toEqual(synchronous.keyAt(index));
      expect(rebuilt.getHeight(index)).toBe(synchronous.getHeight(index));
      expect(rebuilt.getOffsetForIndex(index)).toBe(
        synchronous.getOffsetForIndex(index),
      );
    }
    expect(rebuilt.getHeight(49_999)).toBe(42);
    expect(rebuilt.getHeight(count - 1)).toBe(41);
    expect(replacementDiagnostics(builder)).toMatchObject({
      status: "finished",
      retainedBaseRootCount: 0,
      retainedSourceCount: 0,
      candidateArrayEntryCount: 0,
      candidateStackEntryCount: 0,
      candidateRootCount: 0,
      identitySetEntryCount: 0,
    });
    expectReplacementLifecycleError(() => builder.finish(), "finished");
  }, 30_000);

  test("honors deadline and releases cancelled or failed replacement state", () => {
    const rows = Array.from({ length: 1_000 }, (_, index) =>
      entry(data(String(index)), 20),
    );
    const base = createIndex(rows, 30, 16).measure(0, data("0"), 44);
    const source = {
      rowCount: rows.length,
      entryAt: (index: number) => rows[rows.length - index - 1]!,
    };
    const deadlineBuilder = base.beginReplacement(source);
    let clock = 0;
    const deadlineProgress = deadlineBuilder.advance({
      maxUnits: 256,
      deadline: 4,
      now: () => clock++,
    });
    expect(deadlineProgress.unitsThisSlice).toBeGreaterThan(0);
    expect(deadlineProgress.unitsThisSlice).toBeLessThanOrEqual(4);
    expect(replacementDiagnostics(deadlineBuilder)).toMatchObject({
      maxSliceUnits: deadlineProgress.unitsThisSlice,
      maxSliceDuration: 4,
    });
    deadlineBuilder.cancel();
    deadlineBuilder.cancel();
    expect(replacementDiagnostics(deadlineBuilder)).toMatchObject({
      status: "cancelled",
      retainedBaseRootCount: 0,
      retainedSourceCount: 0,
      candidateArrayEntryCount: 0,
      candidateStackEntryCount: 0,
      candidateRootCount: 0,
      identitySetEntryCount: 0,
    });
    expectReplacementLifecycleError(
      () => deadlineBuilder.advance({ maxUnits: 1 }),
      "cancelled",
    );

    const failing = base.beginReplacement({
      rowCount: 10,
      entryAt: (index: number) => {
        if (index === 5) throw new Error("replacement source exploded");
        return entry(data(`next-${index}`), 25);
      },
    });
    expect(() => failing.advance({ maxUnits: 256 })).toThrow(
      "replacement source exploded",
    );
    expect(base.rowCount).toBe(1_000);
    expect(base.getHeight(0)).toBe(44);
    expect(replacementDiagnostics(failing)).toMatchObject({
      status: "failed",
      retainedBaseRootCount: 0,
      retainedSourceCount: 0,
      candidateArrayEntryCount: 0,
      candidateStackEntryCount: 0,
      candidateRootCount: 0,
      identitySetEntryCount: 0,
    });
    expectReplacementLifecycleError(
      () => failing.advance({ maxUnits: 1 }),
      "failed",
    );
  });

  test("slices semantic no-op detection instead of hiding a full old-root scan", () => {
    const rows = Array.from({ length: 1_000 }, (_, index) =>
      entry(data(String(index)), 20),
    );
    // Measured so the base holds retained state: an unmeasured base now takes
    // the synchronous bulk path, and this test's subject is the COOPERATIVE
    // slicing of the no-op scan. The measurement does not disturb the no-op —
    // that predicate reads identities and estimates only.
    const base = createIndex(rows).measure(0, data("0"), 41);
    const builder = base.beginReplacement({
      rowCount: rows.length,
      entryAt: (index) => entry(data(String(index)), 20),
    });

    while (builder.progress.sourceRowsIngested < rows.length) {
      builder.advance({
        maxUnits: Math.min(
          256,
          rows.length - builder.progress.sourceRowsIngested,
        ),
        now: () => 0,
      });
    }
    const afterIngest = builder.advance({ maxUnits: 1, now: () => 0 });
    expect(afterIngest.done).toBe(false);
    expect(afterIngest.phase).toBe("scan-retained");
    expect(afterIngest.previousRowsScanned).toBe(0);

    while (!builder.done) builder.advance({ maxUnits: 256, now: () => 0 });
    expect(builder.progress.previousRowsScanned).toBe(rows.length);
    expect(builder.finish()).toBe(base);
  });

  test("captures a hostile replacement source once with its method receiver", () => {
    const base = createIndex([entry(data("base"), 20)]);
    let rowCountGetterCalls = 0;
    let entryAtGetterCalls = 0;
    let originalEntryCalls = 0;
    let mutatedRowCountGetterCalls = 0;
    let mutatedEntryAtGetterCalls = 0;
    const receiver = { marker: "original" } as {
      marker: string;
      readonly rowCount: number;
      readonly entryAt: (index: number) => RowHeightEntry<Key>;
    };
    Object.defineProperties(receiver, {
      rowCount: {
        configurable: true,
        get: () => {
          rowCountGetterCalls += 1;
          return 3;
        },
      },
      entryAt: {
        configurable: true,
        get: () => {
          entryAtGetterCalls += 1;
          return function (this: { marker: string }, index: number) {
            expect(this).toBe(receiver);
            expect(this.marker).toBe("original");
            originalEntryCalls += 1;
            return entry(data(`captured-${index}`), 20 + index);
          };
        },
      },
    });

    const builder = base.beginReplacement(receiver);
    expect(rowCountGetterCalls).toBe(1);
    expect(entryAtGetterCalls).toBe(1);
    Object.defineProperties(receiver, {
      rowCount: {
        configurable: true,
        get: () => {
          mutatedRowCountGetterCalls += 1;
          return 99;
        },
      },
      entryAt: {
        configurable: true,
        get: () => {
          mutatedEntryAtGetterCalls += 1;
          return () => entry(data("mutated"), 99);
        },
      },
    });

    while (!builder.done) builder.advance({ maxUnits: 1, now: () => 0 });
    expect(originalEntryCalls).toBe(3);
    expect(mutatedRowCountGetterCalls).toBe(0);
    expect(mutatedEntryAtGetterCalls).toBe(0);
    expect(replacementDiagnostics(builder)).toMatchObject({
      retainedSourceCount: 0,
    });
    expect(builder.progress.sourceRowsIngested).toBe(3);
    const result = builder.finish();
    expect(result.rowCount).toBe(3);
    expect([0, 1, 2].map((index) => result.keyAt(index))).toEqual([
      data("captured-0"),
      data("captured-1"),
      data("captured-2"),
    ]);
  });

  test("rejects throwing or invalid replacement source getters atomically", () => {
    const base = createIndex([entry(data("base"), 20)]).measure(
      0,
      data("base"),
      44,
    );
    let rowCountReads = 0;
    const throwingRowCount = Object.defineProperties(
      {},
      {
        rowCount: {
          get: () => {
            rowCountReads += 1;
            throw new Error("rowCount getter exploded");
          },
        },
        entryAt: { value: () => entry(data("unused"), 20) },
      },
    ) as RowHeightReplacementSource<Key>;
    expect(() => base.beginReplacement(throwingRowCount)).toThrow(
      "rowCount getter exploded",
    );
    expect(rowCountReads).toBe(1);

    let entryAtReads = 0;
    const throwingEntryAt = Object.defineProperties(
      {},
      {
        rowCount: { value: 1 },
        entryAt: {
          get: () => {
            entryAtReads += 1;
            throw new Error("entryAt getter exploded");
          },
        },
      },
    ) as RowHeightReplacementSource<Key>;
    expect(() => base.beginReplacement(throwingEntryAt)).toThrow(
      "entryAt getter exploded",
    );
    expect(entryAtReads).toBe(1);

    for (const rowCount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      let reads = 0;
      const invalid = {
        get rowCount() {
          reads += 1;
          return rowCount;
        },
        entryAt: () => entry(data("unused"), 20),
      };
      expect(() => base.beginReplacement(invalid)).toThrow(RangeError);
      expect(reads).toBe(1);
    }
    let invalidEntryAtReads = 0;
    const invalidEntryAt = Object.defineProperties(
      {},
      {
        rowCount: { value: 1 },
        entryAt: {
          get: () => {
            invalidEntryAtReads += 1;
            return undefined;
          },
        },
      },
    ) as RowHeightReplacementSource<Key>;
    expect(() => base.beginReplacement(invalidEntryAt)).toThrow(TypeError);
    expect(invalidEntryAtReads).toBe(1);

    expect(base.rowCount).toBe(1);
    expect(base.keyAt(0)).toEqual(data("base"));
    expect(base.getHeight(0)).toBe(44);
  });

  test("leaves cache and sequence roots unchanged when replacement identity fails", () => {
    const getKey = (key: Key) => {
      if (key.id === "boom") throw new Error("replacement identity exploded");
      return stableKey(key);
    };
    const ref = data("a");
    const initial = createRowHeightIndex({
      defaultHeight: 30,
      getKey,
      rows: [entry(ref, 20)],
      maxRetainedMeasurements: 2,
    }).measure(0, ref, 44);
    const before = getRowHeightIndexDiagnosticsForTesting(initial);

    expect(() =>
      initial.replace([entry(data("b"), 10), entry(data("boom"), 10)]),
    ).toThrow("replacement identity exploded");
    expect(initial.keyAt(0)).toEqual(ref);
    expect(initial.getHeight(0)).toBe(44);
    expect(getRowHeightIndexDiagnosticsForTesting(initial)).toEqual(before);
  });

  test("changes logarithmic paths and viewport planning reads only its bounded window", () => {
    const count = 100_000;
    const rows = Array.from({ length: count }, (_, index) =>
      entry(data(String(index)), 20),
    );
    const initial = createIndex(rows);
    const operations = Array.from({ length: 50 }, (_, offset) => {
      const index = offset * 1_997;
      return {
        kind: "update" as const,
        ref: data(String(index)),
        index,
        estimatedHeight: 21,
      };
    });
    const changed = initial.apply(operations);
    const changedWork = getRowHeightIndexDiagnosticsForTesting(changed);
    expect(changedWork.entriesVisited).toBe(50);
    expect(changedWork.nodesCreated).toBeLessThan(5_000);
    expect(changed.rowCount).toBe(count);

    let outputReads = 0;
    let offsetReads = 0;
    let offsetIndexReads = 0;
    const reader: RowMetricsReader = {
      rowCount: changed.rowCount,
      getHeight: (index) => {
        outputReads += 1;
        return changed.getHeight(index);
      },
      getOffsetForIndex: (index) => {
        offsetReads += 1;
        return changed.getOffsetForIndex(index);
      },
      getIndexForOffset: (offset) => {
        offsetIndexReads += 1;
        return changed.getIndexForOffset(offset);
      },
      getTotalHeight: () => changed.getTotalHeight(),
    };
    const plan = planViewport({
      scrollTop: 1_000_000,
      viewportHeight: 2_000,
      overscan: 10,
      rowMetrics: reader,
    });
    expect(plan.rows.length).toBeLessThanOrEqual(121);
    expect(outputReads).toBe(plan.rows.length);
    expect(offsetReads).toBe(1);
    expect(offsetIndexReads).toBe(2);

    const rebuilt = changed.replace(rows);
    const rebuildWork = getRowHeightIndexDiagnosticsForTesting(rebuilt);
    expect(rebuildWork.entriesVisited).toBe(count);
    expect(rebuildWork.nodesCreated).toBeGreaterThanOrEqual(count);
  }, 30_000);

  test("matches an array oracle through deterministic mixed AVL rotations", () => {
    let randomState = 0x16a71;
    const random = (limit: number) => {
      randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0;
      return randomState % limit;
    };
    let nextId = 40;
    const expected = Array.from({ length: 40 }, (_, index) => ({
      ref: data(String(index)),
      estimatedHeight: 10 + (index % 9),
      measuredHeight: undefined as number | undefined,
    }));
    let index = createIndex(
      expected.map((row) => entry(row.ref, row.estimatedHeight)),
    );

    for (let step = 0; step < 1_000; step += 1) {
      const action = random(5);
      if (action === 0 || expected.length === 0) {
        const target = random(expected.length + 1);
        const row = {
          ref: data(String(nextId++)),
          estimatedHeight: 10 + random(50),
          measuredHeight: undefined,
        };
        expected.splice(target, 0, row);
        index = index.apply([
          {
            kind: "insert",
            ref: data(row.ref.id),
            index: target,
            estimatedHeight: row.estimatedHeight,
          },
        ]);
      } else if (action === 1) {
        const target = random(expected.length);
        const [removed] = expected.splice(target, 1);
        index = index.apply([
          {
            kind: "remove",
            ref: data(removed!.ref.id),
            previousIndex: target,
          },
        ]);
      } else if (action === 2) {
        const from = random(expected.length);
        const to = random(expected.length);
        const [moved] = expected.splice(from, 1);
        expected.splice(to, 0, moved!);
        index = index.apply([
          {
            kind: "move",
            ref: data(moved!.ref.id),
            previousIndex: from,
            index: to,
          },
        ]);
      } else if (action === 3) {
        const target = random(expected.length);
        const row = expected[target]!;
        row.estimatedHeight = 10 + random(50);
        row.measuredHeight = undefined;
        index = index.apply([
          {
            kind: "update",
            ref: data(row.ref.id),
            index: target,
            estimatedHeight: row.estimatedHeight,
          },
        ]);
      } else {
        const target = random(expected.length);
        const row = expected[target]!;
        row.measuredHeight = 60 + random(30);
        index = index.measure(target, data(row.ref.id), row.measuredHeight);
      }

      expect(index.rowCount).toBe(expected.length);
      let total = 0;
      for (let rowIndex = 0; rowIndex < expected.length; rowIndex += 1) {
        const row = expected[rowIndex]!;
        const height = row.measuredHeight ?? row.estimatedHeight;
        expect(index.keyAt(rowIndex)).toEqual(row.ref);
        expect(index.getOffsetForIndex(rowIndex)).toBe(total);
        expect(index.getHeight(rowIndex)).toBe(height);
        total += height;
      }
      expect(index.getTotalHeight()).toBe(total);
      expect(index.getOffsetForIndex(index.rowCount)).toBe(total);
      expect(
        getRowHeightIndexDiagnosticsForTesting(index).treeDepth,
      ).toBeLessThanOrEqual(Math.ceil(2 * Math.log2(index.rowCount + 1)) + 1);
    }
  }, 30_000);

  test("matches a bounded measurement-cache oracle through mixed replay", () => {
    const limit = 8;
    let randomState = 0x16ca_0e;
    const random = (upperBound: number) => {
      randomState = (randomState * 1_664_525 + 1_013_904_223) >>> 0;
      return randomState % upperBound;
    };
    let nextId = 0;
    type OracleRow = {
      readonly id: string;
      readonly estimatedHeight: number;
    };
    let rows: OracleRow[] = [];
    let tombstones: string[] = [];
    const measurements = new Map<string, number>();
    const knownIds = new Set<string>();
    let index = createIndex([], 30, limit);

    const makeFreshRow = (): OracleRow => {
      const id = `replay-${nextId++}`;
      knownIds.add(id);
      return { id, estimatedHeight: 10 + random(30) };
    };
    const enforceLimit = () => {
      while (tombstones.length > limit) {
        measurements.delete(tombstones.shift()!);
      }
    };

    for (let step = 0; step < 500; step += 1) {
      const action = random(5);
      if (action === 0 || rows.length === 0) {
        const tombstoneIndex =
          tombstones.length > 0 && random(3) === 0
            ? random(tombstones.length)
            : -1;
        const restoredId =
          tombstoneIndex < 0
            ? undefined
            : tombstones.splice(tombstoneIndex, 1)[0];
        const row =
          restoredId === undefined
            ? makeFreshRow()
            : { id: restoredId, estimatedHeight: 10 + random(30) };
        const target = random(rows.length + 1);
        rows.splice(target, 0, row);
        index = index.apply([
          {
            kind: "insert",
            ref: data(row.id),
            index: target,
            estimatedHeight: row.estimatedHeight,
          },
        ]);
      } else if (action === 1) {
        const target = random(rows.length);
        const [removed] = rows.splice(target, 1);
        index = index.apply([
          {
            kind: "remove",
            ref: data(removed!.id),
            previousIndex: target,
          },
        ]);
        if (measurements.has(removed!.id)) {
          tombstones.push(removed!.id);
          enforceLimit();
        }
      } else if (action === 2) {
        const target = random(rows.length);
        const row = rows[target]!;
        const height = 40 + random(30);
        measurements.set(row.id, height);
        index = index.measure(target, data(row.id), height);
      } else if (action === 3) {
        const target = random(rows.length);
        const current = rows[target]!;
        const updated = {
          id: current.id,
          estimatedHeight: 10 + random(30),
        };
        rows[target] = updated;
        measurements.delete(updated.id);
        index = index.apply([
          {
            kind: "update",
            ref: data(updated.id),
            index: target,
            estimatedHeight: updated.estimatedHeight,
          },
        ]);
      } else {
        const previousRows = rows;
        const nextRows = [...rows].reverse();
        if (nextRows.length > 0 && random(2) === 0) {
          nextRows.splice(random(nextRows.length), 1);
        }
        if (tombstones.length > 0 && random(2) === 0) {
          const restoredId = tombstones[random(tombstones.length)]!;
          nextRows.push({
            id: restoredId,
            estimatedHeight: 10 + random(30),
          });
        }
        if (nextRows.length < 30 && random(2) === 0) {
          nextRows.push(makeFreshRow());
        }

        const nextIds = new Set(nextRows.map((row) => row.id));
        tombstones = tombstones.filter((id) => !nextIds.has(id));
        for (const previous of previousRows) {
          if (measurements.has(previous.id) && !nextIds.has(previous.id)) {
            tombstones.push(previous.id);
          }
        }
        enforceLimit();
        rows = nextRows;
        index = index.replace(
          rows.map((row) => entry(data(row.id), row.estimatedHeight)),
        );
      }

      expect(index.rowCount).toBe(rows.length);
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex]!;
        expect(index.keyAt(rowIndex)).toEqual(data(row.id));
        expect(index.getHeight(rowIndex)).toBe(
          measurements.get(row.id) ?? row.estimatedHeight,
        );
      }
      for (const id of knownIds) {
        expect(index.hasMeasurement(data(id))).toBe(measurements.has(id));
      }
      const diagnostics = getRowHeightIndexDiagnosticsForTesting(index);
      expect(diagnostics.tombstoneCount).toBe(tombstones.length);
      expect(diagnostics.measurementCacheCount).toBe(measurements.size);
      expect(diagnostics.visibleMeasurementCount).toBe(
        rows.filter((row) => measurements.has(row.id)).length,
      );
      // The mean rides the same oracle. It is aggregated structurally rather
      // than threaded as a running total precisely so that inserts, removes,
      // re-measures, re-estimates, tombstone eviction past the limit and full
      // replacement rebuilds cannot each drift it — this is where that gets
      // checked, 500 steps of them, against a Map that knows the answer.
      const mean = index.getMeasuredHeightMean();
      if (measurements.size === 0) {
        expect(mean).toBeUndefined();
      } else {
        let expectedSum = 0;
        for (const height of measurements.values()) expectedSum += height;
        expect(mean! * measurements.size).toBeCloseTo(expectedSum, 6);
      }
    }
  }, 30_000);
});

describe("synchronous reorder over existing height entries", () => {
  /**
   * A base index with mixed measured and estimated entries: rows 0..N-1 with
   * varied estimates (including `undefined` → default height), every third row
   * measured to a height its estimate could not predict.
   */
  function reorderFixture(count = 25) {
    const keys = Array.from({ length: count }, (_, index) =>
      index % 5 === 0 ? group(String(index)) : data(String(index)),
    );
    const estimates = keys.map((_, index) =>
      index % 4 === 3 ? undefined : 18 + (index % 7) * 3,
    );
    let base = createIndex(
      keys.map((key, index) => entry(key, estimates[index])),
      30,
    );
    for (let index = 0; index < count; index += 3) {
      base = base.measure(index, keys[index]!, 51 + index);
    }
    return { keys, estimates, base, count };
  }

  function sourceFor(
    keys: readonly Key[],
    estimates?: readonly (number | undefined)[],
  ): RowHeightReplacementSource<Key> {
    return {
      rowCount: keys.length,
      entryAt: (index) => entry(keys[index]!, estimates?.[index]),
    };
  }

  /** Every rank's offset and height, plus the total: the full geometry. */
  function rankTable(index: RowHeightIndex<Key>) {
    return {
      rowCount: index.rowCount,
      total: index.getTotalHeight(),
      offsets: Array.from({ length: index.rowCount + 1 }, (_, rank) =>
        index.getOffsetForIndex(rank),
      ),
      heights: Array.from({ length: index.rowCount }, (_, rank) =>
        index.getHeight(rank),
      ),
    };
  }

  function permutations(count: number): Record<string, number[]> {
    const identity = Array.from({ length: count }, (_, index) => index);
    const reversal = [...identity].reverse();
    const swap = [...identity];
    [swap[3], swap[17]] = [swap[17]!, swap[3]!];
    return { reversal, swap, identity };
  }

  test("matches a full replacement oracle for reversal, swap, and identity", () => {
    const { keys, estimates, base, count } = reorderFixture();
    for (const order of Object.values(permutations(count))) {
      const orderedKeys = order.map((rank) => keys[rank]!);
      const orderedEstimates = order.map((rank) => estimates[rank]);
      const reordered = base.reorder(sourceFor(orderedKeys));
      const replaced = base.replace(
        orderedKeys.map((key, index) => entry(key, orderedEstimates[index])),
      );
      expect(rankTable(reordered)).toEqual(rankTable(replaced));
    }
  });

  test("reuses every existing entry and re-measures none", () => {
    const { keys, base, count } = reorderFixture();
    const reordered = base.reorder(sourceFor([...keys].reverse()));
    expect(getRowHeightIndexDiagnosticsForTesting(reordered)).toMatchObject({
      reorderEntriesReused: count,
      reorderEntriesRemeasured: 0,
    });
  });

  test("an identity-order reorder is a no-op returning the same index", () => {
    const { keys, base } = reorderFixture();
    expect(base.reorder(sourceFor(keys))).toBe(base);
  });

  test("a key absent from the existing rows throws instead of fabricating", () => {
    const { keys, base } = reorderFixture();
    const foreign = [...keys];
    foreign[6] = data("not-an-existing-row");
    let thrown: unknown;
    try {
      base.reorder(sourceFor(foreign));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/existing row/i);
    expect((thrown as Error).message).toContain("not-an-existing-row");
  });

  test("a key duplicated in the new order throws", () => {
    const { keys, base } = reorderFixture();
    const duplicated = [...keys];
    duplicated[6] = duplicated[7]!;
    expect(() => base.reorder(sourceFor(duplicated))).toThrow(/existing row/i);
  });

  test("a row-count mismatch throws in both directions", () => {
    const { keys, base } = reorderFixture();
    for (const rowCount of [keys.length - 1, keys.length + 1]) {
      let thrown: unknown;
      try {
        base.reorder({ rowCount, entryAt: (index) => entry(keys[index]!) });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(RangeError);
      expect((thrown as Error).message).toMatch(/row count/i);
    }
    expect(() =>
      base.reorder({ rowCount: 0.5, entryAt: () => entry(keys[0]!) }),
    ).toThrow(RangeError);
  });

  test("keeps estimates and measurements intact, ignoring source estimates", () => {
    const { keys, base, count } = reorderFixture();
    // Rank 1 is estimated (estimate 21), rank 3 is measured (54). Hand the
    // source wildly different estimates for every row: a reorder must not
    // re-estimate or re-measure, so the original heights survive verbatim.
    const reversedKeys = [...keys].reverse();
    const lyingEstimates = reversedKeys.map(() => 999);
    const reordered = base.reorder(sourceFor(reversedKeys, lyingEstimates));
    for (let rank = 0; rank < count; rank += 1) {
      expect(reordered.getHeight(rank)).toBe(base.getHeight(count - 1 - rank));
    }
    expect(reordered.getTotalHeight()).toBe(base.getTotalHeight());
  });

  test("leaves the old index untouched", () => {
    const { keys, base } = reorderFixture();
    const before = rankTable(base);
    const beforeDiagnostics = getRowHeightIndexDiagnosticsForTesting(base);
    const reordered = base.reorder(sourceFor([...keys].reverse()));
    expect(reordered).not.toBe(base);
    expect(rankTable(base)).toEqual(before);
    expect(getRowHeightIndexDiagnosticsForTesting(base)).toEqual(
      beforeDiagnostics,
    );
  });

  test("post-reorder mutations behave exactly like a replace-built index", () => {
    const { keys, estimates, base } = reorderFixture();
    const reversedKeys = [...keys].reverse();
    const reversedEntries = reversedKeys.map((key, index) =>
      entry(key, estimates[keys.length - 1 - index]),
    );
    const viaReorder = base.reorder(sourceFor(reversedKeys));
    const viaReplace = base.replace(reversedEntries);

    // A measurement update lands identically on both.
    const target = reversedKeys[4]!;
    const measuredReorder = viaReorder.measure(4, target, 77);
    const measuredReplace = viaReplace.measure(4, target, 77);
    expect(rankTable(measuredReorder)).toEqual(rankTable(measuredReplace));
    expect(measuredReorder.getHeight(4)).toBe(77);

    // A subsequent full replacement lands identically on both.
    const nextRows = [
      ...reversedEntries.slice(5),
      entry(data("fresh-a"), 22),
      entry(data("fresh-b")),
    ];
    expect(rankTable(measuredReorder.replace(nextRows))).toEqual(
      rankTable(measuredReplace.replace(nextRows)),
    );
  });
});

describe("bulk replacement when the base holds no retained state", () => {
  /** Every rank's offset and height, plus the total: the full geometry. */
  function rankTable(index: RowHeightIndex<Key>) {
    return {
      rowCount: index.rowCount,
      total: index.getTotalHeight(),
      keys: Array.from({ length: index.rowCount }, (_, rank) =>
        index.keyAt(rank),
      ),
      offsets: Array.from({ length: index.rowCount + 1 }, (_, rank) =>
        index.getOffsetForIndex(rank),
      ),
      heights: Array.from({ length: index.rowCount }, (_, rank) =>
        index.getHeight(rank),
      ),
    };
  }

  /** Mixed estimates: undefined (→ default) interleaved with varied numbers. */
  function mixedRows(count: number): RowHeightEntry<Key>[] {
    return Array.from({ length: count }, (_, index) =>
      entry(
        index % 5 === 0 ? group(String(index)) : data(String(index)),
        index % 4 === 3 ? undefined : 18 + (index % 7) * 3,
      ),
    );
  }

  function sourceOf(rows: readonly RowHeightEntry<Key>[]) {
    return {
      rowCount: rows.length,
      entryAt: (index: number) => rows[index]!,
    };
  }

  /**
   * Drives the COOPERATIVE builder over `source`. The base carries one
   * measurement on an identity disjoint from every source row, which forces
   * the retained-state path without affecting any produced height: the ingest
   * lookup misses for every source identity, and the pinned measurement only
   * lands in the result's tombstones, which `rankTable` never observes.
   */
  function cooperativeResult(
    source: RowHeightReplacementSource<Key>,
  ): RowHeightIndex<Key> {
    const pin = data("__cooperative-pin__");
    const base = createIndex([entry(pin)]).measure(0, pin, 77);
    expect(base.hasRetainedState).toBe(true);
    const builder = base.beginReplacement(source);
    const first = builder.advance({ maxUnits: 1, now: () => 0 });
    expect(first.done).toBe(false);
    while (!builder.done) builder.advance({ maxUnits: 256, now: () => 0 });
    return builder.finish();
  }

  test("hasRetainedState is false for empty and never-measured indexes", () => {
    const empty = createIndex([]);
    expect(empty.hasRetainedState).toBe(false);

    // 50k-shaped case in miniature: entries exist, but none carries a
    // measurement, so a replacement's retained-state lookups would all miss.
    const populated = createIndex(mixedRows(64));
    expect(populated.hasRetainedState).toBe(false);

    const replaced = populated.replace(mixedRows(32));
    expect(replaced.hasRetainedState).toBe(false);
  });

  test("hasRetainedState turns true with a measurement and with tombstones", () => {
    const rows = mixedRows(8);
    const measured = createIndex(rows).measure(1, rows[1]!.key, 44);
    expect(measured.hasRetainedState).toBe(true);

    // Removing the measured row converts the measurement into a tombstone +
    // retention-order entry; all three retained categories are now non-empty.
    const tombstoned = measured.apply([
      { kind: "remove", ref: rows[1]!.key, previousIndex: 1 },
    ]);
    expect(
      getRowHeightIndexDiagnosticsForTesting(tombstoned).tombstoneCount,
    ).toBe(1);
    expect(tombstoned.hasRetainedState).toBe(true);

    // `retainMeasurement` on an absent key is the other tombstone producer.
    const retained = createIndex(rows).retainMeasurement(data("gone"), 51);
    expect(retained.hasRetainedState).toBe(true);
  });

  test("hasRetainedState returns to false when retention is disabled", () => {
    // With maxRetainedMeasurements 0 a removal deletes the measurement instead
    // of tombstoning it, so the index can empty back out.
    const rows = mixedRows(4);
    const measured = createIndex(rows, 30, 0).measure(2, rows[2]!.key, 44);
    expect(measured.hasRetainedState).toBe(true);
    const emptied = measured.apply([
      { kind: "remove", ref: rows[2]!.key, previousIndex: 2 },
    ]);
    expect(
      getRowHeightIndexDiagnosticsForTesting(emptied).measurementCacheCount,
    ).toBe(0);
    expect(emptied.hasRetainedState).toBe(false);
  });

  test("a no-retained-state replacement completes on its first advance", () => {
    for (const count of [0, 1, 32, 1_000]) {
      const base = createIndex(mixedRows(Math.max(0, count - 7)));
      expect(base.hasRetainedState).toBe(false);
      const rows = mixedRows(count);
      const builder = base.beginReplacement(sourceOf(rows));
      const first = builder.advance({ maxUnits: 1, now: () => 0 });
      expect(first.done).toBe(true);
      expect(first.phase).toBe("done");
      expect(first.sourceRowsIngested).toBe(count);
      const result = builder.finish();
      expect(result.rowCount).toBe(count);
    }
  });

  test("bulk geometry equals the cooperative builder's at every rank", () => {
    for (const count of [0, 1, 32, 1_000]) {
      const rows = mixedRows(count);
      const base = createIndex([]);
      const builder = base.beginReplacement(sourceOf(rows));
      builder.advance({ maxUnits: 1, now: () => 0 });
      const bulk = builder.finish();
      expect(rankTable(bulk)).toEqual(
        rankTable(cooperativeResult(sourceOf(rows))),
      );
    }
  });

  test("a bulk replacement with an identical source is the same no-op", () => {
    const rows = mixedRows(24);
    const base = createIndex(rows);
    const builder = base.beginReplacement(sourceOf(rows));
    const first = builder.advance({ maxUnits: 1, now: () => 0 });
    expect(first.done).toBe(true);
    expect(builder.finish()).toBe(base);
  });

  test("a duplicate source identity fails exactly like the cooperative path", () => {
    const duplicated = {
      rowCount: 3,
      entryAt: (index: number) =>
        entry(data(index === 2 ? "0" : String(index))),
    };
    const bulkBuilder = createIndex([]).beginReplacement(duplicated);
    let bulkError: unknown;
    try {
      bulkBuilder.advance({ maxUnits: 1, now: () => 0 });
    } catch (error) {
      bulkError = error;
    }
    expect(bulkError).toBeInstanceOf(Error);
    expect((bulkError as Error).message).toMatch(
      /Duplicate stable row-height key/,
    );
    expectReplacementLifecycleError(
      () => bulkBuilder.advance({ maxUnits: 1 }),
      "failed",
    );

    let cooperativeError: unknown;
    try {
      cooperativeResult(duplicated);
    } catch (error) {
      cooperativeError = error;
    }
    expect((cooperativeError as Error).message).toBe(
      (bulkError as Error).message,
    );
  });

  test("post-bulk mutations behave exactly like a cooperatively built twin", () => {
    const rows = mixedRows(40);
    const builder = createIndex([]).beginReplacement(sourceOf(rows));
    builder.advance({ maxUnits: 1, now: () => 0 });
    const bulk = builder.finish();
    const cooperative = cooperativeResult(sourceOf(rows));

    // A measurement lands identically on both.
    const bulkMeasured = bulk.measure(4, rows[4]!.key, 91);
    const cooperativeMeasured = cooperative.measure(4, rows[4]!.key, 91);
    expect(rankTable(bulkMeasured)).toEqual(rankTable(cooperativeMeasured));
    expect(bulkMeasured.getHeight(4)).toBe(91);

    // A subsequent full replacement lands identically on both. Both twins now
    // carry a measurement, so both take the cooperative path.
    const nextRows = [
      ...rows.slice(9),
      entry(data("fresh-a"), 22),
      entry(data("fresh-b")),
    ];
    expect(rankTable(bulkMeasured.replace(nextRows))).toEqual(
      rankTable(cooperativeMeasured.replace(nextRows)),
    );

    // A permutation lands identically on both.
    const reversed = {
      rowCount: rows.length,
      entryAt: (index: number) => ({
        key: rows[rows.length - 1 - index]!.key,
      }),
    };
    expect(rankTable(bulkMeasured.reorder(reversed))).toEqual(
      rankTable(cooperativeMeasured.reorder(reversed)),
    );
  });

  test("any retained measurement disables the bulk path", () => {
    const rows = mixedRows(16);
    const base = createIndex(rows).measure(0, rows[0]!.key, 63);
    const builder = base.beginReplacement(sourceOf(mixedRows(48)));
    const first = builder.advance({ maxUnits: 1, now: () => 0 });
    expect(first.done).toBe(false);
    expect(first.phase).toBe("ingest");
    while (!builder.done) builder.advance({ maxUnits: 256, now: () => 0 });
    const result = builder.finish();
    expect(result.getHeight(0)).toBe(63);
  });
});
