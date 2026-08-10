import { describe, expect, test, vi } from "vitest";
import {
  createAggregateTree,
  type AggregateTree,
  type AggregateTreeLeaf,
  type PretableAggregator,
} from "..";

interface Row {
  readonly name: string;
}

interface TypedRow {
  readonly amount: number;
  readonly label: string;
}

function exerciseAggregateTreeTypes(): void {
  const typedAggregator: PretableAggregator<
    TypedRow,
    number,
    { readonly total: number },
    { readonly total: number }
  > = {
    init: () => ({ total: 0 }),
    accumulate: (accumulator, value) => ({
      total: accumulator.total + value,
    }),
    merge: (left, right) => ({ total: left.total + right.total }),
    finalize: (accumulator) => accumulator,
  };
  const inferred = createAggregateTree({
    columnId: "amount",
    aggregator: typedAggregator,
    snapshotAccumulator: (accumulator) => ({ total: accumulator.total }),
  });
  const inferredOutput: { readonly total: number } = inferred.finalize();
  void inferredOutput;
  // @ts-expect-error custom aggregator output stays inferred
  const wrongOutput: string = inferred.finalize();
  void wrongOutput;
  inferred.insertOrReplace({
    id: "ok",
    row: { amount: 1, label: "one" },
    value: 1,
    dependency: null,
  });
  inferred.insertOrReplace({
    id: "bad-row",
    // @ts-expect-error custom aggregator row input stays inferred
    row: { amount: 1 },
    value: 1,
    dependency: null,
  });
  inferred.insertOrReplace({
    id: "bad-value",
    row: { amount: 1, label: "one" },
    // @ts-expect-error custom aggregator value input stays inferred
    value: "1",
    dependency: null,
  });

  createAggregateTree<string, TypedRow, number | null, number>({
    columnId: "amount",
    aggregator: "sum",
  });
  createAggregateTree<string, TypedRow, string, number>({
    columnId: "label",
    aggregator: "count",
  });
  createAggregateTree<string, TypedRow, string, number>({
    columnId: "label",
    // @ts-expect-error numeric built-ins reject non-numeric TValue
    aggregator: "avg",
  });
}
void exerciseAggregateTreeTypes;

function leaf<TValue>(
  id: string | number,
  value: TValue,
  dependency = Number(id),
): AggregateTreeLeaf<string | number, Row, TValue, number> {
  return { id, row: { name: String(id) }, value, dependency };
}

function permutations<T>(values: readonly T[]): readonly (readonly T[])[] {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) =>
    permutations([...values.slice(0, index), ...values.slice(index + 1)]).map(
      (rest) => [value, ...rest],
    ),
  );
}

type NumericBuiltinName = "sum" | "avg" | "min" | "max";
type NumericValue = number | null | undefined;

function builtinTree(
  name: NumericBuiltinName,
): AggregateTree<string | number, Row, NumericValue, number, number | null>;
function builtinTree(
  name: "count",
): AggregateTree<string | number, Row, unknown, number, number | null>;
function builtinTree(
  name: NumericBuiltinName | "count",
):
  | AggregateTree<string | number, Row, NumericValue, number, number | null>
  | AggregateTree<string | number, Row, unknown, number, number | null>;
