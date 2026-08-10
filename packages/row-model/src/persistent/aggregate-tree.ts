import type { AggregatorLawValidator } from "../aggregator-law";
import type { PretableAggregator } from "../column-types";
import {
  createOrderStatisticTree,
  type OrderStatisticTree,
  type OrderStatisticTreeId,
  type TransientOrderStatisticTree,
} from "./order-statistic-tree";

const DEVELOPMENT = process.env.NODE_ENV !== "production";

export type AggregateTreeId = OrderStatisticTreeId;
export type BuiltinAggregatorName = "sum" | "avg" | "min" | "max" | "count";

export interface AggregateTreeLeaf<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency = unknown,
> {
  readonly id: TId;
  /** Rows and values observed by the aggregator must remain immutable. */
  readonly row: TRow;
  readonly value: TValue;
  /**
   * Opaque ordering/query dependency included in semantic no-op detection.
   * Values observed by `compare` must remain immutable after insertion.
   */
  readonly dependency: TDependency;
}

export interface AggregateTree<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
  TOutput,
> {
  readonly size: number;
  insertOrReplace(
    leaf: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  ): AggregateTree<TId, TRow, TValue, TDependency, TOutput>;
  remove(id: TId): AggregateTree<TId, TRow, TValue, TDependency, TOutput>;
  finalize(): TOutput;
  asTransient(): TransientAggregateTree<
    TId,
    TRow,
    TValue,
    TDependency,
    TOutput
  >;
}

export interface TransientAggregateTree<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
  TOutput,
> {
  readonly size: number;
  insertOrReplace(
    leaf: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  ): this;
  remove(id: TId): this;
  finalize(): TOutput;
  freeze(): AggregateTree<TId, TRow, TValue, TDependency, TOutput>;
}

export interface CustomAggregateTreeOptions<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
  TAccumulator,
  TOutput,
> {
  readonly columnId: string;
  /**
   * `init`, `merge`, and `finalize` must be pure. In particular, `merge` must
   * never mutate a child accumulator because those values belong to cached
   * persistent roots. `accumulate` may mutate the fresh leaf accumulator it is
   * given and return it.
   */
  readonly aggregator: PretableAggregator<TRow, TValue, TAccumulator, TOutput>;
  readonly compare?: (
    left: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
    right: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  ) => number;
  readonly lawValidator?: AggregatorLawValidator;
}

export interface BuiltinAggregateTreeOptions<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
> {
  readonly columnId: string;
  readonly aggregator: BuiltinAggregatorName;
  readonly compare?: (
    left: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
    right: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  ) => number;
}

interface SumAccumulator {
  readonly sum: number;
  readonly count: number;
}

interface ExtremumAccumulator {
  readonly value: number | null;
}

interface CountAccumulator {
  readonly count: number;
}

type BuiltinAccumulator =
  SumAccumulator | ExtremumAccumulator | CountAccumulator;

