import type { PretableAggregator } from "./column-types";

const MAX_REPRESENTATIVE_LEAVES = 8;
const DEVELOPMENT = process.env.NODE_ENV !== "production";

export interface AggregatorLawDiagnostic {
  readonly code: "aggregator-law-violation";
  readonly law: "sequential-vs-merged-one-row-partitions";
  readonly columnId: string;
  readonly sampleSize: number;
  readonly sequentialOutput: unknown;
  readonly mergedOutput: unknown;
}

export interface AggregatorLawObservation<
  TRow extends object,
  TValue,
  TAccumulator,
  TOutput,
> {
  readonly aggregator: PretableAggregator<TRow, TValue, TAccumulator, TOutput>;
  readonly columnId: string;
  readonly leafId: string | number;
  readonly row: TRow;
  readonly value: TValue;
}

export interface AggregatorLawValidator {
  observe<TRow extends object, TValue, TAccumulator, TOutput>(
    observation: AggregatorLawObservation<TRow, TValue, TAccumulator, TOutput>,
  ): void;
}

export interface AggregatorLawValidatorOptions {
  readonly sink: (diagnostic: AggregatorLawDiagnostic) => void;
  readonly equals?: (left: unknown, right: unknown) => boolean;
}

interface RepresentativeLeaf {
  readonly id: string | number;
  readonly row: object;
  readonly value: unknown;
}

interface ValidationState {
  readonly samples: RepresentativeLeaf[];
  warned: boolean;
}

function sameLeafId(left: string | number, right: string | number): boolean {
  return left === right || (left !== left && right !== right);
}

interface EqualityContext {
  leftToRight: Map<object, object>;
  rightToLeft: Map<object, object>;
}

function clonedContext(context: EqualityContext): EqualityContext {
  return {
    leftToRight: new Map(context.leftToRight),
    rightToLeft: new Map(context.rightToLeft),
  };
}

function commitContext(target: EqualityContext, source: EqualityContext): void {
  target.leftToRight = source.leftToRight;
  target.rightToLeft = source.rightToLeft;
}

function equalBytes(left: ArrayBufferView, right: ArrayBufferView): boolean {
  if (left.byteLength !== right.byteLength) return false;
  const leftBytes = new Uint8Array(
    left.buffer,
    left.byteOffset,
    left.byteLength,
  );
  const rightBytes = new Uint8Array(
    right.buffer,
    right.byteOffset,
    right.byteLength,
  );
  return leftBytes.every((value, index) => value === rightBytes[index]);
}

function boxedPrimitiveValue(value: object): unknown {
  switch (Object.prototype.toString.call(value)) {
    case "[object Boolean]":
      return Boolean.prototype.valueOf.call(value);
    case "[object Number]":
      return Number.prototype.valueOf.call(value);
    case "[object String]":
      return String.prototype.valueOf.call(value);
    case "[object BigInt]":
      return BigInt.prototype.valueOf.call(value);
    case "[object Symbol]":
      return Symbol.prototype.valueOf.call(value);
    default:
      return undefined;
  }
}

