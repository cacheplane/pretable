import type { AggregatorLawValidator } from "../aggregator-law";
import type { PretableAggregator } from "../column-types";
import type { LocalRowModelInstrumentation } from "../diagnostics";
import {
  createOrderStatisticTree,
  instrumentMeasuredOrderStatisticTree,
  type OrderStatisticTree,
  type OrderStatisticTreeId,
  type TransientOrderStatisticTree,
} from "./order-statistic-tree";

const attachInstrumentation = Symbol("attachAggregateInstrumentation");

const DEVELOPMENT = process.env.NODE_ENV !== "production";

export type AggregateTreeId = OrderStatisticTreeId;
export type NumericBuiltinAggregatorName = "sum" | "avg" | "min" | "max";
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
  /** Returns the first ID in aggregate order without creating another index. */
  firstId(): TId | undefined;
  insertOrReplace(
    leaf: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  ): AggregateTree<TId, TRow, TValue, TDependency, TOutput>;
  remove(id: TId): AggregateTree<TId, TRow, TValue, TDependency, TOutput>;
  /**
   * Returns the cached finalized output. Custom finalizers receive a detached
   * accumulator snapshot, so even an identity finalizer cannot expose or
   * corrupt the persistent accumulator graph.
   */
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
  /** Returns the first ID in aggregate order without creating another index. */
  firstId(): TId | undefined;
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
  /**
   * Produces a detached accumulator snapshot for `finalize`. Supply this for
   * class instances or other values that the platform cannot structured-clone.
   * The callback must be pure, must not return the cached accumulator, and
   * must replace SharedArrayBuffer-backed memory with detached storage.
   */
  readonly snapshotAccumulator?: (accumulator: TAccumulator) => TAccumulator;
  readonly lawValidator?: AggregatorLawValidator;
}

interface AggregateTreeOptionsBase<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
> {
  readonly columnId: string;
  readonly compare?: (
    left: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
    right: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  ) => number;
}

export interface NumericBuiltinAggregateTreeOptions<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
> extends AggregateTreeOptionsBase<TId, TRow, TValue, TDependency> {
  readonly aggregator: NumericBuiltinAggregatorName;
}

export interface CountAggregateTreeOptions<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
> extends AggregateTreeOptionsBase<TId, TRow, TValue, TDependency> {
  readonly aggregator: "count";
}

export type BuiltinAggregateTreeOptions<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
> =
  | CountAggregateTreeOptions<TId, TRow, TValue, TDependency>
  | ([NonNullable<TValue>] extends [number]
      ? NumericBuiltinAggregateTreeOptions<TId, TRow, TValue, TDependency>
      : never);

type AnyPretableAggregator = PretableAggregator<never, never, never, unknown>;

type AggregatorParts<TAggregator> =
  TAggregator extends PretableAggregator<
    infer TRow,
    infer TValue,
    infer TAccumulator,
    infer TOutput
  >
    ? readonly [TRow, TValue, TAccumulator, TOutput]
    : never;

type AggregatorRow<TAggregator> = AggregatorParts<TAggregator>[0];
type AggregatorValue<TAggregator> = AggregatorParts<TAggregator>[1];
type AggregatorAccumulator<TAggregator> = AggregatorParts<TAggregator>[2];
type AggregatorOutput<TAggregator> = AggregatorParts<TAggregator>[3];

export interface InferredCustomAggregateTreeOptions<
  TAggregator extends AnyPretableAggregator,
  TId extends AggregateTreeId = AggregateTreeId,
  TDependency = unknown,
> {
  readonly columnId: string;
  readonly aggregator: TAggregator;
  readonly compare?: (
    left: AggregateTreeLeaf<
      TId,
      AggregatorRow<TAggregator>,
      AggregatorValue<TAggregator>,
      TDependency
    >,
    right: AggregateTreeLeaf<
      TId,
      AggregatorRow<TAggregator>,
      AggregatorValue<TAggregator>,
      TDependency
    >,
  ) => number;
  readonly snapshotAccumulator?: (
    accumulator: AggregatorAccumulator<TAggregator>,
  ) => AggregatorAccumulator<TAggregator>;
  readonly lawValidator?: AggregatorLawValidator;
}

