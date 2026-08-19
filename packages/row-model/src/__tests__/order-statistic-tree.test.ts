import { describe, expect, test } from "vitest";
import {
  PoisonedTransientOrderStatisticTreeError,
  compareOrderStatisticTreeIds,
  createDeferredMeasureTransientOrderStatisticTree,
  createOrderStatisticTree,
  createOrderStatisticTreeFromSortedEntries,
  getOrderStatisticTreeDiagnosticsForTesting,
  type OrderStatisticTree,
  type OrderStatisticTreeNodeDiagnostic,
  type TransientOrderStatisticTree,
} from "../persistent/order-statistic-tree";

interface Item {
  readonly id: string | number;
  readonly score: number;
  readonly weight: number;
  readonly label: string;
}

function createTree(): OrderStatisticTree<string | number, Item, number> {
  return createOrderStatisticTree({
    getId: (entry: Item) => entry.id,
    compare: (left, right) => left.score - right.score,
    measure: {
      empty: 0,
      fromEntry: (entry) => entry.weight,
      combine: (left, right) => left + right,
    },
  });
}

function item(id: string | number, score: number, weight = score): Item {
  return { id, score, weight, label: String(id) };
}

function ids(tree: OrderStatisticTree<string | number, Item, number>) {
  return [...tree.entries()].map((entry) => entry.id);
}

