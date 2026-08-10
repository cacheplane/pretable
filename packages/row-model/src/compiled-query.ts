import type {
  ColumnDescriptorOf,
  ColumnIdOf,
  PretableDerivationsFor,
  PretableQueryFor,
  PretableRowId,
} from "./column-types";
import { PretableRowModelError } from "./errors";
import type { AggregateTreeLeaf } from "./persistent/aggregate-tree";

type RowForColumns<TColumns> =
  ColumnDescriptorOf<TColumns> extends {
    readonly row: infer TRow extends object;
  }
    ? TRow
    : never;

type CompiledValueForDescriptor<TDescriptor> = TDescriptor extends {
  readonly id: infer TColumnId extends string;
  readonly value: infer TValue;
}
  ? { readonly columnId: TColumnId; readonly value: TValue }
  : never;

export type CompiledGroupKey<TColumns> = CompiledValueForDescriptor<
  ColumnDescriptorOf<TColumns>
>;

export type CompiledSortKey<TColumns> = CompiledValueForDescriptor<
  ColumnDescriptorOf<TColumns>
>;

export interface CompiledAggregateDependency<TColumns> {
  readonly sourceOrder: number;
  readonly sortKeys: readonly CompiledSortKey<TColumns>[];
}

type CompiledAggregateLeafForDescriptor<
  TDescriptor,
  TColumns,
  TRowId extends PretableRowId,
> = TDescriptor extends {
  readonly row: infer TRow extends object;
  readonly id: infer TColumnId extends string;
  readonly value: infer TValue;
  readonly aggregate: infer TAggregate;
}
  ? [TAggregate] extends [undefined]
    ? never
    : {
        readonly columnId: TColumnId;
        readonly aggregate: TAggregate;
        readonly allLeaf: AggregateTreeLeaf<
          TRowId,
          TRow,
          TValue,
          CompiledAggregateDependency<TColumns>
        >;
        readonly filteredLeaf:
          | AggregateTreeLeaf<
              TRowId,
              TRow,
              TValue,
              CompiledAggregateDependency<TColumns>
            >
          | undefined;
      }
  : never;

/** A column-correlated aggregate leaf ready for Task 5's aggregate tree. */
export type CompiledAggregateLeaf<
  TColumns,
  TRowId extends PretableRowId,
> = CompiledAggregateLeafForDescriptor<
  ColumnDescriptorOf<TColumns>,
  TColumns,
  TRowId
>;

export interface CompiledRowInput<
  TRow extends object,
  TRowId extends PretableRowId,
> {
  readonly rowId: TRowId;
  readonly row: TRow;
  readonly sourceOrder: number;
}

export interface CompiledRowMetadata<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rowId: TRowId;
  readonly row: TRow;
  readonly sourceOrder: number;
  readonly filterPasses: boolean;
  readonly groupPath: readonly CompiledGroupKey<TColumns>[];
  readonly sortKeys: readonly CompiledSortKey<TColumns>[];
  /** `allLeaf` always exists; `filteredLeaf` exists only when filters pass. */
  readonly aggregateLeaves: readonly CompiledAggregateLeaf<TColumns, TRowId>[];
}

export interface CompiledQuery<TColumns> {
  readonly derivations: PretableDerivationsFor<TColumns>;
  readonly query: PretableQueryFor<TColumns>;
  readonly activeColumnIds: readonly ColumnIdOf<TColumns>[];
  evaluate<TRowId extends PretableRowId>(
    input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  ): CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns>;
  readonly compareRows: <TRowId extends PretableRowId>(
    left: CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns>,
    right: CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns>,
  ) => number;
  /**
   * Compares sibling group keys with the same policy as row sorting. Missing
   * values (`null`, `undefined`, and `NaN`) default to last. An explicit
   * `nulls: "first" | "last"` is absolute and is never reversed by `desc`.
   */
  compareGroupKeys(
    level: number,
    left: CompiledGroupKey<TColumns>,
    right: CompiledGroupKey<TColumns>,
  ): number;
}

export interface CompileQueryInput<TColumns> {
  readonly derivations: PretableDerivationsFor<TColumns>;
  readonly query: PretableQueryFor<TColumns>;
  /** Supply the current plan so semantic no-ops preserve plan and cache identity. */
  readonly previous?: CompiledQuery<TColumns>;
}

