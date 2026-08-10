import { describe, expect, test } from "vitest";
import {
  createAggregateTree,
  type AggregateTree,
  type AggregateTreeLeaf,
  type PretableAggregator,
} from "..";

interface Row {
  readonly name: string;
}

function leaf(
  id: string | number,
  value: unknown,
  dependency = Number(id),
): AggregateTreeLeaf<string | number, Row, unknown, number> {
  return { id, row: { name: String(id) }, value, dependency };
}

function builtinTree(name: "sum" | "avg" | "min" | "max" | "count") {
  return createAggregateTree<string | number, Row, unknown, number>({
    columnId: "amount",
    aggregator: name,
    compare: (left, right) => left.dependency - right.dependency,
  });
}

describe("AggregateTree", () => {
  test("inserts, replaces, removes, and preserves semantic no-op identity", () => {
    const alpha = leaf("1", 4, 1);
    const original = builtinTree("sum")
      .insertOrReplace(alpha)
      .insertOrReplace(leaf("2", 7, 2));
    const equivalentAlpha = { ...alpha };
    const replaced = original.insertOrReplace(leaf("1", 10, 1));
    const removed = replaced.remove("2");

    expect(original.size).toBe(2);
    expect(original.finalize()).toBe(11);
    expect(original.insertOrReplace(alpha)).toBe(original);
    expect(original.insertOrReplace(equivalentAlpha)).toBe(original);
    expect(original.remove("missing")).toBe(original);
    expect(replaced.finalize()).toBe(17);
    expect(removed.size).toBe(1);
    expect(removed.finalize()).toBe(10);
  });

  test("uses the aggregator identity for empty trees", () => {
    for (const name of ["sum", "avg", "min", "max", "count"] as const) {
      expect(builtinTree(name).finalize()).toBeNull();
    }
  });

  test("matches legacy numeric and row-count built-in semantics", () => {
    const values = [3, null, Number.NaN, "8", undefined, -2];
    const trees = {
      sum: builtinTree("sum"),
      avg: builtinTree("avg"),
      min: builtinTree("min"),
      max: builtinTree("max"),
      count: builtinTree("count"),
    };

    values.forEach((value, index) => {
      for (const name of Object.keys(trees) as (keyof typeof trees)[]) {
        trees[name] = trees[name].insertOrReplace(leaf(index, value, index));
      }
    });

    expect(trees.sum.finalize()).toBe(1);
    expect(trees.avg.finalize()).toBe(0.5);
    expect(trees.min.finalize()).toBe(-2);
    expect(trees.max.finalize()).toBe(3);
    expect(trees.count.finalize()).toBe(values.length);

    expect(
      builtinTree("sum").insertOrReplace(leaf(1, Infinity)).finalize(),
    ).toBe(Infinity);
    expect(
      builtinTree("min").insertOrReplace(leaf(1, -Infinity)).finalize(),
    ).toBe(-Infinity);
    expect(
      builtinTree("max").insertOrReplace(leaf(1, Infinity)).finalize(),
    ).toBe(Infinity);
  });

  test("preserves legacy ordered signed-zero extrema", () => {
    const minimum = builtinTree("min")
      .insertOrReplace(leaf("positive", +0, 1))
      .insertOrReplace(leaf("negative", -0, 2));
    const maximum = builtinTree("max")
      .insertOrReplace(leaf("negative", -0, 1))
      .insertOrReplace(leaf("positive", +0, 2));

    expect(Object.is(minimum.finalize(), +0)).toBe(true);
    expect(Object.is(maximum.finalize(), -0)).toBe(true);
  });

  test("supports ordered custom monoids", () => {
    const concatenate: PretableAggregator<Row, string, string, string> = {
      init: () => "",
      accumulate: (accumulator, value) => accumulator + value,
      merge: (left, right) => left + right,
      finalize: (accumulator) => accumulator,
    };
    let tree = createAggregateTree<string, Row, string, number, string, string>(
      {
        columnId: "name",
        aggregator: concatenate,
        compare: (left, right) => left.dependency - right.dependency,
      },
    );

    tree = tree
      .insertOrReplace({
        id: "c",
        row: { name: "C" },
        value: "C",
        dependency: 3,
      })
      .insertOrReplace({
        id: "a",
        row: { name: "A" },
        value: "A",
        dependency: 1,
      })
      .insertOrReplace({
        id: "b",
        row: { name: "B" },
        value: "B",
        dependency: 2,
      });

    expect(tree.finalize()).toBe("ABC");
  });

  test("does only logarithmically many merges per persistent update", () => {
    let mergeCalls = 0;
    const sum: PretableAggregator<Row, number, number, number> = {
      init: () => 0,
      accumulate: (accumulator, value) => accumulator + value,
      merge(left, right) {
        mergeCalls += 1;
        return left + right;
      },
      finalize: (accumulator) => accumulator,
    };
    let tree = createAggregateTree<number, Row, number, number, number, number>(
      {
        columnId: "amount",
        aggregator: sum,
        compare: (left, right) => left.dependency - right.dependency,
      },
    );
    const size = 4096;
    for (let id = 0; id < size; id += 1) {
      tree = tree.insertOrReplace({
        id,
        row: { name: String(id) },
        value: id,
        dependency: id,
      });
    }

    const logarithmicBound = 16 * Math.ceil(Math.log2(size + 2));
    mergeCalls = 0;
    tree = tree.insertOrReplace({
      id: size / 2,
      row: { name: "changed" },
      value: 99,
      dependency: size / 2,
    });
    expect(mergeCalls).toBeLessThanOrEqual(logarithmicBound);

    mergeCalls = 0;
    tree = tree.remove(size / 3);
    expect(mergeCalls).toBeLessThanOrEqual(logarithmicBound);
  });

  test("keeps all and filtered population roots independent", () => {
    const outputAggregator: PretableAggregator<
      Row,
      number,
      number,
      { readonly total: number }
    > = {
      init: () => 0,
      accumulate: (accumulator, value) => accumulator + value,
      merge: (left, right) => left + right,
      finalize: (total) => ({ total }),
    };
    const createPopulation = (): AggregateTree<
      string,
      Row,
      number,
      number,
      { readonly total: number }
    > =>
      createAggregateTree({
        columnId: "amount",
        aggregator: outputAggregator,
        compare: (left, right) => left.dependency - right.dependency,
      });
    const first = { id: "a", row: { name: "a" }, value: 2, dependency: 1 };
    const second = { id: "b", row: { name: "b" }, value: 5, dependency: 2 };
    const all = createPopulation()
      .insertOrReplace(first)
      .insertOrReplace(second);
    const filtered = createPopulation().insertOrReplace(first);
    const filteredOutput = filtered.finalize();
    const changedAll = all.insertOrReplace({ ...second, value: 9 });

    expect(all.finalize()).toEqual({ total: 7 });
    expect(changedAll.finalize()).toEqual({ total: 11 });
    expect(filtered.finalize()).toBe(filteredOutput);
    expect(filteredOutput).toEqual({ total: 2 });
  });

  test("memoizes finalized object output and keeps old roots immutable", () => {
    const summaries: PretableAggregator<
      Row,
      string,
      readonly string[],
      { readonly names: readonly string[] }
    > = {
      init: () => [],
      accumulate: (accumulator, value) => [...accumulator, value],
      merge: (left, right) => [...left, ...right],
      finalize: (names) => ({ names }),
    };
    const empty = createAggregateTree<
      string,
      Row,
      string,
      number,
      readonly string[],
      { readonly names: readonly string[] }
    >({
      columnId: "name",
      aggregator: summaries,
      compare: (left, right) => left.dependency - right.dependency,
    });
    const emptyOutput = empty.finalize();
    const original = empty.insertOrReplace({
      id: "a",
      row: { name: "a" },
      value: "a",
      dependency: 1,
    });
    const originalOutput = original.finalize();
    const updated = original.insertOrReplace({
      id: "b",
      row: { name: "b" },
      value: "b",
      dependency: 2,
    });

    expect(emptyOutput).toEqual({ names: [] });
    expect(empty.finalize()).toBe(emptyOutput);
    expect(original.finalize()).toBe(originalOutput);
    expect(originalOutput).toEqual({ names: ["a"] });
    expect(updated.finalize()).toEqual({ names: ["a", "b"] });
    expect(original.finalize()).toBe(originalOutput);
  });

  test("does not expose a live custom accumulator through finalize", () => {
    const identityFinalize: PretableAggregator<
      Row,
      number,
      number[],
      number[]
    > = {
      init: () => [],
      accumulate: (accumulator, value) => [...accumulator, value],
      merge: (left, right) => [...left, ...right],
      finalize: (accumulator) => accumulator,
    };
    const firstRow = { name: "first" };
    const original = createAggregateTree<
      string,
      Row,
      number,
      number,
      number[],
      number[]
    >({
      columnId: "amount",
      aggregator: identityFinalize,
      compare: (left, right) => left.dependency - right.dependency,
    }).insertOrReplace({
      id: "first",
      row: firstRow,
      value: 1,
      dependency: 1,
    });

    const exposed = original.finalize();
    exposed.push(99);
    const branch = original.insertOrReplace({
      id: "second",
      row: { name: "second" },
      value: 2,
      dependency: 2,
    });

    expect(exposed).toEqual([1, 99]);
    expect(branch.finalize()).toEqual([1, 2]);
  });

  test("rejects shared-memory snapshots unless a hook truly detaches them", () => {
    const sharedBytes: PretableAggregator<Row, number, Uint8Array, Uint8Array> =
      {
        init: () => new Uint8Array(new SharedArrayBuffer(1)),
        accumulate(accumulator, value) {
          accumulator[0] = (accumulator[0] ?? 0) + value;
          return accumulator;
        },
        merge(left, right) {
          const merged = new Uint8Array(new SharedArrayBuffer(1));
          merged[0] = (left[0] ?? 0) + (right[0] ?? 0);
          return merged;
        },
        finalize: (accumulator) => accumulator,
      };
    const createSharedTree = (
      snapshotAccumulator?: (accumulator: Uint8Array) => Uint8Array,
    ) =>
      createAggregateTree<string, Row, number, number, Uint8Array, Uint8Array>({
        columnId: "amount",
        aggregator: sharedBytes,
        snapshotAccumulator,
        compare: (left, right) => left.dependency - right.dependency,
      }).insertOrReplace({
        id: "first",
        row: { name: "first" },
        value: 1,
        dependency: 1,
      });

    expect(() => createSharedTree().finalize()).toThrow(/SharedArrayBuffer/);
    expect(() =>
      createSharedTree((accumulator) =>
        structuredClone(accumulator),
      ).finalize(),
    ).toThrow(/SharedArrayBuffer/);

    const original = createSharedTree(
      (accumulator) => new Uint8Array(accumulator),
    );
    const exposed = original.finalize();
    exposed[0] = 99;
    const branch = original.insertOrReplace({
      id: "second",
      row: { name: "second" },
      value: 2,
      dependency: 2,
    });

    expect(branch.finalize()[0]).toBe(3);
  });

  test("supports transient batches without changing the source root", () => {
    const source = builtinTree("sum").insertOrReplace(leaf("1", 2, 1));
    const draft = source.asTransient();
    draft.insertOrReplace(leaf("2", 3, 2)).remove("1");
    const frozen = draft.freeze();

    expect(source.finalize()).toBe(2);
    expect(frozen.finalize()).toBe(3);
    expect(draft.freeze()).toBe(frozen);
    expect(() => draft.remove("2")).toThrow(/frozen/i);
  });
});