function adversarialOrder(id: number): number {
  const value = `n:${id}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function verifyNodeDiagnostics<TId extends string | number>(
  node: OrderStatisticTreeNodeDiagnostic<TId> | null,
): { readonly count: number; readonly height: number } {
  if (node === null) return { count: 0, height: 0 };
  expect(Object.isFrozen(node)).toBe(true);
  const left = verifyNodeDiagnostics(node.left);
  const right = verifyNodeDiagnostics(node.right);
  expect(node.count).toBe(left.count + 1 + right.count);
  expect(node.height).toBe(1 + Math.max(left.height, right.height));
  expect(node.balance).toBe(left.height - right.height);
  expect(Math.abs(node.balance)).toBeLessThanOrEqual(1);
  return { count: node.count, height: node.height };
}

function expectPoisoned(operation: () => unknown): void {
  try {
    operation();
    throw new Error("Expected a poisoned-draft error.");
  } catch (error) {
    expect(error).toBeInstanceOf(PoisonedTransientOrderStatisticTreeError);
    expect(error).toMatchObject({
      code: "poisoned-transient-order-statistic-tree",
    });
  }
}

function assertDraftReadsPoisoned(
  draft: TransientOrderStatisticTree<string | number, Item, number>,
  iteratorCreatedBeforeFailure: IterableIterator<Item>,
): void {
  expectPoisoned(() => draft.size);
  expectPoisoned(() => draft.measure);
  expectPoisoned(() => draft.get("alpha"));
  expectPoisoned(() => draft.entryAt(0));
  expectPoisoned(() => draft.rankOf("alpha"));
  expectPoisoned(() => draft.range(0, 1));
  expectPoisoned(() => draft.entries());
  expectPoisoned(() => iteratorCreatedBeforeFailure.next());
  expectPoisoned(() => draft.insertOrReplace(item("delta", 4)));
  expectPoisoned(() => draft.remove("alpha"));
  expectPoisoned(() => draft.freeze());
}

describe("OrderStatisticTree", () => {
  test("seals deferred measures with one combine per tree edge", () => {
    let combines = 0;
    const empty = createOrderStatisticTree<number, Item, number>({
      getId: (entry) => entry.id as number,
      compare: (left, right) => left.score - right.score,
      measure: {
        empty: 0,
        fromEntry: (entry) => entry.weight,
        combine: (left, right) => {
          combines += 1;
          return left + right;
        },
      },
    });
    const entries = Array.from({ length: 257 }, (_, id) =>
      item(id, adversarialOrder(id), id + 1),
    );
    let ordinary = empty;
    const deferred = createDeferredMeasureTransientOrderStatisticTree(empty);
    for (const entry of entries) {
      ordinary = ordinary.insertOrReplace(entry);
      deferred.insertOrReplace(entry);
    }
    const ordinaryCombines = combines;

    expect(deferred.pendingMeasureCount).toBe(entries.length);
    expect(() => deferred.measure).toThrow(/must seal/);
    expect(() => deferred.freeze()).toThrow(/must seal/);
    expect(() =>
      createDeferredMeasureTransientOrderStatisticTree(
        empty.insertOrReplace(entries[0]!),
      ),
    ).toThrow(/empty tree/);

    const beforeFirst = deferred.pendingMeasureCount;
    expect(deferred.sealMeasureStep()).toBe(false);
    expect(deferred.pendingMeasureCount).toBe(beforeFirst - 1);
    expect(() => deferred.insertOrReplace(item(999, 999))).toThrow(
      /sealing started/,
    );
    while (deferred.pendingMeasureCount > 0) {
      const before = deferred.pendingMeasureCount;
      const done = deferred.sealMeasureStep();
      expect(deferred.pendingMeasureCount).toBe(before - 1);
      expect(done).toBe(deferred.pendingMeasureCount === 0);
    }
    expect(deferred.pendingMeasureCount).toBe(0);
    expect(combines - ordinaryCombines).toBe(entries.length - 1);

    const frozen = deferred.freeze();
    expect([...frozen.entries()]).toEqual([...ordinary.entries()]);
    expect(frozen.measure).toBe(ordinary.measure);
    expect(frozen.rankOf(128)).toBe(ordinary.rankOf(128));
    expect(frozen.range(70, 90)).toEqual(ordinary.range(70, 90));
    const updated = frozen.remove(128).insertOrReplace(item(999, -1, 5));
    expect(frozen.get(128)).toBe(entries[128]);
    expect(frozen.get(999)).toBeUndefined();
    expect(updated.get(128)).toBeUndefined();
    expect(updated.get(999)?.weight).toBe(5);
  });

  test("poisons a deferred draft when measure sealing fails", () => {
    const failure = new Error("deferred combine exploded");
    const empty = createOrderStatisticTree<number, Item, number>({
      getId: (entry) => entry.id as number,
      compare: (left, right) => left.score - right.score,
      measure: {
        empty: 0,
        fromEntry: (entry) => entry.weight,
        combine: () => {
          throw failure;
        },
      },
    });
    const deferred = createDeferredMeasureTransientOrderStatisticTree(empty);
    deferred.insertOrReplace(item(1, 1, 1));
    deferred.insertOrReplace(item(2, 2, 2));

    expect(deferred.sealMeasureStep()).toBe(false);
    expect(() => deferred.sealMeasureStep()).toThrow(failure);
    expectPoisoned(() => deferred.size);
    expectPoisoned(() => deferred.sealMeasureStep());
    expectPoisoned(() => deferred.freeze());
  });

  test("orders by the comparator and totalizes special mixed IDs", () => {
    const tree = createTree()
      .insertOrReplace(item("a", 1))
      .insertOrReplace(item("1", 1))
      .insertOrReplace(item(Number.NaN, 1))
      .insertOrReplace(item(1, 1))
      .insertOrReplace(item(0, 1))
      .insertOrReplace({ ...item(-0, 1), label: "negative-zero" });

    expect(tree.size).toBe(5);
    expect(ids(tree)).toEqual([-0, 1, Number.NaN, "1", "a"]);
    expect(tree.get(0)?.label).toBe("negative-zero");
    expect(tree.get(-0)?.label).toBe("negative-zero");
    expect(tree.rankOf(Number.NaN)).toBe(2);
  });

  test("inserts, replaces, repositions, removes, and preserves no-op identity", () => {
    const alpha = item("alpha", 1, 3);
    const original = createTree()
      .insertOrReplace(alpha)
      .insertOrReplace(item("beta", 2, 5));
    const replaced = original.insertOrReplace({
      ...alpha,
      score: 3,
      weight: 7,
    });
    const removed = replaced.remove("beta");

    expect(original.insertOrReplace(alpha)).toBe(original);
    expect(original.remove("missing")).toBe(original);
    expect(replaced.size).toBe(2);
    expect(replaced.get("alpha")).toMatchObject({ score: 3, weight: 7 });
    expect(ids(replaced)).toEqual(["beta", "alpha"]);
    expect(removed.size).toBe(1);
    expect(removed.get("beta")).toBeUndefined();
    expect(ids(removed)).toEqual(["alpha"]);
  });

  test("supports indexed reads, ranks, and clamped half-open ranges", () => {
    const tree = [4, 1, 3, 0, 2].reduce(
      (current, score) => current.insertOrReplace(item(`id-${score}`, score)),
      createTree(),
    );

    expect(tree.entryAt(0)?.score).toBe(0);
    expect(tree.entryAt(4)?.score).toBe(4);
    expect(tree.entryAt(-1)).toBeUndefined();
    expect(tree.entryAt(5)).toBeUndefined();
    expect(tree.rankOf("id-0")).toBe(0);
    expect(tree.rankOf("id-3")).toBe(3);
    expect(tree.rankOf("missing")).toBeUndefined();
    expect(tree.range(-10, 2).map((entry) => entry.score)).toEqual([0, 1]);
    expect(tree.range(2, 99).map((entry) => entry.score)).toEqual([2, 3, 4]);
    expect(tree.range(4, 2)).toEqual([]);
  });

  test("keeps monotonic and reverse insertion AVL-balanced", () => {
    const size = 100_000;
    let ascending = createTree();
    let descending = createTree();
    for (let id = 0; id < size; id += 1) {
      ascending = ascending.insertOrReplace(item(id, id, 1));
      descending = descending.insertOrReplace(
        item(size - id - 1, size - id - 1, 1),
      );
    }

    for (const tree of [ascending, descending]) {
      const diagnostics = getOrderStatisticTreeDiagnosticsForTesting(tree);
      expect(diagnostics.balanced).toBe(true);
      expect(diagnostics.count).toBe(size);
      expect(diagnostics.height).toBeLessThanOrEqual(
        Math.ceil(1.45 * Math.log2(size + 2)),
      );
      expect(tree.entryAt(0)?.score).toBe(0);
      expect(tree.entryAt(size - 1)?.score).toBe(size - 1);
      expect(tree.rankOf(Math.floor(size / 2))).toBe(Math.floor(size / 2));
      expect(tree.range(size - 3, size).map((entry) => entry.score)).toEqual([
        size - 3,
        size - 2,
        size - 1,
      ]);
      expect(tree.measure).toBe(size);
    }
  });

  test("stays AVL-balanced when comparator order is correlated with IDs", () => {
    const size = 100_000;
    let tree = createTree();
    const expected: Item[] = [];
    for (let id = 0; id < size; id += 1) {
      const next = item(id, adversarialOrder(id), 1);
      expected.push(next);
      tree = tree.insertOrReplace(next);
    }
    expected.sort(
      (left, right) =>
        left.score - right.score || (left.id as number) - (right.id as number),
    );

    const diagnostics = getOrderStatisticTreeDiagnosticsForTesting(tree);
    expect(diagnostics.balanced).toBe(true);
    expect(diagnostics.height).toBeLessThanOrEqual(
      Math.ceil(1.45 * Math.log2(size + 2)),
    );
    expect(diagnostics.count).toBe(size);
    expect(tree.measure).toBe(size);
    const middle = Math.floor(size / 2);
    expect(tree.entryAt(middle)).toBe(expected[middle]);
    expect(tree.rankOf(expected[middle]!.id)).toBe(middle);
    expect(tree.range(middle - 2, middle + 3)).toEqual(
      expected.slice(middle - 2, middle + 3),
    );
  });

  test("returns frozen diagnostics without exposing live tree nodes", () => {
    let tree = createTree();
    for (let score = 0; score < 40; score += 1) {
      tree = tree.insertOrReplace(item(`id-${score}`, score, score + 1));
    }

    const diagnostics = getOrderStatisticTreeDiagnosticsForTesting(tree);

    expect(Object.isFrozen(diagnostics)).toBe(true);
    expect(diagnostics).toMatchObject({ count: 40, balanced: true });
    expect(verifyNodeDiagnostics(diagnostics.root)).toEqual({
      count: 40,
      height: diagnostics.height,
    });
    expect(tree.measure).toBe(820);
    expect(tree.remove("id-20").measure).toBe(799);
    expect(Object.keys(tree)).toEqual([]);
    expect(Reflect.get(tree, "rootForTesting")).toBeUndefined();
    expect(Reflect.get(tree, "root")).toBeUndefined();
  });

  test("caches exact ordered noncommutative measures on changed paths", () => {
    let fromEntryCalls = 0;
    let tree = createOrderStatisticTree({
      getId: (entry: Item) => entry.id,
      compare: (left, right) => left.score - right.score,
      measure: {
        empty: "",
        fromEntry: (entry) => {
          fromEntryCalls += 1;
          return `${entry.label}|`;
        },
        combine: (left, right) => left + right,
      },
    });

    for (let score = 0; score < 25; score += 1) {
      tree = tree.insertOrReplace(item(`id-${score}`, score));
    }
    expect(fromEntryCalls).toBe(25);
    expect(tree.measure).toBe(
      [...tree.entries()].map((entry) => `${entry.label}|`).join(""),
    );

    const same = tree.entryAt(12)!;
    expect(tree.insertOrReplace(same)).toBe(tree);
    expect(fromEntryCalls).toBe(25);

    tree = tree.insertOrReplace({ ...same, label: "replacement" });
    expect(fromEntryCalls).toBe(26);
    expect(tree.measure).toBe(
      [...tree.entries()].map((entry) => `${entry.label}|`).join(""),
    );
  });

  test("keeps old roots immutable and reports structural sharing", () => {
    let original = createTree();
    for (let score = 0; score < 64; score += 1) {
      original = original.insertOrReplace(item(`id-${score}`, score, 1));
    }
    const updated = original.insertOrReplace(item("id-63", 63, 7));
    const diagnostics = getOrderStatisticTreeDiagnosticsForTesting(
      updated,
      original,
    );

    expect(original.get("id-63")?.weight).toBe(1);
    expect(original.measure).toBe(64);
    expect(updated.get("id-63")?.weight).toBe(7);
    expect(updated.measure).toBe(70);
    expect(diagnostics.sharedNodeCount).toBeGreaterThan(0);
    expect(diagnostics.sharedNodeCount).toBeLessThan(original.size);
  });

  test("batches transient edits and freezes safely", () => {
    const source = createTree()
      .insertOrReplace(item("alpha", 1, 2))
      .insertOrReplace(item("beta", 2, 3));
    const draft = source.asTransient();

    expect(draft.insertOrReplace(item("gamma", 0, 5))).toBe(draft);
    expect(draft.insertOrReplace(item("alpha", 4, 7))).toBe(draft);
    expect(draft.remove("beta")).toBe(draft);
    expect(draft.size).toBe(2);
    expect(draft.measure).toBe(12);
    expect(draft.entryAt(0)?.id).toBe("gamma");
    expect(draft.rankOf("alpha")).toBe(1);
    expect(draft.range(0, 1).map((entry) => entry.id)).toEqual(["gamma"]);
    expect([...draft.entries()].map((entry) => entry.id)).toEqual([
      "gamma",
      "alpha",
    ]);

    const frozen = draft.freeze();
    expect(draft.freeze()).toBe(frozen);
    expect(ids(source)).toEqual(["alpha", "beta"]);
    expect(ids(frozen)).toEqual(["gamma", "alpha"]);
    expect(draft.get("gamma")?.weight).toBe(5);
    expect(() => draft.insertOrReplace(item("delta", 5))).toThrow(/frozen/i);
    expect(() => draft.remove("gamma")).toThrow(/frozen/i);
  });

  test("matches a sorted-array oracle across transient randomized operations", () => {
    let randomState = 0xa511e9b3;
    const random = () => {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      return randomState;
    };
    const compare = (left: Item, right: Item) =>
      left.score - right.score || (left.id as number) - (right.id as number);
    const oracle = new Map<number, Item>();
    const draft = createOrderStatisticTree({
      getId: (entry: Item) => entry.id as number,
      compare: (left, right) => left.score - right.score,
      measure: {
        empty: 0,
        fromEntry: (entry) => entry.weight,
        combine: (left, right) => left + right,
      },
    }).asTransient();

    for (let operation = 0; operation < 3_000; operation += 1) {
      const id = random() % 257;
      if ((random() & 3) === 0) {
        draft.remove(id);
        oracle.delete(id);
      } else {
        const next = item(id, random() % 31, random() % 101);
        draft.insertOrReplace(next);
        oracle.set(id, next);
      }
      if (operation % 50 === 0) {
        const sorted = [...oracle.values()].sort(compare);
        expect([...draft.entries()]).toEqual(sorted);
        expect(draft.measure).toBe(
          sorted.reduce((sum, entry) => sum + entry.weight, 0),
        );
      }
    }

    const sorted = [...oracle.values()].sort(compare);
    const frozen = draft.freeze();
    expect([...frozen.entries()]).toEqual(sorted);
    expect(frozen.measure).toBe(
      sorted.reduce((sum, entry) => sum + entry.weight, 0),
    );
    expect(getOrderStatisticTreeDiagnosticsForTesting(frozen).balanced).toBe(
      true,
    );
  });

  test("poisons every transient operation after a comparator callback throws", () => {
    const callbackError = new Error("comparator failed");
    let throwForReplacement = false;
    const tree = createOrderStatisticTree({
      getId: (entry: Item) => entry.id,
      compare: (left, right) => {
        if (
          throwForReplacement &&
          (left.label === "replacement" || right.label === "replacement")
        ) {
          throw callbackError;
        }
        return left.score - right.score;
      },
      measure: {
        empty: 0,
        fromEntry: (entry) => entry.weight,
        combine: (left, right) => left + right,
      },
    })
      .insertOrReplace(item("alpha", 1))
      .insertOrReplace(item("beta", 2));
    const draft = tree.asTransient();
    const iterator = draft.entries();
    throwForReplacement = true;

    expect(() =>
      draft.insertOrReplace({
        ...item("alpha", 3),
        label: "replacement",
      }),
    ).toThrow(callbackError);
    assertDraftReadsPoisoned(draft, iterator);
    expect(ids(tree)).toEqual(["alpha", "beta"]);
    expect(tree.measure).toBe(3);
  });

  test("poisons a transient after a measure callback throws", () => {
    const callbackError = new Error("combine failed");
    let throwOnCombine = false;
    const tree = createOrderStatisticTree({
      getId: (entry: Item) => entry.id,
      compare: (left, right) => left.score - right.score,
      measure: {
        empty: 0,
        fromEntry: (entry) => entry.weight,
        combine: (left, right) => {
          if (throwOnCombine) throw callbackError;
          return left + right;
        },
      },
    })
      .insertOrReplace(item("alpha", 1))
      .insertOrReplace(item("beta", 2));
    const draft = tree.asTransient();
    throwOnCombine = true;

    expect(() => draft.insertOrReplace(item("gamma", 3))).toThrow(
      callbackError,
    );
    expectPoisoned(() => draft.get("alpha"));
    expectPoisoned(() => draft.freeze());
    expect(tree.size).toBe(2);
    expect(tree.measure).toBe(3);
  });

  test("preserves tree and ID index identity when comparator drift hides an ID", () => {
    let reversed = false;
    let tree = createOrderStatisticTree({
      getId: (entry: Item) => entry.id as number,
      compare: (left, right) =>
        (reversed ? -1 : 1) * (left.score - right.score),
      measure: {
        empty: 0,
        fromEntry: (entry) => entry.weight,
        combine: (left, right) => left + right,
      },
    });
    for (let id = 0; id < 7; id += 1) {
      tree = tree.insertOrReplace(item(id, id));
    }
    const rootId = getOrderStatisticTreeDiagnosticsForTesting(tree).root!.id;
    const hiddenId = rootId === 0 ? 6 : 0;
    reversed = true;

    const removal = tree.remove(hiddenId);

    expect(removal).toBe(tree);
    expect(removal.get(hiddenId)).toBeDefined();
  });

  test("matches a sorted-array oracle across seeded persistent operations", () => {
    let randomState = 0x6d2b79f5;
    const random = () => {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      return randomState;
    };
    const compare = (left: Item, right: Item) =>
      left.score - right.score || (left.id as number) - (right.id as number);
    const oracle = new Map<number, Item>();
    let tree = createOrderStatisticTree({
      getId: (entry: Item) => entry.id as number,
      compare: (left, right) => left.score - right.score,
      measure: {
        empty: 0,
        fromEntry: (entry) => entry.weight,
        combine: (left, right) => left + right,
      },
    });

    for (let operation = 0; operation < 2_000; operation += 1) {
      const id = random() % 257;
      if ((random() & 3) === 0) {
        tree = tree.remove(id);
        oracle.delete(id);
      } else {
        const next = item(id, random() % 31, random() % 101);
        tree = tree.insertOrReplace(next);
        oracle.set(id, next);
      }

      const sorted = [...oracle.values()].sort(compare);
      expect(tree.size).toBe(sorted.length);
      expect([...tree.entries()]).toEqual(sorted);
      expect(tree.measure).toBe(
        sorted.reduce((sum, entry) => sum + entry.weight, 0),
      );
      if (sorted.length > 0) {
        const rank = random() % sorted.length;
        expect(tree.entryAt(rank)).toEqual(sorted[rank]);
        expect(tree.rankOf(sorted[rank]!.id as number)).toBe(rank);
        const start = random() % (sorted.length + 1);
        const end = start + (random() % 12);
        expect(tree.range(start, end)).toEqual(sorted.slice(start, end));
      }
    }
  });
});

describe("createOrderStatisticTreeFromSortedEntries", () => {
  const compositeCompare = (left: Item, right: Item) =>
    left.score - right.score || compareOrderStatisticTreeIds(left.id, right.id);

  function sortedEntries(count: number): Item[] {
    const entries = Array.from({ length: count }, (_, id) =>
      item(id, adversarialOrder(id) % 97, (id % 13) + 1),
    );
    entries.sort(compositeCompare);
    return entries;
  }

  test("matches incremental construction observably", () => {
    const entries = sortedEntries(1_000);
    const bulk = createOrderStatisticTreeFromSortedEntries(
      createTree(),
      entries,
    );
    const incremental = entries.reduce(
      (tree, entry) => tree.insertOrReplace(entry),
      createTree(),
    );

    expect(bulk.size).toBe(incremental.size);
    for (let rank = 0; rank < entries.length; rank += 25) {
      const entry = incremental.entryAt(rank)!;
      expect(bulk.entryAt(rank)).toBe(entry);
      expect(bulk.rankOf(entry.id)).toBe(rank);
    }
    expect(bulk.entryAt(entries.length - 1)).toBe(
      incremental.entryAt(entries.length - 1),
    );
    expect(bulk.measure).toBe(incremental.measure);
  });

  test("builds an AVL-balanced tree at awkward sizes", () => {
    for (const size of [0, 1, 2, 3, 7, 8, 9, 1_000]) {
      const bulk = createOrderStatisticTreeFromSortedEntries(
        createTree(),
        sortedEntries(size),
      );
      const diagnostics = getOrderStatisticTreeDiagnosticsForTesting(bulk);
      expect(diagnostics.balanced).toBe(true);
      expect(diagnostics.count).toBe(size);
    }
  });

  test("supports later incremental mutation", () => {
    const entries = sortedEntries(100);
    let tree = createOrderStatisticTreeFromSortedEntries(createTree(), entries);

    const inserted = item("zzz-new", -1, 4);
    tree = tree.insertOrReplace(inserted);
    expect(tree.size).toBe(101);
    expect(tree.rankOf("zzz-new")).toBe(0);
    expect(tree.entryAt(0)).toBe(inserted);

    const victim = entries[50]!;
    tree = tree.remove(victim.id);
    expect(tree.size).toBe(100);
    expect(tree.get(victim.id)).toBeUndefined();
    expect(getOrderStatisticTreeDiagnosticsForTesting(tree).balanced).toBe(
      true,
    );
  });

  test("throws TypeError on comparator-order violations", () => {
    expect(() =>
      createOrderStatisticTreeFromSortedEntries(createTree(), [
        item("a", 1),
        item("b", 3),
        item("c", 2),
      ]),
    ).toThrow(TypeError);
  });

  test("throws when equal-compare entries have misordered IDs", () => {
    const first = item("beta", 5);
    const second = item("alpha", 5);
    expect(compareOrderStatisticTreeIds(first.id, second.id)).toBeGreaterThan(
      0,
    );
    expect(() =>
      createOrderStatisticTreeFromSortedEntries(createTree(), [first, second]),
    ).toThrow(TypeError);
  });

  test("throws on duplicate IDs", () => {
    const duplicate = item("alpha", 1);
    expect(() =>
      createOrderStatisticTreeFromSortedEntries(createTree(), [
        duplicate,
        duplicate,
      ]),
    ).toThrow(TypeError);
  });

  test("builds an empty tree from empty input", () => {
    const bulk = createOrderStatisticTreeFromSortedEntries(createTree(), []);
    expect(bulk.size).toBe(0);
    expect(bulk.measure).toBe(0);
    expect([...bulk.entries()]).toEqual([]);
  });

  test("throws TypeError for a foreign tree object", () => {
    const foreign = {
      size: 0,
      measure: 0,
    } as unknown as OrderStatisticTree<string | number, Item, number>;
    expect(() =>
      createOrderStatisticTreeFromSortedEntries(foreign, []),
    ).toThrow(TypeError);
  });

  test("caches ordered noncommutative measures identically to incremental", () => {
    const options = {
      getId: (entry: Item) => entry.id,
      compare: (left: Item, right: Item) => left.score - right.score,
      measure: {
        empty: "",
        fromEntry: (entry: Item) => `${entry.label}|`,
        combine: (left: string, right: string) => left + right,
      },
    };
    const entries = sortedEntries(63);
    const bulk = createOrderStatisticTreeFromSortedEntries(
      createOrderStatisticTree(options),
      entries,
    );
    const incremental = entries.reduce(
      (tree, entry) => tree.insertOrReplace(entry),
      createOrderStatisticTree(options),
    );
    expect(bulk.measure).toBe(incremental.measure);
    expect(bulk.measure).toBe(
      entries.map((entry) => `${entry.label}|`).join(""),
    );
  });
});