export class CompiledQueryValidationError extends TypeError {
  readonly name = "CompiledQueryValidationError";
  readonly code = "invalid-query";

  constructor(
    readonly detail: string,
    readonly path: string,
    readonly columnId?: string,
  ) {
    super(`Invalid compiled query at ${path}: ${detail}`);
  }
}

export class CompiledQueryComparatorError extends PretableRowModelError {
  readonly name = "CompiledQueryComparatorError";

  constructor(
    message: string,
    readonly rowIds: readonly PretableRowId[] | undefined,
    context: {
      readonly columnId: string;
      readonly cause: unknown;
    },
  ) {
    super("comparator-failed", message, {
      operation: "set-query",
      rowId: rowIds?.[0],
      columnId: context.columnId,
      cause: context.cause,
    });
  }
}

type RuntimeAggregator = {
  readonly init: () => object | string | number | bigint | boolean | null;
  readonly accumulate: (
    ...args: readonly never[]
  ) => object | string | number | bigint | boolean | null;
  readonly merge: (
    ...args: readonly never[]
  ) => object | string | number | bigint | boolean | null;
  readonly finalize: (
    ...args: readonly never[]
  ) => object | string | number | bigint | boolean | null;
};

interface RuntimeColumn {
  readonly id: string;
  readonly type: string;
  readonly accessor: (row: never) => unknown;
  readonly value: (row: never) => unknown;
  readonly compare?: (left: never, right: never) => number;
  readonly aggregate?: string | RuntimeAggregator;
}

interface RuntimeFilter {
  readonly columnId: string;
  readonly operator: string;
  readonly value?: unknown;
}

interface RuntimeOrdering {
  readonly columnId: string;
  readonly direction?: string;
  readonly nulls?: string;
}

interface RuntimeQuery {
  readonly filters: readonly RuntimeFilter[];
  readonly sort: readonly RuntimeOrdering[];
  readonly rowGroups: readonly RuntimeOrdering[];
}

interface CachedEvaluation {
  readonly rowId: PretableRowId;
  readonly sourceOrder: number;
  readonly metadata: object;
}

const internals = Symbol("compiled-query-internals");

interface InternalCompiledQuery {
  readonly [internals]: {
    semanticallyMatches(
      derivations: readonly RuntimeColumn[],
      query: RuntimeQuery,
    ): boolean;
  };
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

const FILTER_OPERATORS = {
  text: new Set([
    "contains",
    "notContains",
    "equals",
    "notEquals",
    "startsWith",
    "endsWith",
    "isEmpty",
    "isNotEmpty",
  ]),
  number: new Set([
    "equals",
    "notEquals",
    "gt",
    "gte",
    "lt",
    "lte",
    "between",
    "isEmpty",
    "isNotEmpty",
  ]),
  date: new Set([
    "on",
    "before",
    "after",
    "dateBetween",
    "isEmpty",
    "isNotEmpty",
  ]),
  enum: new Set(["isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty"]),
  boolean: new Set(["isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty"]),
} as const;

const BUILTIN_AGGREGATES = new Set(["sum", "avg", "min", "max", "count"]);
const NUMERIC_AGGREGATES = new Set(["sum", "avg", "min", "max"]);
const COLUMN_TYPES = new Set(["text", "number", "date", "enum", "boolean"]);

function runtimeColumns<TColumns>(
  derivations: PretableDerivationsFor<TColumns>,
): readonly RuntimeColumn[] {
  return derivations as unknown as readonly RuntimeColumn[];
}

function runtimeQuery<TColumns>(
  query: PretableQueryFor<TColumns>,
): RuntimeQuery {
  return query as unknown as RuntimeQuery;
}

function fail(message: string, path = "query", columnId?: string): never {
  throw new CompiledQueryValidationError(message, path, columnId);
}

function validateDerivations(columns: readonly RuntimeColumn[]): void {
  const ids = new Set<string>();
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    const path = `derivations[${index}]`;
    if (!column || typeof column !== "object")
      fail("a derivation is not an object", path);
    if (typeof column.id !== "string" || column.id.length === 0)
      fail("a derivation has no column ID", `${path}.id`);
    if (ids.has(column.id))
      fail(
        `duplicate derivation column ID ${column.id}`,
        `${path}.id`,
        column.id,
      );
    ids.add(column.id);
    if (!COLUMN_TYPES.has(column.type))
      fail(`column has invalid type ${column.type}`, `${path}.type`, column.id);
    if (
      typeof column.accessor !== "function" ||
      typeof column.value !== "function"
    ) {
      fail("column has no accessor", `${path}.accessor`, column.id);
    }
    if (column.compare !== undefined && typeof column.compare !== "function") {
      fail("column has an invalid comparator", `${path}.compare`, column.id);
    }
    validateAggregate(column, `${path}.aggregate`);
  }
}