function aggregatableNumber(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

const sum: PretableAggregator<object, unknown, SumAccumulator, number | null> =
  {
    init: () => ({ sum: 0, count: 0 }),
    accumulate: (accumulator, value) =>
      aggregatableNumber(value)
        ? { sum: accumulator.sum + value, count: accumulator.count + 1 }
        : accumulator,
    merge: (left, right) => ({
      sum: left.sum + right.sum,
      count: left.count + right.count,
    }),
    finalize: (accumulator) =>
      accumulator.count === 0 ? null : accumulator.sum,
  };

const avg: PretableAggregator<object, unknown, SumAccumulator, number | null> =
  {
    init: sum.init,
    accumulate: sum.accumulate,
    merge: sum.merge,
    finalize: (accumulator) =>
      accumulator.count === 0 ? null : accumulator.sum / accumulator.count,
  };

function extremum(kind: "min" | "max") {
  return {
    init: (): ExtremumAccumulator => ({ value: null }),
    accumulate(
      accumulator: ExtremumAccumulator,
      value: unknown,
    ): ExtremumAccumulator {
      if (!aggregatableNumber(value)) return accumulator;
      if (accumulator.value === null) return { value };
      return {
        value:
          kind === "min"
            ? Math.min(accumulator.value, value)
            : Math.max(accumulator.value, value),
      };
    },
    merge(
      left: ExtremumAccumulator,
      right: ExtremumAccumulator,
    ): ExtremumAccumulator {
      if (left.value === null) return right;
      if (right.value === null) return left;
      return {
        value:
          kind === "min"
            ? Math.min(left.value, right.value)
            : Math.max(left.value, right.value),
      };
    },
    finalize: (accumulator: ExtremumAccumulator) => accumulator.value,
  } satisfies PretableAggregator<
    object,
    unknown,
    ExtremumAccumulator,
    number | null
  >;
}

const count: PretableAggregator<
  object,
  unknown,
  CountAccumulator,
  number | null
> = {
  init: () => ({ count: 0 }),
  accumulate: (accumulator) => ({ count: accumulator.count + 1 }),
  merge: (left, right) => ({ count: left.count + right.count }),
  finalize: (accumulator) =>
    accumulator.count === 0 ? null : accumulator.count,
};

/** Pure, persistent-safe built-in monoids matching the legacy grid semantics. */
export const aggregateTreeBuiltinAggregators = Object.freeze({
  sum,
  avg,
  min: extremum("min"),
  max: extremum("max"),
  count,
});

interface TreeContext<TRow extends object, TValue, TAccumulator, TOutput> {
  readonly columnId: string;
  readonly aggregator: PretableAggregator<TRow, TValue, TAccumulator, TOutput>;
  readonly lawValidator: AggregatorLawValidator | undefined;
  readonly custom: boolean;
}

interface FinalizedCache<TAccumulator, TOutput> {
  readonly accumulator: TAccumulator;
  ready: boolean;
  output?: TOutput;
}

function sameLeaf<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
>(
  left: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  right: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
): boolean {
  return (
    Object.is(left.row, right.row) &&
    Object.is(left.value, right.value) &&
    Object.is(left.dependency, right.dependency)
  );
}

function normalizedLeaf<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
>(
  leaf: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
): AggregateTreeLeaf<TId, TRow, TValue, TDependency> {
  return Object.freeze({
    id: leaf.id,
    row: leaf.row,
    value: leaf.value,
    dependency: leaf.dependency,
  });
}

function finalizedValue<TAccumulator, TOutput>(
  accumulator: TAccumulator,
  aggregator: PretableAggregator<object, unknown, TAccumulator, TOutput>,
  cache: FinalizedCache<TAccumulator, TOutput>,
): TOutput {
  if (!Object.is(cache.accumulator, accumulator)) {
    throw new Error("Aggregate finalization cache does not match its root.");
  }
  if (!cache.ready) {
    cache.output = aggregator.finalize(accumulator);
    cache.ready = true;
  }
  return cache.output as TOutput;
}

class PersistentAggregateTree<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
  TAccumulator,
  TOutput,
> implements AggregateTree<TId, TRow, TValue, TDependency, TOutput> {
  readonly #tree: OrderStatisticTree<
    TId,
    AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
    TAccumulator
  >;
  readonly #context: TreeContext<TRow, TValue, TAccumulator, TOutput>;
  readonly #cache: FinalizedCache<TAccumulator, TOutput>;

  constructor(
    tree: OrderStatisticTree<
      TId,
      AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
      TAccumulator
    >,
    context: TreeContext<TRow, TValue, TAccumulator, TOutput>,
    cache?: FinalizedCache<TAccumulator, TOutput>,
  ) {
    this.#tree = tree;
    this.#context = context;
    this.#cache =
      cache !== undefined && Object.is(cache.accumulator, tree.measure)
        ? cache
        : { accumulator: tree.measure, ready: false };
  }

  get size(): number {
    return this.#tree.size;
  }

  insertOrReplace(
    leaf: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  ): AggregateTree<TId, TRow, TValue, TDependency, TOutput> {
    const previous = this.#tree.get(leaf.id);
    if (previous !== undefined && sameLeaf(previous, leaf)) return this;
    const nextTree = this.#tree.insertOrReplace(normalizedLeaf(leaf));
    if (nextTree === this.#tree) return this;
    if (this.#context.custom) {
      this.#context.lawValidator?.observe({
        aggregator: this.#context.aggregator,
        columnId: this.#context.columnId,
        row: leaf.row,
        value: leaf.value,
      });
    }
    return new PersistentAggregateTree(nextTree, this.#context, this.#cache);
  }

  remove(id: TId): AggregateTree<TId, TRow, TValue, TDependency, TOutput> {
    const nextTree = this.#tree.remove(id);
    return nextTree === this.#tree
      ? this
      : new PersistentAggregateTree(nextTree, this.#context, this.#cache);
  }

  finalize(): TOutput {
    return finalizedValue(
      this.#tree.measure,
      this.#context.aggregator as unknown as PretableAggregator<
        object,
        unknown,
        TAccumulator,
        TOutput
      >,
      this.#cache,
    );
  }

  asTransient(): TransientAggregateTree<
    TId,
    TRow,
    TValue,
    TDependency,
    TOutput
  > {
    return new TransientAggregateTreeImpl(
      this.#tree.asTransient(),
      this.#context,
      this.#cache,
    );
  }
}

class TransientAggregateTreeImpl<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
  TAccumulator,
  TOutput,
> implements TransientAggregateTree<TId, TRow, TValue, TDependency, TOutput> {
  readonly #tree: TransientOrderStatisticTree<
    TId,
    AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
    TAccumulator
  >;
  readonly #context: TreeContext<TRow, TValue, TAccumulator, TOutput>;
  #cache: FinalizedCache<TAccumulator, TOutput>;
  #frozen: AggregateTree<TId, TRow, TValue, TDependency, TOutput> | undefined;

  constructor(
    tree: TransientOrderStatisticTree<
      TId,
      AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
      TAccumulator
    >,
    context: TreeContext<TRow, TValue, TAccumulator, TOutput>,
    cache: FinalizedCache<TAccumulator, TOutput>,
  ) {
    this.#tree = tree;
    this.#context = context;
    this.#cache = cache;
  }

  get size(): number {
    return this.#tree.size;
  }

  insertOrReplace(
    leaf: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  ): this {
    const previous = this.#tree.get(leaf.id);
    if (previous !== undefined && sameLeaf(previous, leaf)) return this;
    this.#tree.insertOrReplace(normalizedLeaf(leaf));
    if (this.#context.custom) {
      this.#context.lawValidator?.observe({
        aggregator: this.#context.aggregator,
        columnId: this.#context.columnId,
        row: leaf.row,
        value: leaf.value,
      });
    }
    return this;
  }

  remove(id: TId): this {
    this.#tree.remove(id);
    return this;
  }

  finalize(): TOutput {
    const accumulator = this.#tree.measure;
    if (!Object.is(this.#cache.accumulator, accumulator)) {
      this.#cache = { accumulator, ready: false };
    }
    return finalizedValue(
      accumulator,
      this.#context.aggregator as unknown as PretableAggregator<
        object,
        unknown,
        TAccumulator,
        TOutput
      >,
      this.#cache,
    );
  }

  freeze(): AggregateTree<TId, TRow, TValue, TDependency, TOutput> {
    if (this.#frozen !== undefined) return this.#frozen;
    const tree = this.#tree.freeze();
    this.#frozen = new PersistentAggregateTree(
      tree,
      this.#context,
      this.#cache,
    );
    return this.#frozen;
  }
}

export function createAggregateTree<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency = unknown,
>(
  options: BuiltinAggregateTreeOptions<TId, TRow, TValue, TDependency>,
): AggregateTree<TId, TRow, TValue, TDependency, number | null>;
export function createAggregateTree<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
  TAccumulator,
  TOutput,
>(
  options: CustomAggregateTreeOptions<
    TId,
    TRow,
    TValue,
    TDependency,
    TAccumulator,
    TOutput
  >,
): AggregateTree<TId, TRow, TValue, TDependency, TOutput>;
export function createAggregateTree<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
  TAccumulator,
  TOutput,
>(
  options:
    | BuiltinAggregateTreeOptions<TId, TRow, TValue, TDependency>
    | CustomAggregateTreeOptions<
        TId,
        TRow,
        TValue,
        TDependency,
        TAccumulator,
        TOutput
      >,
): AggregateTree<TId, TRow, TValue, TDependency, TOutput | number | null> {
  const custom = typeof options.aggregator !== "string";
  const aggregator = (custom
    ? options.aggregator
    : aggregateTreeBuiltinAggregators[
        options.aggregator
      ]) as unknown as PretableAggregator<
    TRow,
    TValue,
    TAccumulator | BuiltinAccumulator,
    TOutput | number | null
  >;
  const context: TreeContext<
    TRow,
    TValue,
    TAccumulator | BuiltinAccumulator,
    TOutput | number | null
  > = {
    columnId: options.columnId,
    aggregator,
    lawValidator:
      DEVELOPMENT && custom
        ? (
            options as CustomAggregateTreeOptions<
              TId,
              TRow,
              TValue,
              TDependency,
              TAccumulator,
              TOutput
            >
          ).lawValidator
        : undefined,
    custom,
  };
  const tree = createOrderStatisticTree<
    TId,
    AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
    TAccumulator | BuiltinAccumulator
  >({
    getId: (leaf) => leaf.id,
    compare: options.compare ?? (() => 0),
    measure: {
      empty: aggregator.init(),
      fromEntry: (leaf) =>
        aggregator.accumulate(aggregator.init(), leaf.value, leaf.row),
      combine: aggregator.merge,
    },
  });
  return new PersistentAggregateTree(tree, context);
}