interface SumAccumulator {
  readonly finiteUnits: bigint;
  readonly count: number;
  readonly positiveInfinity: boolean;
  readonly negativeInfinity: boolean;
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

const FRACTION_BITS = 52n;
const FRACTION_MASK = (1n << FRACTION_BITS) - 1n;
const IMPLICIT_BIT = 1n << FRACTION_BITS;
const SIGN_BIT = 1n << 63n;
const MAX_FINITE_UNITS = ((1n << 53n) - 1n) << 2045n;
const OVERFLOW_THRESHOLD_UNITS = MAX_FINITE_UNITS + (1n << 2044n);

function finiteNumberUnits(value: number): bigint {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const negative = (bits & SIGN_BIT) !== 0n;
  const exponent = Number((bits >> FRACTION_BITS) & 0x7ffn);
  const fraction = bits & FRACTION_MASK;
  const magnitude =
    exponent === 0
      ? fraction
      : (IMPLICIT_BIT + fraction) << BigInt(exponent - 1);
  return negative ? -magnitude : magnitude;
}

function roundDivideEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const comparison = remainder * 2n - denominator;
  return comparison > 0n || (comparison === 0n && (quotient & 1n) === 1n)
    ? quotient + 1n
    : quotient;
}

function bitLength(value: bigint): number {
  return value.toString(2).length;
}

function floorLog2Ratio(numerator: bigint, denominator: bigint): number {
  let exponent = bitLength(numerator) - bitLength(denominator);
  const belowCandidate =
    exponent >= 0
      ? numerator < denominator << BigInt(exponent)
      : numerator << BigInt(-exponent) < denominator;
  if (belowCandidate) exponent -= 1;
  return exponent;
}