function validateAggregate(column: RuntimeColumn, path: string): void {
  const aggregate = column.aggregate;
  if (aggregate === undefined) return;
  if (typeof aggregate === "string") {
    if (!BUILTIN_AGGREGATES.has(aggregate))
      fail(`unknown aggregate ${aggregate}`, path, column.id);
    if (NUMERIC_AGGREGATES.has(aggregate) && column.type !== "number") {
      fail(
        `numeric aggregate ${aggregate} requires a number column`,
        path,
        column.id,
      );
    }
    return;
  }
  if (!aggregate || typeof aggregate !== "object")
    fail("aggregate must be a built-in name or object", path, column.id);
  for (const operation of [
    "init",
    "accumulate",
    "merge",
    "finalize",
  ] as const) {
    if (typeof aggregate[operation] !== "function")
      fail(`aggregate has no ${operation}`, `${path}.${operation}`, column.id);
  }
}

function resolveColumn(
  columns: ReadonlyMap<string, RuntimeColumn>,
  columnId: string,
  area: string,
): RuntimeColumn {
  const column = columns.get(columnId);
  if (!column) fail(`references unknown column ${columnId}`, area, columnId);
  return column;
}

function validateOrdering(
  entry: RuntimeOrdering,
  columns: ReadonlyMap<string, RuntimeColumn>,
  area: "sort" | "rowGroups",
  index: number,
): void {
  const path = `query.${area}[${index}]`;
  if (!entry || typeof entry !== "object")
    fail(`${area} entry is not an object`, path);
  resolveColumn(columns, entry.columnId, `${path}.columnId`);
  const direction = entry.direction ?? "asc";
  if (direction !== "asc" && direction !== "desc")
    fail(`invalid direction ${direction}`, `${path}.direction`, entry.columnId);
  if (
    entry.nulls !== undefined &&
    entry.nulls !== "first" &&
    entry.nulls !== "last"
  ) {
    fail(
      `invalid null placement ${entry.nulls}`,
      `${path}.nulls`,
      entry.columnId,
    );
  }
}

function validateFilter(
  filter: RuntimeFilter,
  columns: ReadonlyMap<string, RuntimeColumn>,
  index: number,
): void {
  const path = `query.filters[${index}]`;
  if (!filter || typeof filter !== "object")
    fail("filter entry is not an object", path);
  const column = resolveColumn(columns, filter.columnId, `${path}.columnId`);
  const operators =
    FILTER_OPERATORS[column.type as keyof typeof FILTER_OPERATORS];
  if (!operators?.has(filter.operator))
    fail(
      `column cannot use operator ${filter.operator}`,
      `${path}.operator`,
      filter.columnId,
    );
  if (filter.operator === "isEmpty" || filter.operator === "isNotEmpty") return;
  if (filter.value === undefined || filter.value === null)
    fail("filter is missing its operand", `${path}.value`, filter.columnId);
  validateFilterOperand(column, filter, `${path}.value`);
}

