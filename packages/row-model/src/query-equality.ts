import type { PretableQueryFor } from "./column-types";

interface RuntimeOrdering {
  readonly columnId: string;
  readonly direction?: string;
  readonly nulls?: string;
}

interface RuntimeFilter {
  readonly columnId: string;
  readonly operator: string;
  readonly value?: unknown;
}

interface RuntimeFilterGroup {
  readonly op: "and" | "or";
  readonly children: readonly RuntimeFilterNode[];
}

type RuntimeFilterNode = RuntimeFilter | RuntimeFilterGroup;

interface RuntimeQuery {
  readonly filters: readonly RuntimeFilterNode[];
  readonly sort: readonly RuntimeOrdering[];
  readonly rowGroups: readonly RuntimeOrdering[];
}

function isRuntimeFilterGroup(
  node: RuntimeFilterNode,
): node is RuntimeFilterGroup {
  return "children" in node;
}

function readDateTimestamp(value: Date): number | undefined {
  try {
    return Date.prototype.getTime.call(value) as number;
  } catch {
    return undefined;
  }
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function semanticValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => semanticValueEqual(value, right[index]))
    );
  }
  if (left instanceof Date && right instanceof Date) {
    return Object.is(readDateTimestamp(left), readDateTimestamp(right));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] && semanticValueEqual(left[key], right[key]),
      )
    );
  }
  return false;
}

export function orderingEqual(
  left: readonly RuntimeOrdering[],
  right: readonly RuntimeOrdering[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.columnId === right[index]?.columnId &&
        (entry.direction ?? "asc") === (right[index]?.direction ?? "asc") &&
        (entry.nulls ?? "last") === (right[index]?.nulls ?? "last"),
    )
  );
}

function filterNodeEqual(
  left: RuntimeFilterNode,
  right: RuntimeFilterNode,
): boolean {
  if (isRuntimeFilterGroup(left) || isRuntimeFilterGroup(right)) {
    return (
      isRuntimeFilterGroup(left) &&
      isRuntimeFilterGroup(right) &&
      left.op === right.op &&
      filterNodeListEqual(left.children, right.children)
    );
  }
  return (
    left.columnId === right.columnId &&
    left.operator === right.operator &&
    semanticValueEqual(left.value, right.value)
  );
}

export function filterNodeListEqual(
  left: readonly RuntimeFilterNode[],
  right: readonly RuntimeFilterNode[],
): boolean {
  if (left.length !== right.length) return false;
  const used = new Set<number>();
  return left.every((filter) => {
    const index = right.findIndex(
      (candidate, candidateIndex) =>
        !used.has(candidateIndex) && filterNodeEqual(filter, candidate),
    );
    if (index < 0) return false;
    used.add(index);
    return true;
  });
}

export function queryEqual(left: RuntimeQuery, right: RuntimeQuery): boolean {
  return (
    filterNodeListEqual(left.filters, right.filters) &&
    orderingEqual(left.sort, right.sort) &&
    orderingEqual(left.rowGroups, right.rowGroups)
  );
}

/** @internal Shared semantic query identity for renderer authority decisions. */
export function ɵqueriesSemanticallyEqual<TColumns>(
  left: Readonly<PretableQueryFor<TColumns>>,
  right: Readonly<PretableQueryFor<TColumns>>,
): boolean {
  return queryEqual(
    left as unknown as RuntimeQuery,
    right as unknown as RuntimeQuery,
  );
}
