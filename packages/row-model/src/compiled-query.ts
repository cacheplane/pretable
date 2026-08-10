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

function fail(message: string): never {
  throw new TypeError(`Invalid compiled query: ${message}`);
}

function validateDerivations(columns: readonly RuntimeColumn[]): void {
  const ids = new Set<string>();
  for (const column of columns) {
    if (!column || typeof column !== "object")
      fail("a derivation is not an object");
    if (typeof column.id !== "string" || column.id.length === 0)
      fail("a derivation has no column ID");
    if (ids.has(column.id)) fail(`duplicate derivation column ID ${column.id}`);
    ids.add(column.id);
    if (!COLUMN_TYPES.has(column.type))
      fail(`column ${column.id} has invalid type ${column.type}`);
    if (
      typeof column.accessor !== "function" ||
      typeof column.value !== "function"
    ) {
      fail(`column ${column.id} has no accessor`);
    }
    if (column.compare !== undefined && typeof column.compare !== "function") {
      fail(`column ${column.id} has an invalid comparator`);
    }
    validateAggregate(column);
  }
}

function validateAggregate(column: RuntimeColumn): void {
  const aggregate = column.aggregate;
  if (aggregate === undefined) return;
  if (typeof aggregate === "string") {
    if (!BUILTIN_AGGREGATES.has(aggregate))
      fail(`column ${column.id} has unknown aggregate ${aggregate}`);
    if (NUMERIC_AGGREGATES.has(aggregate) && column.type !== "number") {
      fail(`column ${column.id} cannot use numeric aggregate ${aggregate}`);
    }
    return;
  }
  if (!aggregate || typeof aggregate !== "object")
    fail(`column ${column.id} has an invalid aggregate`);
  for (const operation of [
    "init",
    "accumulate",
    "merge",
    "finalize",
  ] as const) {
    if (typeof aggregate[operation] !== "function")
      fail(`column ${column.id} aggregate has no ${operation}`);
  }
}

function resolveColumn(
  columns: ReadonlyMap<string, RuntimeColumn>,
  columnId: string,
  area: string,
): RuntimeColumn {
  const column = columns.get(columnId);
  if (!column) fail(`${area} references unknown column ${columnId}`);
  return column;
}

function validateOrdering(
  entry: RuntimeOrdering,
  columns: ReadonlyMap<string, RuntimeColumn>,
  area: "sort" | "rowGroups",
): void {
  if (!entry || typeof entry !== "object")
    fail(`${area} entry is not an object`);
  resolveColumn(columns, entry.columnId, area);
  const direction = entry.direction ?? "asc";
  if (direction !== "asc" && direction !== "desc")
    fail(`${area} has invalid direction ${direction}`);
  if (
    entry.nulls !== undefined &&
    entry.nulls !== "first" &&
    entry.nulls !== "last"
  ) {
    fail(`${area} has invalid null placement ${entry.nulls}`);
  }
}