function validateFilterOperand(
  column: RuntimeColumn,
  filter: RuntimeFilter,
  path: string,
): void {
  const value = filter.value;
  if (column.type === "number") {
    const values = filter.operator === "between" ? value : [value];
    if (
      !Array.isArray(values) ||
      (filter.operator === "between" && values.length !== 2) ||
      values.some((entry) => typeof entry !== "number" || Number.isNaN(entry))
    ) {
      fail(
        filter.operator === "between"
          ? "number range must contain exactly two non-NaN numbers"
          : "number operand must be a non-NaN number",
        path,
        column.id,
      );
    }
    return;
  }
  if (column.type === "date") {
    const values = filter.operator === "dateBetween" ? value : [value];
    if (
      !Array.isArray(values) ||
      (filter.operator === "dateBetween" && values.length !== 2) ||
      values.some((entry) => Number.isNaN(toDayMs(entry)))
    ) {
      fail(
        filter.operator === "dateBetween"
          ? "date range must contain exactly two valid ISO dates, Dates, or epoch values"
          : "date operand must be a valid ISO date, Date, or epoch value",
        path,
        column.id,
      );
    }
    return;
  }
  if (column.type === "text") {
    if (typeof value !== "string")
      fail("text operand must be a string", path, column.id);
    return;
  }
  if (!Array.isArray(value))
    fail("selection operand must be an array", path, column.id);
  const expected = column.type === "boolean" ? "boolean" : "string";
  if (value.some((entry) => typeof entry !== expected)) {
    fail(
      `${column.type} selection must contain only ${expected} values`,
      path,
      column.id,
    );
  }
}

function validateQuery(
  query: RuntimeQuery,
  columns: readonly RuntimeColumn[],
): void {
  if (!query || typeof query !== "object") fail("query is not an object");
  if (
    !Array.isArray(query.filters) ||
    !Array.isArray(query.sort) ||
    !Array.isArray(query.rowGroups)
  ) {
    fail("filters, sort, and rowGroups must be arrays");
  }
  const byId = new Map(columns.map((column) => [column.id, column]));
  query.filters.forEach((filter, index) => validateFilter(filter, byId, index));
  query.sort.forEach((entry, index) =>
    validateOrdering(entry, byId, "sort", index),
  );
  query.rowGroups.forEach((entry, index) =>
    validateOrdering(entry, byId, "rowGroups", index),
  );
}

function semanticValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => semanticValueEqual(value, right[index]))
    );
  }
  if (left instanceof Date && right instanceof Date)
    return Object.is(left.getTime(), right.getTime());
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

function queryEqual(left: RuntimeQuery, right: RuntimeQuery): boolean {
  const orderingEqual = (
    a: readonly RuntimeOrdering[],
    b: readonly RuntimeOrdering[],
  ) =>
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.columnId === b[index].columnId &&
        (entry.direction ?? "asc") === (b[index].direction ?? "asc") &&
        (entry.nulls ?? "last") === (b[index].nulls ?? "last"),
    );
  return (
    filtersEqual(left.filters, right.filters) &&
    orderingEqual(left.sort, right.sort) &&
    orderingEqual(left.rowGroups, right.rowGroups)
  );
}

function filtersEqual(
  left: readonly RuntimeFilter[],
  right: readonly RuntimeFilter[],
): boolean {
  if (left.length !== right.length) return false;
  const used = new Set<number>();
  return left.every((filter) => {
    const index = right.findIndex(
      (candidate, candidateIndex) =>
        !used.has(candidateIndex) &&
        filter.columnId === candidate.columnId &&
        filter.operator === candidate.operator &&
        semanticValueEqual(filter.value, candidate.value),
    );
    if (index < 0) return false;
    used.add(index);
    return true;
  });
}

function derivationsEqualForPlan(
  left: readonly RuntimeColumn[],
  right: readonly RuntimeColumn[],
  query: RuntimeQuery,
): boolean {
  if (left.length !== right.length) return false;
  const accessorIds = new Set<string>();
  const comparatorIds = new Set<string>();
  query.filters.forEach((entry) => accessorIds.add(entry.columnId));
  query.sort.forEach((entry) => {
    accessorIds.add(entry.columnId);
    comparatorIds.add(entry.columnId);
  });
  query.rowGroups.forEach((entry) => {
    accessorIds.add(entry.columnId);
    comparatorIds.add(entry.columnId);
  });

  return left.every((column, index) => {
    const other = right[index];
    if (column.id !== other.id || column.type !== other.type) return false;
    if (!semanticValueEqual(column.aggregate, other.aggregate)) return false;
    if (column.aggregate !== undefined) accessorIds.add(column.id);
    if (accessorIds.has(column.id) && column.accessor !== other.accessor)
      return false;
    if (comparatorIds.has(column.id) && column.compare !== other.compare)
      return false;
    return true;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneOwnedValue(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): unknown {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "function"
  ) {
    return value;
  }
  if (typeof value === "symbol")
    fail("symbols are not supported in compiled inputs", path);
  if (value instanceof Date) return immutableDate(value.getTime());
  if (typeof value !== "object") fail("unsupported compiled input value", path);
  if (seen.has(value)) fail("cyclic values are not supported", path);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((entry, index) =>
          cloneOwnedValue(entry, `${path}[${index}]`, seen),
        ),
      );
    }
    if (!isPlainObject(value)) {
      fail(
        "only Date, arrays, and plain objects are supported in compiled inputs",
        path,
      );
    }
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      clone[key] = cloneOwnedValue(value[key], `${path}.${key}`, seen);
    }
    return Object.freeze(clone);
  } finally {
    seen.delete(value);
  }
}

