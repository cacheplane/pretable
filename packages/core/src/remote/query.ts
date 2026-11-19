import type {
  PretableRemoteCapabilities,
  PretableRemotePreparedQuery,
  PretableRemoteQuery,
  PretableRemoteRoute,
} from "./types";

const operatorsByType: Record<string, readonly string[]> = {
  text: [
    "equals",
    "notEquals",
    "contains",
    "notContains",
    "startsWith",
    "endsWith",
  ],
  number: ["equals", "notEquals", "gt", "gte", "lt", "lte", "between"],
  date: ["on", "before", "after", "dateBetween"],
  enum: ["isAnyOf", "isNoneOf"],
  boolean: ["isAnyOf", "isNoneOf"],
};

function invalid(): never {
  throw new Error("invalid-query");
}
function unsupported(): never {
  throw new Error("unsupported-query");
}
function object(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    invalid();
  const record = value as Record<string, unknown>;
  if (
    Reflect.ownKeys(record).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key)!;
      return (
        typeof key !== "string" ||
        !allowed.includes(key) ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  )
    invalid();
  return record;
}
function array(value: unknown): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > 10000
  )
    invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) invalid();
  for (const key of keys) {
    if (key === "length") continue;
    if (
      typeof key !== "string" ||
      !/^(0|[1-9]\d*)$/.test(key) ||
      Number(key) >= value.length
    )
      invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !("value" in descriptor)) invalid();
  }
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value) invalid();
  return value;
}
function member(value: unknown, allowed: readonly string[]): string {
  const item = text(value);
  if (!allowed.includes(item)) unsupported();
  return item;
}
function integer(value: unknown, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    invalid();
  return value;
}
function scalar(value: unknown): string {
  if (value === null) return '["null"]';
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid();
    return JSON.stringify(["number", Object.is(value, -0) ? "-0" : value]);
  }
  if (typeof value === "string" || typeof value === "boolean")
    return JSON.stringify([typeof value, value]);
  return invalid();
}
// Stable plain-data encoding; bounds and active-path checks fail closed on hostile inputs.
function canonical(
  value: unknown,
  seen = new Set<object>(),
  depth = 0,
): string {
  if (depth > 64) invalid();
  if (value === null || typeof value !== "object") return scalar(value);
  if (seen.has(value)) invalid();
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    array(value);
    result = `[${value.map((item) => canonical(item, seen, depth + 1)).join(",")}]`;
  } else {
    const record = object(value, Object.keys(value));
    result = `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical(record[key], seen, depth + 1)}`,
      )
      .join(",")}}`;
  }
  seen.delete(value);
  return result;
}
/** Canonical typed route identity, never a display label. @public */
export function canonicalRemoteRoute(route: PretableRemoteRoute): string {
  return canonical(
    array(route).map((segment) => {
      const item = object(segment, ["columnId", "key"]);
      text(item.columnId);
      scalar(item.key);
      return item;
    }),
  );
}
/** Group and leaf IDs occupy separate namespaces. @public */
export function remoteGroupId(route: PretableRemoteRoute): string {
  return `group:${canonicalRemoteRoute(route)}`;
}
/** Typed source record identity. @public */
export function remoteLeafId(id: string | number): string {
  if (typeof id !== "string" && typeof id !== "number") invalid();
  return `leaf:${scalar(id)}`;
}
function validateCapabilities(value: PretableRemoteCapabilities): void {
  canonical(value);
  const c = object(value, [
    "rangeAccess",
    "exactCounts",
    "consistency",
    "fields",
    "comparisons",
    "aggregates",
    "search",
    "maxGroupDepth",
    "maxRangeSize",
    "summaries",
  ]);
  if (typeof c.search !== "boolean") invalid();
  array(c.comparisons).forEach(text);
  array(c.aggregates).forEach(text);
  const fields = object(c.fields, Object.keys(c.fields as object));
  for (const [id, definition] of Object.entries(fields)) {
    text(id);
    const field = object(definition, ["type", "operators"]);
    const type = member(field.type, Object.keys(operatorsByType));
    array(field.operators).forEach((op) =>
      member(op, ["isEmpty", "isNotEmpty", ...operatorsByType[type]!]),
    );
  }
  const summaries = object(c.summaries, ["filtered", "all"]);
  member(summaries.filtered, ["same-version", "unavailable"]);
  member(summaries.all, ["same-version", "unavailable"]);
}
/** Validate before provider invocation. No query values are included in diagnostics. @public */
export function prepareRemoteQuery<TColumns>(
  query: PretableRemoteQuery<TColumns>,
  capabilities: PretableRemoteCapabilities,
): PretableRemotePreparedQuery {
  try {
    validateCapabilities(capabilities);
    // Validate serializability before recursively visiting filters.
    const queryKey = canonical(query);
    const q = object(query, [
      "source",
      "authScope",
      "schemaVersion",
      "registryVersion",
      "comparison",
      "locale",
      "filters",
      "rowGroups",
      "sort",
      "groupSort",
      "aggregates",
      "projection",
      "search",
    ]);
    if (
      capabilities.rangeAccess !== "ordinal" ||
      capabilities.exactCounts !== true ||
      !["immutable", "versioned", "revision-fence"].includes(
        capabilities.consistency,
      )
    )
      unsupported();
    integer(capabilities.maxRangeSize, 1);
    integer(capabilities.maxGroupDepth);
    for (const field of [
      "source",
      "authScope",
      "schemaVersion",
      "registryVersion",
      "locale",
    ])
      text(q[field]);
    member(q.comparison, capabilities.comparisons);
    const field = (id: unknown) => {
      const name = text(id);
      if (!Object.hasOwn(capabilities.fields, name)) unsupported();
      return capabilities.fields[name]!;
    };
    const filter = (value: unknown): void => {
      const f = object(value, [
        "op",
        "children",
        "columnId",
        "operator",
        "value",
      ]);
      if ("op" in f || "children" in f) {
        object(f, ["op", "children"]);
        member(f.op, ["and", "or"]);
        array(f.children).forEach(filter);
        return;
      }
      object(f, ["columnId", "operator", "value"]);
      const definition = field(f.columnId);

      const op = member(f.operator, [
        "isEmpty",
        "isNotEmpty",
        ...(operatorsByType[definition.type] ?? []),
      ]);
      member(op, definition.operators);
      if (op === "isEmpty" || op === "isNotEmpty") {
        if ("value" in f) invalid();
        return;
      }
      const operand = (v: unknown) => {
        const expected =
          definition.type === "number"
            ? "number"
            : definition.type === "boolean"
              ? "boolean"
              : "string";
        if (typeof v !== expected) invalid();
        if (expected === "number" && !Number.isFinite(v)) invalid();
        if (
          definition.type === "date" &&
          (typeof v !== "string" ||
            !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
            new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v)
        )
          invalid();
      };
      if (["between", "dateBetween", "isAnyOf", "isNoneOf"].includes(op)) {
        const values = array(f.value);
        if ((op === "between" || op === "dateBetween") && values.length !== 2)
          invalid();
        values.forEach(operand);
      } else operand(f.value);
    };
    array(q.filters).forEach(filter);
    const groups = array(q.rowGroups);
    if (groups.length > capabilities.maxGroupDepth) unsupported();
    const groupColumns = new Set<string>();
    groups.forEach((value) => {
      const group = object(value, ["columnId", "direction", "nulls"]);
      field(group.columnId);
      const id = text(group.columnId);
      if (groupColumns.has(id)) invalid();
      groupColumns.add(id);
      // Remote sibling ordering lives exclusively in groupSort.
      if ("direction" in group || "nulls" in group) unsupported();
    });
    const aggregateIds = new Set<string>();
    array(q.aggregates).forEach((value) => {
      const aggregate = object(value, ["columnId", "id"]);
      field(aggregate.columnId);
      const id = member(aggregate.id, capabilities.aggregates);
      if (aggregateIds.has(id)) invalid();
      aggregateIds.add(id);
    });
    const order = (sort: Record<string, unknown>) => {
      member(sort.direction, ["asc", "desc"]);
      member(sort.nulls, ["first", "last"]);
      member(sort.comparison, capabilities.comparisons);
    };
    array(q.sort).forEach((value) => {
      const sort = object(value, [
        "columnId",
        "direction",
        "nulls",
        "comparison",
      ]);
      field(sort.columnId);
      order(sort);
    });
    const sortedLevels = new Set<number>();
    array(q.groupSort).forEach((value) => {
      const sort = object(value, [
        "level",
        "by",
        "aggregateId",
        "direction",
        "nulls",
        "comparison",
      ]);
      const level = integer(sort.level);
      if (level >= groups.length) invalid();
      sortedLevels.add(level);
      member(sort.by, ["key", "aggregate"]);
      if (sort.by === "aggregate") {
        if (!aggregateIds.has(text(sort.aggregateId))) unsupported();
      } else if ("aggregateId" in sort) invalid();
      order(sort);
    });
    if (sortedLevels.size !== groups.length) unsupported();
    const projection = array(q.projection);
    projection.forEach(field);
    if (new Set(projection).size !== projection.length) invalid();
    if ("search" in q) {
      if (!capabilities.search) unsupported();
      if (typeof q.search !== "string") invalid();
    }
    return { ok: true, queryKey };
  } catch (error) {
    return {
      ok: false,
      error: {
        code:
          error instanceof Error && error.message === "unsupported-query"
            ? "unsupported-query"
            : "invalid-query",
      },
    };
  }
}

/** Collision-safe identity of the effective registered aggregate definition.
 * Providers must use this helper for group and summary answers. @public */
export function remoteAggregateDefinitionKey(
  registryVersion: string,
  columnId: string,
  aggregateId: string,
): string {
  return canonical([text(registryVersion), text(columnId), text(aggregateId)]);
}