function validateFilter(
  filter: RuntimeFilter,
  columns: ReadonlyMap<string, RuntimeColumn>,
): void {
  if (!filter || typeof filter !== "object")
    fail("filter entry is not an object");
  const column = resolveColumn(columns, filter.columnId, "filter");
  const operators =
    FILTER_OPERATORS[column.type as keyof typeof FILTER_OPERATORS];
  if (!operators?.has(filter.operator))
    fail(`column ${filter.columnId} cannot use operator ${filter.operator}`);
  if (filter.operator === "isEmpty" || filter.operator === "isNotEmpty") return;
  if (filter.value === undefined || filter.value === null)
    fail(`filter ${filter.columnId} is missing its operand`);
  if (filter.operator === "between" || filter.operator === "dateBetween") {
    if (!Array.isArray(filter.value) || filter.value.length !== 2)
      fail(`filter ${filter.columnId} requires a two-value range`);
  }
  if (filter.operator === "isAnyOf" || filter.operator === "isNoneOf") {
    if (!Array.isArray(filter.value))
      fail(`filter ${filter.columnId} requires a value list`);
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
  query.filters.forEach((filter) => validateFilter(filter, byId));
  query.sort.forEach((entry) => validateOrdering(entry, byId, "sort"));
  query.rowGroups.forEach((entry) =>
    validateOrdering(entry, byId, "rowGroups"),
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
    left.filters.length === right.filters.length &&
    left.filters.every((filter, index) => {
      const other = right.filters[index];
      return (
        filter.columnId === other.columnId &&
        filter.operator === other.operator &&
        semanticValueEqual(filter.value, other.value)
      );
    }) &&
    orderingEqual(left.sort, right.sort) &&
    orderingEqual(left.rowGroups, right.rowGroups)
  );
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
    if (column.aggregate !== other.aggregate) return false;
    if (column.aggregate !== undefined) accessorIds.add(column.id);
    if (accessorIds.has(column.id) && column.accessor !== other.accessor)
      return false;
    if (comparatorIds.has(column.id) && column.compare !== other.compare)
      return false;
    return true;
  });
}

function snapshotQuery(query: RuntimeQuery): RuntimeQuery {
  return {
    filters: query.filters.map((filter) => ({
      ...filter,
      value: Array.isArray(filter.value) ? [...filter.value] : filter.value,
    })),
    sort: query.sort.map((entry) => ({ ...entry })),
    rowGroups: query.rowGroups.map((entry) => ({ ...entry })),
  };
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

function dateValue(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number")
    return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value !== "string" || value.trim() === "") return Number.NaN;
  return Date.parse(value);
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
      const cell = dateValue(value);
      if (Number.isNaN(cell)) return false;
      if (filter.operator === "dateBetween") {
        const range = operand as readonly unknown[];
        const a = dateValue(range[0]);
        const b = dateValue(range[1]);
        return (
          !Number.isNaN(a) &&
          !Number.isNaN(b) &&
          cell >= Math.min(a, b) &&
          cell <= Math.max(a, b)
        );
      }
      const other = dateValue(operand);
      if (Number.isNaN(other)) return false;
      if (filter.operator === "on") return cell === other;
      return filter.operator === "before" ? cell < other : cell > other;
    }
    case "enum": {
      const included = (operand as readonly unknown[])
        .map(String)
        .includes(String(value));
      return filter.operator === "isAnyOf" ? included : !included;
    }
    case "boolean": {
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
    readonly derivations: PretableDerivationsFor<TColumns>,
    readonly query: PretableQueryFor<TColumns>,
  ) {
    this.#runtimeColumns = runtimeColumns(derivations).map((column) => ({
      ...column,
    }));
    this.#runtimeQuery = snapshotQuery(runtimeQuery(query));
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
    try {
      for (let index = 0; index < this.#runtimeQuery.sort.length; index += 1) {
        const ordering = this.#runtimeQuery.sort[index];
        const column = this.#byId.get(ordering.columnId)!;
        const result = compareValues(
          left.sortKeys[index]?.value,
          right.sortKeys[index]?.value,
          column,
          ordering,
        );
        if (result !== 0) return result;
      }
      return left.sourceOrder - right.sourceOrder;
    } catch (cause) {
      throw new PretableRowModelError(
        "comparator-failed",
        "A compiled row comparator failed.",
        {
          operation: "set-query",
          cause,
        },
      );
    }
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
      throw new PretableRowModelError(
        "comparator-failed",
        "A compiled group comparator failed.",
        {
          operation: "set-query",
          columnId: ordering.columnId,
          cause,
        },
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

  const previous = input.previous as
    (CompiledQuery<TColumns> & Partial<InternalCompiledQuery>) | undefined;
  if (previous?.[internals]?.semanticallyMatches(columns, query))
    return input.previous!;

  return new CompiledQueryPlan(input.derivations, input.query);
}