function immutableDate(timestamp: number): Date {
  const date = new Date(timestamp);
  const proxy = new Proxy(date, {
    get(target, property) {
      if (typeof property === "string" && property.startsWith("set")) {
        return () => {
          throw new TypeError("Compiled query Date snapshots are immutable.");
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
    set() {
      throw new TypeError("Compiled query Date snapshots are immutable.");
    },
  });
  return Object.freeze(proxy);
}

function snapshotColumns(
  columns: readonly RuntimeColumn[],
  path: string,
): readonly RuntimeColumn[] {
  return Object.freeze(
    columns.map((column, index) => {
      const aggregate =
        column.aggregate === undefined || typeof column.aggregate === "string"
          ? column.aggregate
          : snapshotAggregator(
              column.aggregate,
              `${path}[${index}].aggregate`,
              column.id,
            );
      return Object.freeze({ ...column, aggregate });
    }),
  );
}

function snapshotAggregator(
  aggregator: RuntimeAggregator,
  path: string,
  columnId: string,
): RuntimeAggregator {
  const source = aggregator as unknown as Record<string, unknown>;
  const clone: Record<string, unknown> = {};
  const callbacks = new Set(["init", "accumulate", "merge", "finalize"]);
  try {
    if (Object.getOwnPropertySymbols(aggregator).length > 0) {
      fail("symbol-keyed aggregate options are not supported", path, columnId);
    }
    for (const key of Object.keys(aggregator)) {
      if (!callbacks.has(key)) {
        clone[key] = cloneOwnedValue(
          source[key],
          `${path}.${key}`,
          new WeakSet(),
        );
      }
    }
  } catch (error) {
    if (
      error instanceof CompiledQueryValidationError &&
      error.columnId === undefined
    ) {
      throw new CompiledQueryValidationError(
        error.detail,
        error.path,
        columnId,
      );
    }
    throw error;
  }
  clone.init = aggregator.init;
  clone.accumulate = aggregator.accumulate;
  clone.merge = aggregator.merge;
  clone.finalize = aggregator.finalize;
  return Object.freeze(clone) as unknown as RuntimeAggregator;
}

function snapshotQuery(
  query: RuntimeQuery,
  path: string,
  canonicalFilters = false,
): RuntimeQuery {
  const filters = query.filters.map((filter, index) =>
    Object.freeze({
      ...filter,
      value: cloneOwnedValue(
        filter.value,
        `${path}.filters[${index}].value`,
        new WeakSet(),
      ),
    }),
  );
  if (canonicalFilters) filters.sort(compareFilterDescriptors);
  return Object.freeze({
    filters: Object.freeze(filters),
    sort: Object.freeze(query.sort.map((entry) => Object.freeze({ ...entry }))),
    rowGroups: Object.freeze(
      query.rowGroups.map((entry) => Object.freeze({ ...entry })),
    ),
  });
}

function compareFilterDescriptors(
  left: RuntimeFilter,
  right: RuntimeFilter,
): number {
  return filterDescriptorKey(left).localeCompare(filterDescriptorKey(right));
}

function filterDescriptorKey(filter: RuntimeFilter): string {
  return `${filter.columnId}\u0000${filter.operator}\u0000${filterValueKey(filter.value)}`;
}

function filterValueKey(value: unknown): string {
  if (value instanceof Date) return `date:${value.getTime()}`;
  if (Array.isArray(value))
    return `array:[${value.map(filterValueKey).join(",")}]`;
  if (typeof value === "number") {
    if (Object.is(value, -0)) return "number:-0";
    return `number:${String(value)}`;
  }
  return `${typeof value}:${String(value)}`;
}

function isEmptyValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isNaN(value)) ||
    (typeof value === "string" && value.trim() === "")
  );
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return Boolean(value);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;
const GREGORIAN_400Y_MS = 146_097 * 86_400_000;

function utcMs(year: number, month: number, day: number): number {
  return year >= 0 && year < 100
    ? Date.UTC(year + 400, month, day) - GREGORIAN_400Y_MS
    : Date.UTC(year, month, day);
}

function utcDayOf(value: number): number {
  const date = new Date(value);
  const year = date.getUTCFullYear();
  if (Number.isNaN(date.getTime()) || year < 0 || year > 9999)
    return Number.NaN;
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
}

function isoDayMs(value: string): number {
  if (!ISO_DATE_RE.test(value)) return Number.NaN;
  const [year, month, day] = value.split("-").map(Number);
  const result = utcMs(year, month - 1, day);
  const roundTrip = new Date(result);
  return roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
    ? result
    : Number.NaN;
}

/** Deterministic UTC calendar-day policy shared with the frozen legacy oracle. */
function toDayMs(value: unknown): number {
  if (value instanceof Date) return utcDayOf(value.getTime());
  if (typeof value === "number") return utcDayOf(value);
  if (typeof value !== "string") return Number.NaN;
  const trimmed = value.trim();
  const dateOnly = isoDayMs(trimmed);
  if (!Number.isNaN(dateOnly)) return dateOnly;
  const parts = ISO_DATETIME_RE.exec(trimmed);
  if (!parts || Number.isNaN(isoDayMs(parts[1]))) return Number.NaN;
  return parts[2]
    ? utcDayOf(Date.parse(trimmed.replace(" ", "T")))
    : isoDayMs(parts[1]);
}

function evaluateFilter(
  filter: RuntimeFilter,
  column: RuntimeColumn,
  value: unknown,
): boolean {
  if (filter.operator === "isEmpty") return isEmptyValue(value);
  if (filter.operator === "isNotEmpty") return !isEmptyValue(value);
  const operand = filter.value;
  switch (column.type) {
    case "number": {
      if (typeof value !== "number" || Number.isNaN(value)) return false;
      if (filter.operator === "between") {
        const range = operand as readonly unknown[];
        const a = range[0];
        const b = range[1];
        if (typeof a !== "number" || typeof b !== "number") return false;
        return value >= Math.min(a, b) && value <= Math.max(a, b);
      }
      if (typeof operand !== "number" || Number.isNaN(operand)) return false;
      if (filter.operator === "equals") return value === operand;
      if (filter.operator === "notEquals") return value !== operand;
      if (filter.operator === "gt") return value > operand;
      if (filter.operator === "gte") return value >= operand;
      if (filter.operator === "lt") return value < operand;
      return value <= operand;
    }
    case "date": {
      const cell = toDayMs(value);
      if (Number.isNaN(cell)) return false;
      if (filter.operator === "dateBetween") {
        const range = operand as readonly unknown[];
        const a = toDayMs(range[0]);
        const b = toDayMs(range[1]);
        return (
          !Number.isNaN(a) &&
          !Number.isNaN(b) &&
          cell >= Math.min(a, b) &&
          cell <= Math.max(a, b)
        );
      }
      const other = toDayMs(operand);
      if (Number.isNaN(other)) return false;
      if (filter.operator === "on") return cell === other;
      return filter.operator === "before" ? cell < other : cell > other;
    }
    case "enum": {
      if ((operand as readonly unknown[]).length === 0) return true;
      const included = (operand as readonly unknown[])
        .map(String)
        .includes(String(value));
      return filter.operator === "isAnyOf" ? included : !included;
    }
    case "boolean": {
      if ((operand as readonly unknown[]).length === 0) return true;
      const included = (operand as readonly unknown[])
        .map(booleanValue)
        .includes(booleanValue(value));
      return filter.operator === "isAnyOf" ? included : !included;
    }
    default: {
      const cell = String(value ?? "").toLocaleLowerCase();
      const search = String(operand).toLocaleLowerCase();
      if (filter.operator === "contains") return cell.includes(search);
      if (filter.operator === "notContains") return !cell.includes(search);
      if (filter.operator === "equals") return cell === search;
      if (filter.operator === "notEquals") return cell !== search;
      if (filter.operator === "startsWith") return cell.startsWith(search);
      return cell.endsWith(search);
    }
  }
}

function isNullSortValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "number" && Number.isNaN(value))
  );
}

