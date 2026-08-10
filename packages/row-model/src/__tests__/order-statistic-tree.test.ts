import { describe, expect, test } from "vitest";
import {
  createOrderStatisticTree,
  getOrderStatisticTreePriorityForTesting,
  getOrderStatisticTreeRootForTesting,
  type OrderStatisticTree,
  type OrderStatisticTreeNodeForTesting,
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

describe("OrderStatisticTree", () => {
  test("uses deterministic stable-ID priorities", () => {
    const idsToInsert = ["delta", 7, "alpha", 2, "omega"] as const;
    const priorities = idsToInsert.map((id) =>
      getOrderStatisticTreePriorityForTesting(id),
    );

    expect(
      idsToInsert.map((id) => getOrderStatisticTreePriorityForTesting(id)),
    ).toEqual(priorities);
    expect(getOrderStatisticTreePriorityForTesting(1)).not.toBe(
      getOrderStatisticTreePriorityForTesting("1"),
    );

    const ascending = idsToInsert.reduce(
      (tree, id) => tree.insertOrReplace(item(id, 0)),
      createTree(),
    );
    const descending = [...idsToInsert]
      .reverse()
      .reduce((tree, id) => tree.insertOrReplace(item(id, 0)), createTree());

    const shape = (
      node: OrderStatisticTreeNodeForTesting<Item, number> | null,
    ): unknown =>
      node === null
        ? null
        : [node.entry.id, node.priority, shape(node.left), shape(node.right)];
    expect(shape(getOrderStatisticTreeRootForTesting(ascending))).toEqual(
      shape(getOrderStatisticTreeRootForTesting(descending)),
    );
  });

  test("mixes sequential stable IDs into a balanced expected shape", () => {
    let tree = createTree();
    for (let id = 0; id < 1_000; id += 1) {
      tree = tree.insertOrReplace(item(id, id));
    }

    const height = (
      node: OrderStatisticTreeNodeForTesting<Item, number> | null,
    ): number =>
      node === null ? 0 : 1 + Math.max(height(node.left), height(node.right));

    expect(height(getOrderStatisticTreeRootForTesting(tree))).toBeLessThan(40);
  });

  test("orders by the comparator and totalizes ties by stable ID", () => {
    const tree = createTree()
      .insertOrReplace(item("z", 1))
      .insertOrReplace(item("1", 1))
      .insertOrReplace(item(10, 1))
      .insertOrReplace(item(2, 1))
      .insertOrReplace(item("a", 0));

    expect(ids(tree)).toEqual(["a", 2, 10, "1", "z"]);
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

  test("caches correct subtree counts and generic measures", () => {
    let tree = createTree();
    for (let score = 0; score < 40; score += 1) {
      tree = tree.insertOrReplace(item(`id-${score}`, score, score + 1));
    }

    const verify = (
      node: OrderStatisticTreeNodeForTesting<Item, number> | null,
    ): { count: number; measure: number } => {
      if (node === null) return { count: 0, measure: 0 };
      const left = verify(node.left);
      const right = verify(node.right);
      expect(node.count).toBe(left.count + 1 + right.count);
      expect(node.measure).toBe(
        left.measure + node.entry.weight + right.measure,
      );
      return { count: node.count, measure: node.measure };
    };

    expect(verify(getOrderStatisticTreeRootForTesting(tree))).toEqual({
      count: 40,
      measure: 820,
    });
    expect(tree.measure).toBe(820);
    expect(tree.remove("id-20").measure).toBe(799);
  });

  test("computes leaf measures only for inserted or replaced entries", () => {
    let fromEntryCalls = 0;
    let tree = createOrderStatisticTree({
      getId: (entry: Item) => entry.id,
      compare: (left, right) => left.score - right.score,
      measure: {
        empty: "",
        fromEntry: (entry) => {
          fromEntryCalls += 1;
          return entry.label;
        },
        combine: (left, right) => left + right,
      },
    });

    for (let score = 0; score < 25; score += 1) {
      tree = tree.insertOrReplace(item(`id-${score}`, score));
    }
    expect(fromEntryCalls).toBe(25);

    const same = tree.entryAt(12)!;
    expect(tree.insertOrReplace(same)).toBe(tree);
    expect(fromEntryCalls).toBe(25);

    tree = tree.insertOrReplace({ ...same, label: "replacement" });
    expect(fromEntryCalls).toBe(26);
    expect(tree.measure.includes("replacement")).toBe(true);
  });

  test("keeps old roots immutable", () => {
    const original = createTree()
      .insertOrReplace(item("alpha", 1, 2))
      .insertOrReplace(item("beta", 2, 3))
      .insertOrReplace(item("gamma", 3, 5));
    const originalRoot = getOrderStatisticTreeRootForTesting(original);
    const updated = original
      .insertOrReplace(item("alpha", 4, 7))
      .remove("beta")
      .insertOrReplace(item("delta", 0, 11));

    expect(ids(original)).toEqual(["alpha", "beta", "gamma"]);
    expect(original.measure).toBe(10);
    expect(getOrderStatisticTreeRootForTesting(original)).toBe(originalRoot);
    expect(ids(updated)).toEqual(["delta", "gamma", "alpha"]);
    expect(updated.measure).toBe(23);
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

  test("matches a sorted-array oracle across seeded randomized operations", () => {
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