function numberFromBits(bits: bigint): number {
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

/** Rounds an exact `(units / divisor) * 2^-1074` rational once to binary64. */
function roundedUnits(units: bigint, divisor = 1n): number {
  if (units === 0n) return 0;
  const negative = units < 0n;
  const magnitude = negative ? -units : units;
  if (magnitude >= OVERFLOW_THRESHOLD_UNITS * divisor) {
    return negative ? -Infinity : Infinity;
  }

  const exponent = floorLog2Ratio(magnitude, divisor);
  let shift = Math.max(0, exponent - 52);
  let significand = roundDivideEven(magnitude, divisor << BigInt(shift));
  if (significand >= 1n << 53n) {
    significand >>= 1n;
    shift += 1;
  }

  const sign = negative ? SIGN_BIT : 0n;
  if (significand < IMPLICIT_BIT) {
    return numberFromBits(sign | significand);
  }
  const exponentBits = BigInt(shift + 1);
  return numberFromBits(
    sign | (exponentBits << FRACTION_BITS) | (significand - IMPLICIT_BIT),
  );
}

function emptySumAccumulator(): SumAccumulator {
  return {
    finiteUnits: 0n,
    count: 0,
    positiveInfinity: false,
    negativeInfinity: false,
  };
}

function accumulateSum(
  accumulator: SumAccumulator,
  value: unknown,
): SumAccumulator {
  if (!aggregatableNumber(value)) return accumulator;
  return {
    finiteUnits: Number.isFinite(value)
      ? accumulator.finiteUnits + finiteNumberUnits(value)
      : accumulator.finiteUnits,
    count: accumulator.count + 1,
    positiveInfinity: accumulator.positiveInfinity || value === Infinity,
    negativeInfinity: accumulator.negativeInfinity || value === -Infinity,
  };
}

function mergeSums(
  left: SumAccumulator,
  right: SumAccumulator,
): SumAccumulator {
  return {
    finiteUnits: left.finiteUnits + right.finiteUnits,
    count: left.count + right.count,
    positiveInfinity: left.positiveInfinity || right.positiveInfinity,
    negativeInfinity: left.negativeInfinity || right.negativeInfinity,
  };
}

function finalizedSum(
  accumulator: SumAccumulator,
  average: boolean,
): number | null {
  if (accumulator.count === 0) return null;
  if (accumulator.positiveInfinity && accumulator.negativeInfinity) return NaN;
  if (accumulator.positiveInfinity) return Infinity;
  if (accumulator.negativeInfinity) return -Infinity;
  return roundedUnits(
    accumulator.finiteUnits,
    average ? BigInt(accumulator.count) : 1n,
  );
}

const sum: PretableAggregator<object, unknown, SumAccumulator, number | null> =
  {
    init: emptySumAccumulator,
    accumulate: accumulateSum,
    merge: mergeSums,
    finalize: (accumulator) => finalizedSum(accumulator, false),
  };

const avg: PretableAggregator<object, unknown, SumAccumulator, number | null> =
  {
    init: sum.init,
    accumulate: sum.accumulate,
    merge: sum.merge,
    finalize: (accumulator) => finalizedSum(accumulator, true),
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
            ? value < accumulator.value
              ? value
              : accumulator.value
            : value > accumulator.value
              ? value
              : accumulator.value,
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
            ? right.value < left.value
              ? right.value
              : left.value
            : right.value > left.value
              ? right.value
              : left.value,
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

/**
 * Pure, persistent-safe built-in monoids. Numeric admission, empty output, and
 * ordered extrema match the legacy grid. Sum and average intentionally use an
 * exact binary64 superaccumulator so cached merges are genuinely associative;
 * they round only once when finalized rather than reproducing history-dependent
 * floating-point folds.
 */
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
  readonly snapshotAccumulator:
    ((accumulator: TAccumulator) => TAccumulator) | undefined;
  readonly custom: boolean;
  readonly instrumentation?: LocalRowModelInstrumentation;
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

function containsSharedMemory(
  value: unknown,
  seen = new Set<object>(),
): boolean {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    value instanceof SharedArrayBuffer
  ) {
    return true;
  }
  if (seen.has(value)) return false;
  seen.add(value);

  if (ArrayBuffer.isView(value) && containsSharedMemory(value.buffer, seen)) {
    return true;
  }
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      if (
        containsSharedMemory(key, seen) ||
        containsSharedMemory(entry, seen)
      ) {
        return true;
      }
    }
  }
  if (value instanceof Set) {
    for (const entry of value) {
      if (containsSharedMemory(entry, seen)) return true;
    }
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor !== undefined &&
      "value" in descriptor &&
      containsSharedMemory(descriptor.value, seen)
    ) {
      return true;
    }
  }
  return false;
}