function compareValues(
  left: unknown,
  right: unknown,
  column: RuntimeColumn,
  ordering: RuntimeOrdering,
): number {
  const leftNull = isNullSortValue(left);
  const rightNull = isNullSortValue(right);
  if (leftNull || rightNull) {
    if (leftNull && rightNull) return 0;
    const nullResult = ordering.nulls === "first" ? -1 : 1;
    return leftNull ? nullResult : -nullResult;
  }
  let result: number;
  if (column.compare) {
    result = column.compare(left as never, right as never);
  } else if (
    column.type === "number" &&
    typeof left === "number" &&
    typeof right === "number"
  ) {
    result = left - right;
  } else {
    result = collator.compare(String(left), String(right));
  }
  if (Number.isNaN(result)) result = 0;
  return ordering.direction === "desc" ? -result : result;
}

class CompiledQueryPlan<TColumns>
  implements CompiledQuery<TColumns>, InternalCompiledQuery
{
  readonly derivations: PretableDerivationsFor<TColumns>;
  readonly query: PretableQueryFor<TColumns>;
  readonly activeColumnIds: readonly ColumnIdOf<TColumns>[];
  readonly #runtimeColumns: readonly RuntimeColumn[];
  readonly #runtimeQuery: RuntimeQuery;
  readonly #byId: ReadonlyMap<string, RuntimeColumn>;
  readonly #active: readonly RuntimeColumn[];
  readonly #aggregateColumns: readonly RuntimeColumn[];
  readonly #evaluationCache = new WeakMap<object, CachedEvaluation>();

  readonly [internals] = {
    semanticallyMatches: (
      derivations: readonly RuntimeColumn[],
      query: RuntimeQuery,
    ) =>
      derivationsEqualForPlan(
        this.#runtimeColumns,
        derivations,
        this.#runtimeQuery,
      ) && queryEqual(this.#runtimeQuery, query),
  };

  constructor(
    derivations: PretableDerivationsFor<TColumns>,
    query: PretableQueryFor<TColumns>,
  ) {
    const sourceColumns = runtimeColumns(derivations);
    const sourceQuery = runtimeQuery(query);
    this.derivations = snapshotColumns(
      sourceColumns,
      "derivations",
    ) as unknown as PretableDerivationsFor<TColumns>;
    this.query = snapshotQuery(
      sourceQuery,
      "query",
    ) as unknown as PretableQueryFor<TColumns>;
    this.#runtimeColumns = snapshotColumns(
      sourceColumns,
      "internal.derivations",
    );
    this.#runtimeQuery = snapshotQuery(sourceQuery, "internal.query", true);
    this.#byId = new Map(
      this.#runtimeColumns.map((column) => [column.id, column]),
    );
    const activeIds = new Set<string>();
    this.#runtimeQuery.filters.forEach((entry) =>
      activeIds.add(entry.columnId),
    );
    this.#runtimeQuery.rowGroups.forEach((entry) =>
      activeIds.add(entry.columnId),
    );
    this.#runtimeQuery.sort.forEach((entry) => activeIds.add(entry.columnId));
    this.#aggregateColumns = this.#runtimeColumns.filter(
      (column) => column.aggregate !== undefined,
    );
    this.#aggregateColumns.forEach((column) => activeIds.add(column.id));
    this.#active = this.#runtimeColumns.filter((column) =>
      activeIds.has(column.id),
    );
    this.activeColumnIds = Object.freeze(
      this.#active.map((column) => column.id),
    ) as readonly ColumnIdOf<TColumns>[];
  }

  evaluate<TRowId extends PretableRowId>(
    input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  ): CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns> {
    const cached = this.#evaluationCache.get(input.row);
    if (
      cached &&
      Object.is(cached.rowId, input.rowId) &&
      cached.sourceOrder === input.sourceOrder
    ) {
      return cached.metadata as CompiledRowMetadata<
        RowForColumns<TColumns>,
        TRowId,
        TColumns
      >;
    }

    const values = new Map<string, unknown>();
    for (const column of this.#active) {
      try {
        values.set(column.id, column.accessor(input.row as never));
      } catch (cause) {
        throw new PretableRowModelError(
          "accessor-failed",
          `Column ${column.id} accessor failed.`,
          {
            operation: "set-query",
            rowId: input.rowId,
            columnId: column.id,
            cause,
          },
        );
      }
    }

    const filterPasses = this.#runtimeQuery.filters.every((filter) =>
      evaluateFilter(
        filter,
        this.#byId.get(filter.columnId)!,
        values.get(filter.columnId),
      ),
    );
    const groupPath = Object.freeze(
      this.#runtimeQuery.rowGroups.map((entry) =>
        Object.freeze({
          columnId: entry.columnId,
          value: values.get(entry.columnId),
        }),
      ),
    ) as readonly CompiledGroupKey<TColumns>[];
    const sortKeys = Object.freeze(
      this.#runtimeQuery.sort.map((entry) =>
        Object.freeze({
          columnId: entry.columnId,
          value: values.get(entry.columnId),
        }),
      ),
    ) as readonly CompiledSortKey<TColumns>[];
    const dependency = Object.freeze({
      sourceOrder: input.sourceOrder,
      sortKeys,
    });
    const aggregateLeaves = Object.freeze(
      this.#aggregateColumns.map((column) => {
        const allLeaf = Object.freeze({
          id: input.rowId,
          row: input.row,
          value: values.get(column.id),
          dependency,
        });
        return Object.freeze({
          columnId: column.id,
          aggregate: column.aggregate,
          allLeaf,
          filteredLeaf: filterPasses ? allLeaf : undefined,
        });
      }),
    ) as unknown as readonly CompiledAggregateLeaf<TColumns, TRowId>[];
    const metadata = Object.freeze({
      rowId: input.rowId,
      row: input.row,
      sourceOrder: input.sourceOrder,
      filterPasses,
      groupPath,
      sortKeys,
      aggregateLeaves,
    }) as CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns>;
    this.#evaluationCache.set(input.row, {
      rowId: input.rowId,
      sourceOrder: input.sourceOrder,
      metadata,
    });
    return metadata;
  }

  readonly compareRows = <TRowId extends PretableRowId>(
    left: CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns>,
    right: CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns>,
  ): number => {
    for (let index = 0; index < this.#runtimeQuery.sort.length; index += 1) {
      const ordering = this.#runtimeQuery.sort[index];
      const column = this.#byId.get(ordering.columnId)!;
      try {
        const result = compareValues(
          left.sortKeys[index]?.value,
          right.sortKeys[index]?.value,
          column,
          ordering,
        );
        if (result !== 0) return result;
      } catch (cause) {
        throw new CompiledQueryComparatorError(
          "A compiled row comparator failed.",
          [left.rowId, right.rowId],
          { columnId: ordering.columnId, cause },
        );
      }
    }
    return left.sourceOrder - right.sourceOrder;
  };

  compareGroupKeys(
    level: number,
    left: CompiledGroupKey<TColumns>,
    right: CompiledGroupKey<TColumns>,
  ): number {
    const ordering = this.#runtimeQuery.rowGroups[level];
    if (!ordering) throw new RangeError(`Unknown row-group level ${level}.`);
    const column = this.#byId.get(ordering.columnId)!;
    try {
      return compareValues(left.value, right.value, column, ordering);
    } catch (cause) {
      throw new CompiledQueryComparatorError(
        "A compiled group comparator failed.",
        undefined,
        { columnId: ordering.columnId, cause },
      );
    }
  }
}

export function compileQuery<const TColumns>(
  input: CompileQueryInput<TColumns>,
): CompiledQuery<TColumns> {
  const columns = runtimeColumns(input.derivations);
  const query = runtimeQuery(input.query);
  validateDerivations(columns);
  validateQuery(query, columns);
  const semanticColumns = snapshotColumns(columns, "derivations");
  const semanticQuery = snapshotQuery(query, "query");

  const previous = input.previous as
    (CompiledQuery<TColumns> & Partial<InternalCompiledQuery>) | undefined;
  if (
    previous?.[internals]?.semanticallyMatches(semanticColumns, semanticQuery)
  )
    return input.previous!;

  return new CompiledQueryPlan(input.derivations, input.query);
}