function builtinTree(name: NumericBuiltinName | "count") {
  const compare = (
    left: AggregateTreeLeaf<string | number, Row, unknown, number>,
    right: AggregateTreeLeaf<string | number, Row, unknown, number>,
  ) => left.dependency - right.dependency;
  return name === "count"
    ? createAggregateTree<string | number, Row, unknown, number>({
        columnId: "amount",
        aggregator: "count",
        compare,
      })
    : createAggregateTree<string | number, Row, NumericValue, number>({
        columnId: "amount",
        aggregator: name,
        compare,
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
      trees.count = trees.count.insertOrReplace(leaf(index, value, index));
      for (const name of ["sum", "avg", "min", "max"] as const) {
        trees[name] = trees[name].insertOrReplace(
          leaf(index, value as NumericValue, index),
        );
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

  test("makes exact sum and average independent of AVL history", () => {
    const values = [1e20, 0, -1e20, -1e-20] as const;
    const insertionOrders = permutations([0, 1, 2, 3] as const);

    for (const insertionOrder of insertionOrders) {
      let sum = builtinTree("sum");
      let average = builtinTree("avg");
      for (const index of insertionOrder) {
        const entry = leaf(index, values[index], index);
        sum = sum.insertOrReplace(entry);
        average = average.insertOrReplace(entry);
      }
      expect(sum.finalize()).toBe(-1e-20);
      expect(average.finalize()).toBe(-2.5e-21);
    }
  });

  test("rounds exact cancellation, subnormals, zero, and infinities", () => {
    const aggregate = (
      name: "sum" | "avg",
      values: readonly number[],
    ): number | null => {
      let tree = builtinTree(name);
      values.forEach((value, index) => {
        tree = tree.insertOrReplace(leaf(index, value, index));
      });
      return tree.finalize();
    };

    expect(
      aggregate("sum", [Number.MIN_VALUE, Number.MIN_VALUE, -Number.MIN_VALUE]),
    ).toBe(Number.MIN_VALUE);
    expect(Object.is(aggregate("sum", [-0, -0]), +0)).toBe(true);
    expect(aggregate("sum", [Infinity, 1])).toBe(Infinity);
    expect(aggregate("avg", [-Infinity, 1])).toBe(-Infinity);
    expect(aggregate("sum", [Infinity, -Infinity])).toBeNaN();
    expect(aggregate("avg", [Infinity, -Infinity])).toBeNaN();
    expect(Object.is(aggregate("avg", [Number.MIN_VALUE, 0]), +0)).toBe(true);
    expect(Object.is(aggregate("avg", [-Number.MIN_VALUE, 0]), -0)).toBe(true);
    expect(aggregate("avg", [Number.MIN_VALUE, Number.MIN_VALUE, 0])).toBe(
      Number.MIN_VALUE,
    );
    expect(aggregate("sum", [Number.MAX_VALUE, 2 ** 969])).toBe(
      Number.MAX_VALUE,
    );
    expect(aggregate("sum", [Number.MAX_VALUE, 2 ** 970])).toBe(Infinity);
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

  test("prefers an explicit snapshot option over the aggregator default", () => {
    const aggregatorSnapshot = vi.fn((accumulator: number[]) => [
      ...accumulator,
      100,
    ]);
    const optionSnapshot = vi.fn((accumulator: number[]) => [...accumulator]);
    const aggregator: PretableAggregator<Row, number, number[], number[]> = {
      init: () => [],
      accumulate: (accumulator, value) => [...accumulator, value],
      merge: (left, right) => [...left, ...right],
      snapshotAccumulator: aggregatorSnapshot,
      finalize: (accumulator) => accumulator,
    };
    const tree = createAggregateTree({
      columnId: "amount",
      aggregator,
      snapshotAccumulator: optionSnapshot,
    }).insertOrReplace({
      id: "one",
      row: { name: "one" },
      value: 1,
      dependency: undefined,
    });

    expect(tree.finalize()).toEqual([1]);
    expect(optionSnapshot).toHaveBeenCalledTimes(1);
    expect(aggregatorSnapshot).not.toHaveBeenCalled();
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
    const second = leaf("2", 3, 2);
    draft.insertOrReplace(second).remove("1");
    const frozen = draft.freeze();

    expect(source.finalize()).toBe(2);
    expect(frozen.finalize()).toBe(3);
    expect(draft.freeze()).toBe(frozen);
    expect(() => draft.insertOrReplace(second)).toThrow(/frozen/i);
    expect(() => draft.remove("2")).toThrow(/frozen/i);
  });
});