function finalizedValue<TAccumulator, TOutput>(
  accumulator: TAccumulator,
  aggregator: PretableAggregator<object, unknown, TAccumulator, TOutput>,
  cache: FinalizedCache<TAccumulator, TOutput>,
  custom: boolean,
  snapshotAccumulator:
    ((accumulator: TAccumulator) => TAccumulator) | undefined,
): TOutput {
  if (!Object.is(cache.accumulator, accumulator)) {
    throw new Error("Aggregate finalization cache does not match its root.");
  }
  if (!cache.ready) {
    let finalizedAccumulator = accumulator;
    if (
      custom &&
      accumulator !== null &&
      (typeof accumulator === "object" || typeof accumulator === "function")
    ) {
      if (snapshotAccumulator !== undefined) {
        finalizedAccumulator = snapshotAccumulator(accumulator);
        if (Object.is(finalizedAccumulator, accumulator)) {
          throw new TypeError(
            "snapshotAccumulator must return a detached accumulator.",
          );
        }
      } else {
        try {
          finalizedAccumulator = structuredClone(accumulator);
        } catch (error) {
          throw new TypeError(
            "Custom aggregator accumulators must be structured-cloneable or provide snapshotAccumulator.",
            { cause: error },
          );
        }
      }
      if (containsSharedMemory(finalizedAccumulator)) {
        throw new TypeError(
          "Finalized accumulator snapshots cannot contain SharedArrayBuffer-backed memory; provide snapshotAccumulator that copies it into detached storage.",
        );
      }
    }
    cache.output = aggregator.finalize(finalizedAccumulator);
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

  firstId(): TId | undefined {
    return this.#tree.entryAt(0)?.id;
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
        leafId: leaf.id,
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
      this.#context.custom,
      this.#context.snapshotAccumulator,
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

  [attachInstrumentation](instrumentation: LocalRowModelInstrumentation) {
    if (this.#context.instrumentation === instrumentation) return this;
    const tree = instrumentMeasuredOrderStatisticTree(
      this.#tree,
      instrumentation,
      () => {
        instrumentation.work.aggregateMerges += 1;
      },
    );
    return new PersistentAggregateTree(
      tree,
      { ...this.#context, instrumentation },
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

  firstId(): TId | undefined {
    return this.#tree.entryAt(0)?.id;
  }

  insertOrReplace(
    leaf: AggregateTreeLeaf<TId, TRow, TValue, TDependency>,
  ): this {
    const previous = this.#tree.get(leaf.id);
    if (previous !== undefined && sameLeaf(previous, leaf)) {
      this.#tree.insertOrReplace(previous);
      return this;
    }
    this.#tree.insertOrReplace(normalizedLeaf(leaf));
    if (this.#context.custom) {
      this.#context.lawValidator?.observe({
        aggregator: this.#context.aggregator,
        columnId: this.#context.columnId,
        leafId: leaf.id,
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
      this.#context.custom,
      this.#context.snapshotAccumulator,
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
  TValue extends number | null | undefined,
  TDependency = unknown,
>(
  options: NumericBuiltinAggregateTreeOptions<TId, TRow, TValue, TDependency>,
): AggregateTree<TId, TRow, TValue, TDependency, number | null>;
export function createAggregateTree<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency = unknown,
>(
  options: CountAggregateTreeOptions<TId, TRow, TValue, TDependency>,
): AggregateTree<TId, TRow, TValue, TDependency, number | null>;
export function createAggregateTree<
  const TAggregator extends AnyPretableAggregator,
  TId extends AggregateTreeId = AggregateTreeId,
  TDependency = unknown,
>(
  options: InferredCustomAggregateTreeOptions<TAggregator, TId, TDependency>,
): AggregateTree<
  TId,
  AggregatorRow<TAggregator>,
  AggregatorValue<TAggregator>,
  TDependency,
  AggregatorOutput<TAggregator>
>;
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
    snapshotAccumulator: custom
      ? (((
          options as CustomAggregateTreeOptions<
            TId,
            TRow,
            TValue,
            TDependency,
            TAccumulator,
            TOutput
          >
        ).snapshotAccumulator ?? aggregator.snapshotAccumulator) as unknown as
          | ((
              accumulator: TAccumulator | BuiltinAccumulator,
            ) => TAccumulator | BuiltinAccumulator)
          | undefined)
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

export function instrumentAggregateTree<
  TId extends AggregateTreeId,
  TRow extends object,
  TValue,
  TDependency,
  TOutput,
>(
  tree: AggregateTree<TId, TRow, TValue, TDependency, TOutput>,
  instrumentation: LocalRowModelInstrumentation | undefined,
): AggregateTree<TId, TRow, TValue, TDependency, TOutput> {
  if (instrumentation === undefined) return tree;
  if (!(tree instanceof PersistentAggregateTree)) {
    throw new TypeError(
      "Instrumentation requires an aggregate tree created by this module.",
    );
  }
  return tree[attachInstrumentation](instrumentation);
}