function structuredEqual(
  left: unknown,
  right: unknown,
  context: EqualityContext,
): boolean {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }

  const knownRight = context.leftToRight.get(left);
  if (knownRight !== undefined) return knownRight === right;
  const knownLeft = context.rightToLeft.get(right);
  if (knownLeft !== undefined) return knownLeft === left;
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right))
    return false;

  const leftBoxed = boxedPrimitiveValue(left);
  const rightBoxed = boxedPrimitiveValue(right);
  if (leftBoxed !== undefined || rightBoxed !== undefined) {
    return Object.is(leftBoxed, rightBoxed);
  }

  if (left instanceof Date && right instanceof Date) {
    return Object.is(left.getTime(), right.getTime());
  }
  if (left instanceof RegExp && right instanceof RegExp) {
    return (
      left.source === right.source &&
      left.flags === right.flags &&
      left.lastIndex === right.lastIndex
    );
  }
  if (left instanceof ArrayBuffer && right instanceof ArrayBuffer) {
    return equalBytes(new Uint8Array(left), new Uint8Array(right));
  }
  if (
    typeof SharedArrayBuffer !== "undefined" &&
    left instanceof SharedArrayBuffer &&
    right instanceof SharedArrayBuffer
  ) {
    return equalBytes(new Uint8Array(left), new Uint8Array(right));
  }
  if (ArrayBuffer.isView(left) && ArrayBuffer.isView(right)) {
    return equalBytes(left, right);
  }

  context.leftToRight.set(left, right);
  context.rightToLeft.set(right, left);

  if (left instanceof Map && right instanceof Map) {
    if (left.size !== right.size) return false;
    const unmatched = [...right.entries()];
    for (const [leftKey, leftValue] of left) {
      let matched = false;
      for (let index = 0; index < unmatched.length; index += 1) {
        const rightEntry = unmatched[index]!;
        const trial = clonedContext(context);
        if (
          structuredEqual(leftKey, rightEntry[0], trial) &&
          structuredEqual(leftValue, rightEntry[1], trial)
        ) {
          commitContext(context, trial);
          unmatched.splice(index, 1);
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
    return true;
  }

  if (left instanceof Set && right instanceof Set) {
    if (left.size !== right.size) return false;
    const unmatched = [...right.values()];
    for (const leftValue of left) {
      let matched = false;
      for (let index = 0; index < unmatched.length; index += 1) {
        const trial = clonedContext(context);
        if (structuredEqual(leftValue, unmatched[index], trial)) {
          commitContext(context, trial);
          unmatched.splice(index, 1);
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
    return true;
  }

  const leftKeys = Reflect.ownKeys(left);
  const rightKeys = Reflect.ownKeys(right);
  if (leftKeys.length !== rightKeys.length) return false;

  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    const leftDescriptor = Object.getOwnPropertyDescriptor(left, key);
    const rightDescriptor = Object.getOwnPropertyDescriptor(right, key);
    if (leftDescriptor === undefined || rightDescriptor === undefined)
      return false;
    if (
      leftDescriptor.enumerable !== rightDescriptor.enumerable ||
      leftDescriptor.configurable !== rightDescriptor.configurable
    ) {
      return false;
    }
    const leftIsData = "value" in leftDescriptor;
    const rightIsData = "value" in rightDescriptor;
    if (leftIsData !== rightIsData) return false;
    if (leftIsData && rightIsData) {
      if (
        !structuredEqual(leftDescriptor.value, rightDescriptor.value, context)
      ) {
        return false;
      }
    } else if (
      leftDescriptor.get !== rightDescriptor.get ||
      leftDescriptor.set !== rightDescriptor.set
    ) {
      return false;
    }
  }
  return true;
}

/** Compares scalar and common structured finalized outputs by value. */
export function defaultAggregatorOutputEquality(
  left: unknown,
  right: unknown,
): boolean {
  return structuredEqual(left, right, {
    leftToRight: new Map<object, object>(),
    rightToLeft: new Map<object, object>(),
  });
}

const productionValidator: AggregatorLawValidator = Object.freeze({
  observe: () => undefined,
});

/**
 * Creates development-only validation for the custom aggregator merge law.
 * Production replacements of `process.env.NODE_ENV` eliminate the sampling
 * branch, and the runtime fallback is a shared no-op validator.
 */
export function createAggregatorLawValidator(
  options: AggregatorLawValidatorOptions,
): AggregatorLawValidator {
  if (!DEVELOPMENT) return productionValidator;

  const states = new WeakMap<object, Map<string, ValidationState>>();
  const equals = options.equals ?? defaultAggregatorOutputEquality;

  return {
    observe<TRow extends object, TValue, TAccumulator, TOutput>(
      observation: AggregatorLawObservation<
        TRow,
        TValue,
        TAccumulator,
        TOutput
      >,
    ): void {
      const aggregatorObject = observation.aggregator as object;
      let columns = states.get(aggregatorObject);
      if (columns === undefined) {
        columns = new Map<string, ValidationState>();
        states.set(aggregatorObject, columns);
      }
      let state = columns.get(observation.columnId);
      if (state === undefined) {
        state = { samples: [], warned: false };
        columns.set(observation.columnId, state);
      }
      if (state.warned) return;
      const existingIndex = state.samples.findIndex((sample) =>
        sameLeafId(sample.id, observation.leafId),
      );
      if (existingIndex >= 0) {
        state.samples[existingIndex] = {
          id: observation.leafId,
          row: observation.row,
          value: observation.value,
        };
      } else {
        if (state.samples.length >= MAX_REPRESENTATIVE_LEAVES) return;
        state.samples.push({
          id: observation.leafId,
          row: observation.row,
          value: observation.value,
        });
      }
      if (state.samples.length < 2) return;

      const aggregator =
        observation.aggregator as unknown as PretableAggregator<
          object,
          unknown,
          unknown,
          unknown
        >;
      try {
        let sequential = aggregator.init();
        const partitions: unknown[] = [];
        for (const sample of state.samples) {
          sequential = aggregator.accumulate(
            sequential,
            sample.value,
            sample.row,
          );
          partitions.push(
            aggregator.accumulate(aggregator.init(), sample.value, sample.row),
          );
        }
        let merged: unknown = partitions[0];
        for (let index = 1; index < partitions.length; index += 1) {
          merged = aggregator.merge(merged, partitions[index]!);
        }
        const sequentialOutput = aggregator.finalize(sequential);
        const mergedOutput = aggregator.finalize(merged);
        if (equals(sequentialOutput, mergedOutput)) return;

        state.warned = true;
        options.sink({
          code: "aggregator-law-violation",
          law: "sequential-vs-merged-one-row-partitions",
          columnId: observation.columnId,
          sampleSize: state.samples.length,
          sequentialOutput,
          mergedOutput,
        });
      } catch {
        // Development diagnostics must not add a new failure mode to updates.
      }
    },
  };
}
