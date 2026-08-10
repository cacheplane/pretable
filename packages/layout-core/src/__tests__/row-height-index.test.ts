import { describe, expect, test } from "vitest";

import { planViewport } from "../viewport-plan";
import { createRowMetricsIndex } from "../prefix-sums";
import {
  createRowHeightIndex,
  getRowHeightIndexDiagnosticsForTesting,
} from "../row-height-index";
import type {
  RowHeightEntry,
  RowHeightIndex,
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

function createIndex(
  rows: readonly RowHeightEntry<Key>[],
  defaultHeight = 30,
): RowHeightIndex<Key> {
  return createRowHeightIndex({ defaultHeight, getKey: stableKey, rows });
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
  });

  test("matches the legacy prefix reader while viewport planning migrates", () => {
    const heights = [20, 31, 42, 53, 64];
    const persistent = createIndex(
      heights.map((height, index) => entry(data(String(index)), height)),
    );
    const legacy = createRowMetricsIndex(heights);
    const input = { scrollTop: 36, viewportHeight: 90, overscan: 1 };

    expect(planViewport({ ...input, rowMetrics: persistent })).toEqual(
      planViewport({ ...input, rowMetrics: legacy }),
    );
  });

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
  });
});
