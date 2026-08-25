import type {
  ColumnDescriptorOf,
  ColumnIdOf,
  PretableDerivationsFor,
  PretableQueryFor,
  PretableRowId,
} from "./column-types";
import { PretableRowModelError } from "./errors";
import {
  COLUMNAR_HOLE,
  columnarClearCell,
  columnarGetCell,
  columnarGetCellTrusted,
  columnarSetCell,
  createColumnarVector,
  type ColumnarHole,
  type MutableColumnarVector,
} from "./mutable-columnar";
import type { AggregateTreeLeaf } from "./persistent/aggregate-tree";
import { forEachSlotEntry, type SlotVector } from "./slot-vector";

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

/**
 * The aggregate leaf's per-evaluation payload. It carries the row's sort
 * keys so aggregate-tree comparators are property reads — the leaf-side
 * variant of `OrderedRowEntry` (wrapping the leaf itself would ripple
 * through the aggregation machinery's `value`/`id`/`row` reads). Keys stay
 * valid for the containing tree's lifetime: leaves are rebuilt whenever
 * their row re-evaluates, and aggregate trees are bound to one plan.
 */
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
  /**
   * The row's dense handle slot (Amendment J §1). Every caller either holds
   * the record — which already carries `.slot` — or is creating one and has
   * just allocated the slot, so this is always available to stamp here.
   * Unread by this task; it exists so columnar cells can later be written
   * and read by slot instead of by string key.
   */
  readonly slot: number;
}

/**
 * Structural slice of `LocalRowModelInstrumentation` consumed by
 * `fillSortKeysFromPrevious`. Declared here (not imported from
 * `./diagnostics`) so this module stays free of import cycles.
 */
export interface SortKeyFillInstrumentation {
  readonly work: {
    sortKeyCarries: number;
    sortKeyEvaluations: number;
  };
}

/**
 * Structural slice of `LocalRowModelInstrumentation` consumed by
 * `bulkFilterVerdictSweep`. Declared here for the same cycle-avoidance reason
 * as `SortKeyFillInstrumentation`.
 */
export interface ColumnarScanInstrumentation {
  readonly work: {
    columnarCellFills: number;
  };
}

export interface CompiledRowMetadata<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rowId: TRowId;
  readonly row: TRow;
  readonly sourceOrder: number;
  readonly groupPath: readonly CompiledGroupKey<TColumns>[];
  /**
   * One leaf per aggregated column. There is no filtered variant: filtered
   * aggregation is membership in a separate aggregate TREE, decided by the
   * row's verdict at insert time, so a per-leaf copy would only restate it.
   */
  readonly aggregateLeaves: readonly CompiledAggregateLeaf<TColumns, TRowId>[];
}

export interface CompiledQuery<TColumns> {
  readonly derivations: PretableDerivationsFor<TColumns>;
  readonly query: PretableQueryFor<TColumns>;
  readonly activeColumnIds: readonly ColumnIdOf<TColumns>[];
  evaluate<TRowId extends PretableRowId>(
    input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  ): CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns>;
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

/**
 * Who selected the records the plan is handed. `"external"` says something
 * outside the engine already applied `query.filters`, so the plan publishes
 * them and stops re-applying them.
 */
export type CompiledFilterAuthority = "engine" | "external";

/**
 * Who ordered the records the plan is handed. `"external"` says something
 * outside the engine already applied `query.sort`, so the plan publishes it and
 * stops re-applying it.
 *
 * The case for this is narrower than filtering's and worth stating. A consumer
 * holding the whole matching population who sorts locally is being perfectly
 * reasonable — but that consumer declares `"engine"`, so suppression never
 * touches them. It binds only the consumer who said the server owns ordering,
 * and for that consumer re-sorting is wrong twice over: over a partial window a
 * local sort reorders a server-selected SAMPLE, so the rows on screen are not
 * the top N of anything; and while `dataState.phase === "stale"` it reorders
 * rows that answer the previous query by the comparator of the new one.
 */
export type CompiledSortAuthority = "engine" | "external";

export interface CompileQueryInput<TColumns> {
  readonly derivations: PretableDerivationsFor<TColumns>;
  readonly query: PretableQueryFor<TColumns>;
  readonly operation?: "set-query" | "set-derivations";
  /** Supply the current plan so semantic no-ops preserve plan and cache identity. */
  readonly previous?: CompiledQuery<TColumns>;
  /**
   * Defaults to `"engine"`. Under `"external"` the compiled plan reports
   * `query.filters` unchanged and evaluates every row as passing, so the
   * records the caller was handed are the records the engine draws.
   */
  readonly filterAuthority?: CompiledFilterAuthority;
  /**
   * Defaults to `"engine"`. Under `"external"` the compiled plan reports
   * `query.sort` unchanged and evaluates rows in the order they were handed in,
   * so the ranking the caller was given is the ranking the engine draws.
   */
  readonly sortAuthority?: CompiledSortAuthority;
}

export class CompiledQueryValidationError extends TypeError {
  readonly name = "CompiledQueryValidationError";
  readonly code = "invalid-query";

  constructor(
    readonly detail: string,
    readonly path: string,
    readonly columnId?: string,
    options?: { readonly cause?: unknown },
  ) {
    super(`Invalid compiled query at ${path}: ${detail}`, options);
  }
}

export class CompiledQueryComparatorError extends PretableRowModelError {
  readonly name = "CompiledQueryComparatorError";
  readonly groupValues: readonly unknown[] | undefined;

  constructor(
    message: string,
    readonly rowIds: readonly PretableRowId[] | undefined,
    context: {
      readonly columnId: string;
      readonly cause: unknown;
      readonly groupValues?: readonly unknown[];
      readonly operation?: "set-query" | "set-derivations";
    },
  ) {
    super("comparator-failed", message, {
      operation: context.operation ?? "set-query",
      rowId: rowIds?.[0],
      columnId: context.columnId,
      cause: context.cause,
    });
    this.groupValues = context.groupValues;
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
  readonly snapshotAccumulator?: (
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

/*
 * One WeakMap entry per row per plan, written by `evaluate` (full) or
 * `fillSortKeysFromPrevious` (keys-only: `metadata` absent). Merged into a
 * single map deliberately: a second per-row WeakMap doubles the synchronous
 * ephemeron-table rehash V8 performs at the 2/3-capacity threshold inside
 * ONE cooperative unit (~87k entries at 100k rows) — the measured worst
 * slice of the grouped rebuild. Fields are mutable so an upgrade reuses the
 * entry object: at most one `WeakMap.set` per row, one rehash.
 *
 * `metadata` reads stay guarded by the rowId/sourceOrder identity check.
 * `sortKeys` reads are UNGUARDED: keys depend only on the row object's
 * values and this plan's sort columns — they embed no rowId/sourceOrder, so
 * re-evaluation under a changed sourceOrder overwrites harmlessly.
 *
 * `filterPasses` is written ONLY beside a `metadata` write and read ONLY
 * under the same guard, so it means exactly "the verdict the cached metadata
 * was built with" — a memo of `evaluate`, not a verdict store. Verdicts are
 * never STORED anywhere: a committed root's verdict is its membership (see
 * `./filter-membership`), and this field only spares a second accessor pass
 * when a producer evaluates a row and then asks the plan what it decided.
 *
 * `verdictPlan` is the plan that wrote `filterPasses`. It is the ONE field
 * that exists because a cache can be SHARED between plans
 * (`adoptEvaluationCache`): every other field is a function of the row and
 * of facets an adopting plan holds identical, but a verdict is a function of
 * the FILTERS, which are exactly what changed. Tagging the writer keeps the
 * memo plan-scoped at zero per-row cost — the tag is written inside a write
 * that already happens, and an adopting plan simply misses the guard and
 * runs the accessors it would have run anyway.
 */
interface CachedEvaluation {
  rowId: PretableRowId;
  sourceOrder: number;
  metadata: object | undefined;
  filterPasses: boolean | undefined;
  verdictPlan: object | undefined;
  sortKeys: readonly { readonly columnId: string; readonly value: unknown }[];
}

/*
 * Everything `adoptEvaluationCache` moves between plans, wrapped in ONE
 * object so adoption stays one reference assignment no matter how many
 * sibling stores live here.
 *
 * `cache` is the per-row evaluation WeakMap documented above.
 *
 * `columnar` is Amendment J's columnar filter-value store: per FILTER
 * column, SCAN-NORMALIZED accessor values (`normalizeCellForScan` — text
 * lowercased, dates as UTC day-ms, enum/boolean coerced) indexed by
 * dense-handle slot. It is a
 * CACHE, NOT TRUTH — mutable in place, never read by snapshot reads, not
 * revision-scoped, never consulted by old roots (their verdicts are their
 * membership). The bulk filter scan is its ONLY writer (write-through on
 * holes); commits only CLEAR (changed/removed slots per transaction, a
 * wholesale reset on set-rows), so a present cell always reflects the row
 * the current committed revision binds to that slot. Aborted drafts never
 * touch it. The full invariant register lives at the head of
 * `./mutable-columnar`. Adoption validity matches `cache`'s: a filter-only
 * change preserves every accessor's semantics, so cached VALUES stay
 * correct even though the filters over them changed — a column no current
 * filter references simply idles until a later scan needs it.
 */
interface SharedEvaluationState {
  readonly cache: WeakMap<object, CachedEvaluation>;
  readonly columnar: Map<string, MutableColumnarVector>;
}

const internals = Symbol("compiled-query-internals");

interface InternalCompiledQuery {
  readonly [internals]: {
    semanticallyMatches(
      derivations: readonly RuntimeColumn[],
      query: RuntimeQuery,
      filterAuthority: CompiledFilterAuthority,
      sortAuthority: CompiledSortAuthority,
    ): boolean;
  };
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export const FILTER_OPERATORS = {
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

interface CapturedCompileInput {
  readonly columns: readonly RuntimeColumn[];
  readonly query: RuntimeQuery;
  readonly previous: object | undefined;
  readonly filterAuthority: CompiledFilterAuthority;
  readonly sortAuthority: CompiledSortAuthority;
}

function captureCompileInput(input: object): CapturedCompileInput {
  const rawColumns = captureProperty(input, "derivations", "input.derivations");
  const rawQuery = captureProperty(input, "query", "input.query");
  const previous = captureProperty(input, "previous", "input.previous");
  const rawAuthority = captureProperty(
    input,
    "filterAuthority",
    "input.filterAuthority",
  );
  const rawSortAuthority = captureProperty(
    input,
    "sortAuthority",
    "input.sortAuthority",
  );
  if (rawQuery === null || typeof rawQuery !== "object")
    fail("query must be an object", "input.query");
  if (
    rawAuthority !== undefined &&
    rawAuthority !== "engine" &&
    rawAuthority !== "external"
  )
    fail(
      'filterAuthority must be "engine" or "external"',
      "input.filterAuthority",
    );
  if (
    rawSortAuthority !== undefined &&
    rawSortAuthority !== "engine" &&
    rawSortAuthority !== "external"
  )
    fail('sortAuthority must be "engine" or "external"', "input.sortAuthority");
  return {
    columns: captureColumns(rawColumns),
    query: captureQuery(rawQuery),
    previous: previous as object | undefined,
    filterAuthority: (rawAuthority ?? "engine") as CompiledFilterAuthority,
    sortAuthority: (rawSortAuthority ?? "engine") as CompiledSortAuthority,
  };
}

function captureColumns(rawColumns: unknown): readonly RuntimeColumn[] {
  return captureDenseArray(
    rawColumns,
    "derivations",
    "derivations must be an array",
    (rawColumn, index) => {
      const path = `derivations[${index}]`;
      if (rawColumn === null || typeof rawColumn !== "object")
        fail("a derivation is not an object", path);
      const id = captureProperty(rawColumn, "id", `${path}.id`);
      const columnId = typeof id === "string" ? id : undefined;
      const type = captureProperty(rawColumn, "type", `${path}.type`, columnId);
      const accessor = captureProperty(
        rawColumn,
        "accessor",
        `${path}.accessor`,
        columnId,
      );
      const value = captureProperty(
        rawColumn,
        "value",
        `${path}.value`,
        columnId,
      );
      const compare = captureProperty(
        rawColumn,
        "compare",
        `${path}.compare`,
        columnId,
      );
      const rawAggregate = captureProperty(
        rawColumn,
        "aggregate",
        `${path}.aggregate`,
        columnId,
      );
      const aggregate =
        rawAggregate !== null && typeof rawAggregate === "object"
          ? captureAggregator(rawAggregate, `${path}.aggregate`, columnId)
          : rawAggregate;
      return Object.freeze({
        id,
        type,
        accessor,
        value,
        compare,
        aggregate,
      }) as unknown as RuntimeColumn;
    },
  );
}

function captureAggregator(
  source: object,
  path: string,
  columnId?: string,
): RuntimeAggregator {
  let keys: string[];
  try {
    keys = Object.keys(source);
    if (Object.getOwnPropertySymbols(source).length > 0)
      fail("symbol-keyed aggregate options are not supported", path, columnId);
  } catch (cause) {
    if (cause instanceof CompiledQueryValidationError) throw cause;
    throw new CompiledQueryValidationError(
      "aggregate property discovery threw while compiling",
      path,
      columnId,
      { cause },
    );
  }
  const required = ["init", "accumulate", "merge", "finalize"];
  const allKeys = [...new Set([...keys, ...required, "snapshotAccumulator"])];
  const clone: Record<string, unknown> = {};
  for (const key of allKeys) {
    const captured = captureProperty(source, key, `${path}.${key}`, columnId);
    clone[key] = required.includes(key)
      ? captured
      : cloneOwnedValue(captured, `${path}.${key}`, new WeakSet(), columnId);
  }
  return Object.freeze(clone) as unknown as RuntimeAggregator;
}

function captureQuery(source: object): RuntimeQuery {
  const rawFilters = captureProperty(source, "filters", "query.filters");
  const rawSort = captureProperty(source, "sort", "query.sort");
  const rawRowGroups = captureProperty(source, "rowGroups", "query.rowGroups");
  return Object.freeze({
    filters: captureDenseArray(
      rawFilters,
      "query.filters",
      "filters must be an array",
      captureFilter,
    ),
    sort: captureDenseArray(
      rawSort,
      "query.sort",
      "sort must be an array",
      (entry, index) => captureOrdering(entry, "sort", index),
    ),
    rowGroups: captureDenseArray(
      rawRowGroups,
      "query.rowGroups",
      "rowGroups must be an array",
      (entry, index) => captureOrdering(entry, "rowGroups", index),
    ),
  });
}

function captureDenseArray<T>(
  source: unknown,
  path: string,
  notArrayDetail: string,
  captureEntry: (entry: unknown, index: number) => T,
): readonly T[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(source);
  } catch (cause) {
    throw new CompiledQueryValidationError(
      "array brand check threw while compiling",
      path,
      undefined,
      { cause },
    );
  }
  if (!isArray) fail(notArrayDetail, path);

  const array = source as unknown[];
  const length = captureProperty(array, "length", `${path}.length`);
  if (
    typeof length !== "number" ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > 0xffff_ffff
  ) {
    fail("array length is invalid", `${path}.length`);
  }

  const captured: T[] = [];
  for (let index = 0; index < length; index += 1) {
    const entryPath = `${path}[${index}]`;
    let hasOwnIndex: boolean;
    try {
      hasOwnIndex = Object.prototype.hasOwnProperty.call(array, index);
    } catch (cause) {
      throw new CompiledQueryValidationError(
        "array index presence check threw while compiling",
        entryPath,
        undefined,
        { cause },
      );
    }
    if (!hasOwnIndex) fail("array index is missing", entryPath);
    const entry = captureProperty(array, index, entryPath);
    captured.push(captureEntry(entry, index));
  }
  return Object.freeze(captured);
}

function captureFilter(raw: unknown, index: number): RuntimeFilter {
  const path = `query.filters[${index}]`;
  if (raw === null || typeof raw !== "object")
    fail("filter entry is not an object", path);
  const columnId = captureProperty(raw, "columnId", `${path}.columnId`);
  const contextId = typeof columnId === "string" ? columnId : undefined;
  const operator = captureProperty(
    raw,
    "operator",
    `${path}.operator`,
    contextId,
  );
  const value = captureProperty(raw, "value", `${path}.value`, contextId);
  return Object.freeze({
    columnId,
    operator,
    value: cloneOwnedValue(value, `${path}.value`, new WeakSet(), contextId),
  }) as unknown as RuntimeFilter;
}

function captureOrdering(
  raw: unknown,
  area: "sort" | "rowGroups",
  index: number,
): RuntimeOrdering {
  const path = `query.${area}[${index}]`;
  if (raw === null || typeof raw !== "object")
    fail(`${area} entry is not an object`, path);
  const columnId = captureProperty(raw, "columnId", `${path}.columnId`);
  const contextId = typeof columnId === "string" ? columnId : undefined;
  const direction = captureProperty(
    raw,
    "direction",
    `${path}.direction`,
    contextId,
  );
  const nulls = captureProperty(raw, "nulls", `${path}.nulls`, contextId);
  return Object.freeze({
    columnId,
    direction,
    nulls,
  }) as unknown as RuntimeOrdering;
}

function fail(message: string, path = "query", columnId?: string): never {
  throw new CompiledQueryValidationError(message, path, columnId);
}

function captureProperty(
  source: object,
  property: PropertyKey,
  path: string,
  columnId?: string,
): unknown {
  try {
    return Reflect.get(source, property);
  } catch (cause) {
    throw new CompiledQueryValidationError(
      "property getter threw while compiling",
      path,
      columnId,
      { cause },
    );
  }
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
  if (
    aggregate.snapshotAccumulator !== undefined &&
    typeof aggregate.snapshotAccumulator !== "function"
  ) {
    fail(
      "aggregate has an invalid snapshotAccumulator",
      `${path}.snapshotAccumulator`,
      column.id,
    );
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
  if (column.type === "boolean") {
    // A boolean column's operand must match what `booleanValue()` treats as
    // one of the two states AND what the docs promise the funnel can send:
    // real booleans, or the string literals "true"/"false" (the only values
    // a column's `options` are allowed to relabel to, per
    // content/docs/grid/filtering.mdx). Deliberately excludes 1/0/"1"/"0" —
    // `booleanValue()` also coerces those, but the docs never promise them,
    // so accepting them here would be validator-only drift ahead of the
    // documented contract instead of behind it.
    if (
      value.some(
        (entry) =>
          typeof entry !== "boolean" && entry !== "true" && entry !== "false",
      )
    ) {
      fail(
        'boolean selection must contain only boolean values or the strings "true"/"false"',
        path,
        column.id,
      );
    }
    return;
  }
  if (value.some((entry) => typeof entry !== "string")) {
    fail(
      `${column.type} selection must contain only string values`,
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
    return Object.is(readDateTimestamp(left), readDateTimestamp(right));
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

function orderingEqual(
  a: readonly RuntimeOrdering[],
  b: readonly RuntimeOrdering[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.columnId === b[index].columnId &&
        (entry.direction ?? "asc") === (b[index].direction ?? "asc") &&
        (entry.nulls ?? "last") === (b[index].nulls ?? "last"),
    )
  );
}

function queryEqual(left: RuntimeQuery, right: RuntimeQuery): boolean {
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
  columnId?: string,
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
    fail("symbols are not supported in compiled inputs", path, columnId);
  let dateLike: boolean;
  try {
    dateLike = value instanceof Date;
  } catch (cause) {
    throw new CompiledQueryValidationError(
      "value brand check threw while compiling",
      path,
      columnId,
      { cause },
    );
  }
  if (dateLike) {
    const timestamp = readDateTimestamp(value as Date);
    if (timestamp === undefined)
      fail("value has an invalid Date brand", path, columnId);
    return Object.freeze(new Date(timestamp));
  }
  if (typeof value !== "object")
    fail("unsupported compiled input value", path, columnId);
  if (seen.has(value)) fail("cyclic values are not supported", path, columnId);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const captured: unknown[] = [];
      for (let index = 0; index < value.length; index += 1) {
        captured.push(
          cloneOwnedValue(
            captureProperty(value, index, `${path}[${index}]`, columnId),
            `${path}[${index}]`,
            seen,
            columnId,
          ),
        );
      }
      return Object.freeze(captured);
    }
    if (!isPlainObject(value)) {
      fail(
        "only Date, arrays, and plain objects are supported in compiled inputs",
        path,
        columnId,
      );
    }
    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      clone[key] = cloneOwnedValue(
        captureProperty(value, key, `${path}.${key}`, columnId),
        `${path}.${key}`,
        seen,
        columnId,
      );
    }
    return Object.freeze(clone);
  } finally {
    seen.delete(value);
  }
}

function readDateTimestamp(value: Date): number | undefined {
  try {
    return Date.prototype.getTime.call(value) as number;
  } catch {
    return undefined;
  }
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
  const callbacks = new Set([
    "init",
    "accumulate",
    "merge",
    "snapshotAccumulator",
    "finalize",
  ]);
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
  clone.snapshotAccumulator = aggregator.snapshotAccumulator;
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

const EMPTY_FILTERS = Object.freeze([]) as readonly RuntimeFilter[];
const EMPTY_SORT = Object.freeze([]) as RuntimeQuery["sort"];

/**
 * The query the plan APPLIES, as opposed to the one it reports. Filters are
 * sorted into a canonical order so plan identity survives a reordered filter
 * list — and dropped outright under external filter authority, which is the
 * single point where "the caller already selected these records" takes effect.
 *
 * Sort is the same idea one axis over: dropped under external sort authority,
 * which is where "the caller already ranked these records" takes effect. Note
 * that only `query.sort` goes — `rowGroups` keeps its own ordering, because
 * grouping is not in `PretableProcessingOptions` and a consumer who declared
 * external sort authority said nothing about it.
 */
function canonicalRuntimeQuery(
  query: RuntimeQuery,
  filterAuthority: CompiledFilterAuthority,
  sortAuthority: CompiledSortAuthority,
): RuntimeQuery {
  return Object.freeze({
    filters:
      filterAuthority === "external"
        ? EMPTY_FILTERS
        : Object.freeze([...query.filters].sort(compareFilterDescriptors)),
    sort: sortAuthority === "external" ? EMPTY_SORT : query.sort,
    rowGroups: query.rowGroups,
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
  if (value instanceof Date) return `date:${String(readDateTimestamp(value))}`;
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
  if (value instanceof Date) {
    const timestamp = readDateTimestamp(value);
    return timestamp === undefined ? Number.NaN : utcDayOf(timestamp);
  }
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

type FilterPredicate = (value: unknown) => boolean;

const alwaysTrue: FilterPredicate = () => true;
const alwaysFalse: FilterPredicate = () => false;

function isNumberCell(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value);
}

function textCell(value: unknown): string {
  return String(value ?? "").toLocaleLowerCase();
}

function compileNumberPredicate(
  operator: string,
  operand: unknown,
): FilterPredicate {
  if (operator === "between") {
    const range = operand as readonly unknown[];
    const a = range[0];
    const b = range[1];
    if (typeof a !== "number" || typeof b !== "number") return alwaysFalse;
    const lower = Math.min(a, b);
    const upper = Math.max(a, b);
    return (value) => isNumberCell(value) && value >= lower && value <= upper;
  }
  if (typeof operand !== "number" || Number.isNaN(operand)) return alwaysFalse;
  switch (operator) {
    case "equals":
      return (value) => isNumberCell(value) && value === operand;
    case "notEquals":
      return (value) => isNumberCell(value) && value !== operand;
    case "gt":
      return (value) => isNumberCell(value) && value > operand;
    case "gte":
      return (value) => isNumberCell(value) && value >= operand;
    case "lt":
      return (value) => isNumberCell(value) && value < operand;
    default:
      return (value) => isNumberCell(value) && value <= operand;
  }
}

function compileDatePredicate(
  operator: string,
  operand: unknown,
): FilterPredicate {
  if (operator === "dateBetween") {
    const range = operand as readonly unknown[];
    const a = toDayMs(range[0]);
    const b = toDayMs(range[1]);
    if (Number.isNaN(a) || Number.isNaN(b)) return alwaysFalse;
    const lower = Math.min(a, b);
    const upper = Math.max(a, b);
    return (value) => {
      const cell = toDayMs(value);
      return cell >= lower && cell <= upper;
    };
  }
  const other = toDayMs(operand);
  if (Number.isNaN(other)) return alwaysFalse;
  // A NaN cell (unparsable date) fails every comparison below on its own —
  // no explicit guard needed to preserve the "bad cell never passes" rule.
  if (operator === "on") return (value) => toDayMs(value) === other;
  if (operator === "before") return (value) => toDayMs(value) < other;
  return (value) => toDayMs(value) > other;
}

function compileSelectionPredicate(
  operator: string,
  operand: unknown,
  coerce: (value: unknown) => unknown,
): FilterPredicate {
  const entries = operand as readonly unknown[];
  // An empty selection matches EVERYTHING, regardless of direction.
  if (entries.length === 0) return alwaysTrue;
  const included = new Set(entries.map((entry) => coerce(entry)));
  return operator === "isAnyOf"
    ? (value) => included.has(coerce(value))
    : (value) => !included.has(coerce(value));
}

function compileTextPredicate(
  operator: string,
  operand: unknown,
): FilterPredicate {
  const search = String(operand).toLocaleLowerCase();
  switch (operator) {
    case "contains":
      return (value) => textCell(value).includes(search);
    case "notContains":
      return (value) => !textCell(value).includes(search);
    case "equals":
      return (value) => textCell(value) === search;
    case "notEquals":
      return (value) => textCell(value) !== search;
    case "startsWith":
      return (value) => textCell(value).startsWith(search);
    default:
      return (value) => textCell(value).endsWith(search);
  }
}

/**
 * The ONE home of filter-predicate semantics: resolves a validated runtime
 * filter's column type + operator into a monomorphic `(value) => boolean`
 * closure with operand normalization hoisted out of the row loop (between
 * bounds destructured and min/maxed once, date operands collapsed to UTC
 * day-ms once, text needles lowercased once, selection operands coerced into
 * a Set once). Called once per filter at plan construction; filters reaching
 * a plan have passed `validateFilter`, so the defensive `alwaysFalse` arms
 * for malformed operands are unreachable there and exist only to preserve the
 * legacy per-row semantics for direct callers. Predicates only ever read the
 * CELL value — a throwing accessor throws at the value source
 * (`#readColumnValue`), never here.
 */
export function compileFilterPredicate(
  filter: {
    readonly columnId: string;
    readonly operator: string;
    readonly value?: unknown;
  },
  column: { readonly type: string },
): (value: unknown) => boolean {
  if (filter.operator === "isEmpty") return isEmptyValue;
  if (filter.operator === "isNotEmpty") return (value) => !isEmptyValue(value);
  const operand = filter.value;
  switch (column.type) {
    case "number":
      return compileNumberPredicate(filter.operator, operand);
    case "date":
      return compileDatePredicate(filter.operator, operand);
    case "enum":
      return compileSelectionPredicate(filter.operator, operand, String);
    case "boolean":
      return compileSelectionPredicate(filter.operator, operand, booleanValue);
    default:
      return compileTextPredicate(filter.operator, operand);
  }
}

/**
 * The columnar store's cell REPRESENTATION, per column type: the
 * scan-oriented normal form the bulk sweep fills once per (row, column) so
 * its predicates compare directly, with the per-row `String(...)
 * .toLocaleLowerCase()` / `toDayMs` work hoisted out of every later commit.
 *
 * - text → the exact comparison string the raw path derives per row
 *   (`textCell`): `String(value ?? "").toLocaleLowerCase()`.
 * - date → the UTC calendar-day ms (`toDayMs`); unparsable/empty both
 *   normalize to `NaN`, which fails every comparison — exactly the raw
 *   semantics, where `toDayMs` ran per row.
 * - enum → `String(value)` (the selection-predicate coercion).
 * - boolean → `booleanValue(value)`.
 * - number → identity (the raw predicates are already monomorphic guards).
 *
 * `isEmpty`/`isNotEmpty` are deliberately NOT servable from these forms:
 * emptiness is a property of the RAW value (`isEmptyValue` — e.g. a raw
 * `NaN` in a text column is empty but normalizes to the non-empty string
 * "nan", and a date cell cannot distinguish empty from garbage once both
 * are `NaN`). Those operators stay on the raw accessor path; see
 * `compileFilterPredicateForNormalized`.
 */
export function normalizeCellForScan(type: string, value: unknown): unknown {
  switch (type) {
    case "text":
      return textCell(value);
    case "date":
      return toDayMs(value);
    case "enum":
      return String(value);
    case "boolean":
      return booleanValue(value);
    default:
      return value;
  }
}

function compileNormalizedDatePredicate(
  operator: string,
  operand: unknown,
): FilterPredicate {
  if (operator === "dateBetween") {
    const range = operand as readonly unknown[];
    const a = toDayMs(range[0]);
    const b = toDayMs(range[1]);
    if (Number.isNaN(a) || Number.isNaN(b)) return alwaysFalse;
    const lower = Math.min(a, b);
    const upper = Math.max(a, b);
    return (cell) => (cell as number) >= lower && (cell as number) <= upper;
  }
  const other = toDayMs(operand);
  if (Number.isNaN(other)) return alwaysFalse;
  // A NaN cell (empty or unparsable raw) fails every comparison — same
  // "bad cell never passes" rule as the raw path, one `toDayMs` earlier.
  if (operator === "on") return (cell) => (cell as number) === other;
  if (operator === "before") return (cell) => (cell as number) < other;
  return (cell) => (cell as number) > other;
}

function compileNormalizedTextPredicate(
  operator: string,
  operand: unknown,
): FilterPredicate {
  const search = String(operand).toLocaleLowerCase();
  switch (operator) {
    case "contains":
      return (cell) => (cell as string).includes(search);
    case "notContains":
      return (cell) => !(cell as string).includes(search);
    case "equals":
      return (cell) => cell === search;
    case "notEquals":
      return (cell) => cell !== search;
    case "startsWith":
      return (cell) => (cell as string).startsWith(search);
    default:
      return (cell) => (cell as string).endsWith(search);
  }
}

function compileNormalizedSelectionPredicate(
  operator: string,
  operand: unknown,
  coerce: (value: unknown) => unknown,
): FilterPredicate {
  const entries = operand as readonly unknown[];
  if (entries.length === 0) return alwaysTrue;
  const included = new Set(entries.map((entry) => coerce(entry)));
  // The cell is already `coerce`d at fill, so membership is a direct `has`.
  return operator === "isAnyOf"
    ? (cell) => included.has(cell)
    : (cell) => !included.has(cell);
}

/**
 * `compileFilterPredicate`'s twin for the bulk sweep: compiles a closure
 * over the column type's `normalizeCellForScan` representation, whose body
 * skips exactly the per-cell normalization the fill already performed. For
 * every raw value V, `normalizedPredicate(normalizeCellForScan(type, V))`
 * ≡ `rawPredicate(V)` — semantics never fork; only where the normalization
 * runs moves.
 *
 * Returns `undefined` for `isEmpty`/`isNotEmpty`: emptiness is computed on
 * the RAW value and the normalized forms do not preserve it (see
 * `normalizeCellForScan`), so the sweep keeps those filters on live
 * accessor reads via the RAW predicate.
 */
export function compileFilterPredicateForNormalized(
  filter: {
    readonly columnId: string;
    readonly operator: string;
    readonly value?: unknown;
  },
  column: { readonly type: string },
): ((cell: unknown) => boolean) | undefined {
  if (filter.operator === "isEmpty" || filter.operator === "isNotEmpty") {
    return undefined;
  }
  const operand = filter.value;
  switch (column.type) {
    case "number":
      // Number cells are stored raw; the raw predicate IS the normalized one.
      return compileNumberPredicate(filter.operator, operand);
    case "date":
      return compileNormalizedDatePredicate(filter.operator, operand);
    case "enum":
      return compileNormalizedSelectionPredicate(
        filter.operator,
        operand,
        String,
      );
    case "boolean":
      return compileNormalizedSelectionPredicate(
        filter.operator,
        operand,
        booleanValue,
      );
    default:
      return compileNormalizedTextPredicate(filter.operator, operand);
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
    const customResult: unknown = column.compare(left as never, right as never);
    if (typeof customResult !== "number" || Number.isNaN(customResult)) {
      throw new TypeError(
        "Custom comparators must return a number other than NaN.",
      );
    }
    result = customResult;
  } else if (
    column.type === "number" &&
    typeof left === "number" &&
    typeof right === "number"
  ) {
    result = left === right ? 0 : left < right ? -1 : 1;
  } else {
    result = collator.compare(String(left), String(right));
  }
  return ordering.direction === "desc" ? -result : result;
}

class CompiledQueryPlan<TColumns>
  implements CompiledQuery<TColumns>, InternalCompiledQuery
{
  readonly activeColumnIds: readonly ColumnIdOf<TColumns>[];
  readonly #publicColumns: readonly RuntimeColumn[];
  readonly #publicQuery: RuntimeQuery;
  readonly #runtimeColumns: readonly RuntimeColumn[];
  readonly #runtimeQuery: RuntimeQuery;
  readonly #byId: ReadonlyMap<string, RuntimeColumn>;
  // Parallel to `#runtimeQuery.filters`: one compiled predicate per filter,
  // built once at construction so no verdict ever re-normalizes operands or
  // re-resolves columns per row.
  readonly #compiledPredicates: readonly FilterPredicate[];
  // Parallel to `#runtimeQuery.filters`: the bulk sweep's normalized-cell
  // twins (`compileFilterPredicateForNormalized`), plus each filter column's
  // fill-time normalizer. `undefined` = isEmpty/isNotEmpty — the sweep keeps
  // that filter on live accessor reads through the RAW predicate.
  readonly #normalizedPredicates: readonly (FilterPredicate | undefined)[];
  readonly #cellNormalizers: readonly ((value: unknown) => unknown)[];
  readonly #active: readonly RuntimeColumn[];
  readonly #aggregateColumns: readonly RuntimeColumn[];
  readonly #operation: "set-query" | "set-derivations";
  readonly #filterAuthority: CompiledFilterAuthority;
  readonly #sortAuthority: CompiledSortAuthority;
  // Not `readonly`: `adoptEvaluationCache` repoints it at a previous plan's
  // state (by reference — no copy, no per-row work) on a filter-only change.
  #sharedEvaluationState: SharedEvaluationState = {
    cache: new WeakMap<object, CachedEvaluation>(),
    columnar: new Map<string, MutableColumnarVector>(),
  };

  /*
   * The recompile cache compares against the PUBLIC query, not the runtime
   * one: under external authority the runtime query has no filters at all, so
   * comparing it would declare every filtered query a mismatch and rebuild on
   * every `setQuery`. Authority joins the comparison in its own right — it is
   * a render-time read on the React surface, never a memo dependency, so a
   * consumer really can flip it while a plan is alive, and reusing that plan
   * would leave suppression latched at whatever it was on the first compile.
   */
  readonly [internals] = {
    semanticallyMatches: (
      derivations: readonly RuntimeColumn[],
      query: RuntimeQuery,
      filterAuthority: CompiledFilterAuthority,
      sortAuthority: CompiledSortAuthority,
    ) =>
      this.#filterAuthority === filterAuthority &&
      this.#sortAuthority === sortAuthority &&
      derivationsEqualForPlan(
        this.#runtimeColumns,
        derivations,
        this.#runtimeQuery,
      ) &&
      queryEqual(this.#publicQuery, query),
  };

  get derivations(): PretableDerivationsFor<TColumns> {
    return snapshotColumns(
      this.#publicColumns,
      "derivations",
    ) as unknown as PretableDerivationsFor<TColumns>;
  }

  get query(): PretableQueryFor<TColumns> {
    return snapshotQuery(
      this.#publicQuery,
      "query",
    ) as unknown as PretableQueryFor<TColumns>;
  }

  constructor(
    capturedColumns: readonly RuntimeColumn[],
    capturedQuery: RuntimeQuery,
    operation: "set-query" | "set-derivations",
    filterAuthority: CompiledFilterAuthority,
    sortAuthority: CompiledSortAuthority,
  ) {
    this.#publicColumns = capturedColumns;
    this.#publicQuery = capturedQuery;
    this.#runtimeColumns = capturedColumns;
    this.#filterAuthority = filterAuthority;
    this.#sortAuthority = sortAuthority;
    this.#runtimeQuery = canonicalRuntimeQuery(
      capturedQuery,
      filterAuthority,
      sortAuthority,
    );
    this.#operation = operation;
    this.#byId = new Map(
      this.#runtimeColumns.map((column) => [column.id, column]),
    );
    this.#compiledPredicates = this.#runtimeQuery.filters.map((filter) =>
      compileFilterPredicate(filter, this.#byId.get(filter.columnId)!),
    );
    this.#normalizedPredicates = this.#runtimeQuery.filters.map((filter) =>
      compileFilterPredicateForNormalized(
        filter,
        this.#byId.get(filter.columnId)!,
      ),
    );
    this.#cellNormalizers = this.#runtimeQuery.filters.map((filter) => {
      const type = this.#byId.get(filter.columnId)!.type;
      return (value: unknown) => normalizeCellForScan(type, value);
    });
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
    const cached = this.#sharedEvaluationState.cache.get(input.row);
    if (
      cached &&
      cached.metadata !== undefined &&
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
      values.set(
        column.id,
        this.#readColumnValue(column, input.row, input.rowId),
      );
    }

    const filterPasses = this.#filterVerdict((columnId) =>
      values.get(columnId),
    );
    const groupPath = Object.freeze(
      this.#runtimeQuery.rowGroups.map((entry) =>
        Object.freeze({
          columnId: entry.columnId,
          value: values.get(entry.columnId),
        }),
      ),
    ) as readonly CompiledGroupKey<TColumns>[];
    return this.#finalizeMetadata({
      rowId: input.rowId,
      row: input.row,
      sourceOrder: input.sourceOrder,
      filterPasses,
      groupPath,
      valueOf: (columnId) => values.get(columnId),
    });
  }

  /*
   * Tail of `evaluate`: writes the row's sort keys to the plan's store,
   * builds the dependency, aggregate leaves, and the frozen metadata from a
   * per-column value source, then seeds the evaluation cache. `valueOf` must
   * cover every sorted and aggregated column of THIS plan.
   *
   * `filterPasses` reaches the cache entry and nothing else: the metadata it
   * builds carries no verdict, because a verdict lives in the structure the
   * row lands in, not on the row.
   */
  #finalizeMetadata<TRowId extends PretableRowId>(input: {
    readonly rowId: TRowId;
    readonly row: RowForColumns<TColumns>;
    readonly sourceOrder: number;
    readonly filterPasses: boolean;
    readonly groupPath: readonly CompiledGroupKey<TColumns>[];
    readonly valueOf: (columnId: string) => unknown;
  }): CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns> {
    const sortKeys = Object.freeze(
      this.#runtimeQuery.sort.map((entry) =>
        Object.freeze({
          columnId: entry.columnId,
          value: input.valueOf(entry.columnId),
        }),
      ),
    ) as readonly CompiledSortKey<TColumns>[];
    const dependency = Object.freeze({
      sourceOrder: input.sourceOrder,
      sortKeys,
    });
    const aggregateLeaves = Object.freeze(
      this.#aggregateColumns.map((column) =>
        Object.freeze({
          columnId: column.id,
          aggregate: column.aggregate,
          allLeaf: Object.freeze({
            id: input.rowId,
            row: input.row,
            value: input.valueOf(column.id),
            dependency,
          }),
        }),
      ),
    ) as unknown as readonly CompiledAggregateLeaf<TColumns, TRowId>[];
    const metadata = Object.freeze({
      rowId: input.rowId,
      row: input.row,
      sourceOrder: input.sourceOrder,
      groupPath: input.groupPath,
      aggregateLeaves,
    }) as CompiledRowMetadata<RowForColumns<TColumns>, TRowId, TColumns>;
    const existing = this.#sharedEvaluationState.cache.get(input.row);
    if (existing === undefined) {
      this.#sharedEvaluationState.cache.set(input.row, {
        rowId: input.rowId,
        sourceOrder: input.sourceOrder,
        metadata,
        filterPasses: input.filterPasses,
        verdictPlan: this,
        sortKeys,
      });
    } else {
      // Upgrade a keys-only entry (or refresh a stale full one) in place —
      // no second WeakMap.set, so no second rehash risk.
      existing.rowId = input.rowId;
      existing.sourceOrder = input.sourceOrder;
      existing.metadata = metadata;
      existing.filterPasses = input.filterPasses;
      existing.verdictPlan = this;
      existing.sortKeys = sortKeys;
    }
    return metadata;
  }

  /*
   * The one accessor-read site: every column value this plan reads for
   * evaluation flows through here so the accessor-failed error shape cannot
   * fork between `evaluate` and the verdict-only path.
   */
  #readColumnValue(
    column: RuntimeColumn,
    row: object,
    rowId: PretableRowId,
  ): unknown {
    try {
      return column.accessor(row as never);
    } catch (cause) {
      throw new PretableRowModelError(
        "accessor-failed",
        `Column ${column.id} accessor failed.`,
        {
          operation: this.#operation,
          rowId,
          columnId: column.id,
          cause,
        },
      );
    }
  }

  /*
   * The one filter-predicate loop, parameterized over the value source the
   * same way `#finalizeMetadata` is: `evaluate` supplies its collected value
   * map, the verdict-only path supplies live accessor reads. Predicate
   * semantics live in `compileFilterPredicate`, applied here through the
   * construction-time `#compiledPredicates` array (parallel to
   * `#runtimeQuery.filters`) — no `#byId` lookup and no operand
   * re-normalization per row.
   */
  #filterVerdict(valueOf: (columnId: string) => unknown): boolean {
    const filters = this.#runtimeQuery.filters;
    return this.#compiledPredicates.every((predicate, index) =>
      predicate(valueOf(filters[index].columnId)),
    );
  }

  /**
   * This plan's filter verdict for one row — accessor reads over the runtime
   * filter columns only, no metadata construction, no cache writes. Error
   * semantics match `evaluate`: a throwing accessor surfaces the same
   * accessor-failed shape.
   *
   * A row this plan has already evaluated answers from the evaluation cache
   * under `evaluate`'s own guard, so `evaluate` + this call costs ONE
   * accessor pass, not two (the pinned per-row work budgets are exact). The
   * memo is exactly as fresh as the metadata `evaluate` would hand back for
   * the same input, and never answers for a DIFFERENT plan — old verdicts
   * come from root membership, not from here. The `verdictPlan` arm is what
   * makes that last clause true once a cache is SHARED: an adopted entry's
   * memo belongs to the plan that wrote it, so this plan re-reads accessors
   * rather than repeating a verdict its own filters never produced.
   */
  static filterVerdict<TColumns, TRowId extends PretableRowId>(
    plan: unknown,
    input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  ): boolean {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Filter verdicts require a compiled query plan.");
    }
    const compiled = plan as CompiledQueryPlan<TColumns>;
    const cached = compiled.#sharedEvaluationState.cache.get(input.row);
    if (
      cached !== undefined &&
      cached.metadata !== undefined &&
      cached.filterPasses !== undefined &&
      cached.verdictPlan === compiled &&
      Object.is(cached.rowId, input.rowId) &&
      cached.sourceOrder === input.sourceOrder
    ) {
      return cached.filterPasses;
    }
    return compiled.#filterVerdict((columnId) =>
      compiled.#readColumnValue(
        compiled.#byId.get(columnId)!,
        input.row,
        input.rowId,
      ),
    );
  }

  /**
   * The bulk filter scan, ONE call per rebuild (Amendment J §5, revised):
   * walks every record in `records` (hole-skipping slot order), computes the
   * plan's verdict for each from the columnar store, and hands
   * (record, passes) to `onVerdict`. Everything hoistable is hoisted out of
   * the row loop — the plan resolution and `instanceof` guard, the filter
   * columns, the raw and normalized predicate arrays, the fill-time
   * normalizers, and each filter's column vector (created up front, so the
   * loop never consults the columnar Map).
   *
   * Per (row, filter), in filter order, short-circuiting on the first
   * `false` EXACTLY like `#filterVerdict`'s `.every`:
   *
   * - Normalized-capable filter (every operator except isEmpty/isNotEmpty):
   *   read the cell — via the assert-free `columnarGetCellTrusted`, because
   *   the walk's slots are nonnegative integers by construction (chunk
   *   index × chunk size + offset), so the `-1`-placeholder guard would
   *   re-check per cell what the walk already proves. On a HOLE, read the
   *   live accessor (through `#readColumnValue`, so a throwing accessor
   *   surfaces the exact accessor-failed shape the per-row path surfaces),
   *   normalize it (`normalizeCellForScan`), and write the NORMALIZED value
   *   through — this sweep is the store's ONLY writer. Then apply the
   *   filter's normalized predicate to the cell.
   * - isEmpty/isNotEmpty: live accessor read + the RAW predicate, every
   *   time — emptiness is a raw-value property the normalized cell forms do
   *   not preserve (see `normalizeCellForScan`), so these (rare) filters
   *   trade the cache for exact `isEmptyValue` semantics.
   *
   * The short-circuit means a failing row can leave LATER filters' cells
   * unfilled — deliberate and harmless: holes refill lazily on whichever
   * future sweep actually needs them, the same bargain the per-row path
   * strikes (see `filter-fast-path.test.ts`'s lazy-divergence note).
   *
   * No evaluation-cache memo is consulted or written: the cells ARE the
   * memo here, and they are value-level, so no `verdictPlan`-style tag is
   * needed — a filter-only adopter's own accessors + normalizers would
   * produce the same cells (normalization depends only on the column TYPE,
   * which `derivationsEqualForPlan` pins).
   */
  static bulkFilterVerdictSweep<TColumns, TRowId extends PretableRowId>(
    plan: unknown,
    records: SlotVector<CompiledRowInput<RowForColumns<TColumns>, TRowId>>,
    onVerdict: (
      record: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
      passes: boolean,
    ) => void,
    instrumentation?: ColumnarScanInstrumentation,
  ): void {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Bulk verdict sweeps require a compiled query plan.");
    }
    const compiled = plan as CompiledQueryPlan<TColumns>;
    const filters = compiled.#runtimeQuery.filters;
    const count = filters.length;
    const rawPredicates = compiled.#compiledPredicates;
    const normalizedPredicates = compiled.#normalizedPredicates;
    const normalizers = compiled.#cellNormalizers;
    const { columnar } = compiled.#sharedEvaluationState;
    const columns: RuntimeColumn[] = new Array(count);
    const vectors: (MutableColumnarVector | undefined)[] = new Array(count);
    for (let index = 0; index < count; index += 1) {
      columns[index] = compiled.#byId.get(filters[index].columnId)!;
      if (normalizedPredicates[index] === undefined) continue;
      let vector = columnar.get(filters[index].columnId);
      if (vector === undefined) {
        vector = createColumnarVector();
        columnar.set(filters[index].columnId, vector);
      }
      vectors[index] = vector;
    }
    let fills = 0;
    forEachSlotEntry(records, (record, slot) => {
      let passes = true;
      for (let index = 0; index < count; index += 1) {
        const vector = vectors[index];
        let verdict: boolean;
        if (vector === undefined) {
          verdict = rawPredicates[index](
            compiled.#readColumnValue(columns[index], record.row, record.rowId),
          );
        } else {
          let cell = columnarGetCellTrusted(vector, slot);
          if (cell === COLUMNAR_HOLE) {
            cell = normalizers[index](
              compiled.#readColumnValue(
                columns[index],
                record.row,
                record.rowId,
              ),
            );
            columnarSetCell(vector, slot, cell);
            fills += 1;
          }
          verdict = normalizedPredicates[index]!(cell);
        }
        if (!verdict) {
          passes = false;
          break;
        }
      }
      onVerdict(record, passes);
    });
    if (instrumentation !== undefined) {
      instrumentation.work.columnarCellFills += fills;
    }
  }

  /*
   * The single comparison loop behind `compareRecordRows`: per-ordering
   * `compareValues` over store-resolved keys, then the `sourceOrder`
   * tiebreak. Kept separate from key resolution so both sides resolve
   * before any comparison runs.
   */
  #compareBySortKeys(
    left: { readonly rowId: PretableRowId; readonly sourceOrder: number },
    leftKeys: readonly CompiledSortKey<TColumns>[],
    right: { readonly rowId: PretableRowId; readonly sourceOrder: number },
    rightKeys: readonly CompiledSortKey<TColumns>[],
  ): number {
    for (let index = 0; index < this.#runtimeQuery.sort.length; index += 1) {
      const ordering = this.#runtimeQuery.sort[index];
      const column = this.#byId.get(ordering.columnId)!;
      try {
        const result = compareValues(
          leftKeys[index]?.value,
          rightKeys[index]?.value,
          column,
          ordering,
        );
        if (result !== 0) return result;
      } catch (cause) {
        throw new CompiledQueryComparatorError(
          "A compiled row comparator failed.",
          [left.rowId, right.rowId],
          { columnId: ordering.columnId, cause, operation: this.#operation },
        );
      }
    }
    return left.sourceOrder - right.sourceOrder;
  }

  #resolveSortKeys(input: {
    readonly rowId: PretableRowId;
    readonly row: object;
  }): readonly CompiledSortKey<TColumns>[] {
    const keys = this.#sharedEvaluationState.cache.get(input.row)?.sortKeys as
      readonly CompiledSortKey<TColumns>[] | undefined;
    if (keys === undefined) {
      throw new Error(
        `Row ${String(input.rowId)} has no sort keys under this plan.`,
      );
    }
    return keys;
  }

  /**
   * Orders two evaluated rows by the plan's own sort-key store. A missing
   * store entry is a defect — the fill points (`evaluate` and
   * `fillSortKeysFromPrevious`) are exhaustive — so resolution throws rather
   * than lazily re-running accessors.
   */
  static compareRecordRows<TColumns, TRowId extends PretableRowId>(
    plan: unknown,
    left: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
    right: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  ): number {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Record comparison requires a compiled query plan.");
    }
    const compiled = plan as CompiledQueryPlan<TColumns>;
    return compiled.#compareBySortKeys(
      left,
      compiled.#resolveSortKeys(left),
      right,
      compiled.#resolveSortKeys(right),
    );
  }

  /**
   * Orders two rows by keys the CALLER already resolved — no store lookups.
   * Exists so O(n log n) sorts resolve keys once per row (decorate) instead
   * of once per comparison; `compareRecordRows` remains the general entry.
   * The comparison semantics are the same shared loop.
   */
  static compareWithSortKeys<TColumns, TRowId extends PretableRowId>(
    plan: unknown,
    left: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
    leftKeys: readonly CompiledSortKey<TColumns>[],
    right: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
    rightKeys: readonly CompiledSortKey<TColumns>[],
  ): number {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Key comparison requires a compiled query plan.");
    }
    return (plan as CompiledQueryPlan<TColumns>).#compareBySortKeys(
      left,
      leftKeys,
      right,
      rightKeys,
    );
  }

  /**
   * Resolves one evaluated row's keys from the plan's own store. Same
   * fail-loud contract as `compareRecordRows`: a missing entry is a defect.
   */
  static sortKeysOf<TColumns, TRowId extends PretableRowId>(
    plan: unknown,
    input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  ): readonly CompiledSortKey<TColumns>[] {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError(
        "Sort-key resolution requires a compiled query plan.",
      );
    }
    return (plan as CompiledQueryPlan<TColumns>).#resolveSortKeys(input);
  }

  /**
   * Fills `nextPlan`'s store for one row from `previousPlan`'s: values carry
   * by columnId where the sort columns overlap, accessors run only for
   * newly-active sort columns. Precondition (caller-owned): the plan change
   * preserves every carried sort column's accessor semantics, so carried
   * values are the ones the next plan's accessors would produce — both
   * `isSortOnlyChange` and `isFilterOnlyChange` qualify. When instrumentation is
   * supplied, one counter is bumped per (row, sort column) entry — carry vs
   * accessor — and an already-filled row counts nothing.
   */
  static fillSortKeysFromPrevious<TColumns, TRowId extends PretableRowId>(
    nextPlan: unknown,
    previousPlan: unknown,
    input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
    instrumentation?: SortKeyFillInstrumentation,
  ): readonly CompiledSortKey<TColumns>[] {
    if (
      !(nextPlan instanceof CompiledQueryPlan) ||
      !(previousPlan instanceof CompiledQueryPlan)
    ) {
      throw new TypeError("Sort-key carryover requires compiled query plans.");
    }
    const next = nextPlan as CompiledQueryPlan<TColumns>;
    const previous = previousPlan as CompiledQueryPlan<TColumns>;
    const existing = next.#sharedEvaluationState.cache.get(input.row);
    if (existing !== undefined) {
      return existing.sortKeys as readonly CompiledSortKey<TColumns>[];
    }

    const carried = previous.#sharedEvaluationState.cache.get(input.row)
      ?.sortKeys as readonly CompiledSortKey<TColumns>[] | undefined;
    const sortKeys = Object.freeze(
      next.#runtimeQuery.sort.map((entry) => {
        const previousKey = carried?.find(
          (key) => key.columnId === entry.columnId,
        );
        if (previousKey !== undefined) {
          if (instrumentation !== undefined)
            instrumentation.work.sortKeyCarries += 1;
          return Object.freeze({
            columnId: entry.columnId,
            value: previousKey.value,
          });
        }
        let value: unknown;
        try {
          value = next.#byId.get(entry.columnId)!.accessor(input.row as never);
        } catch (cause) {
          throw new PretableRowModelError(
            "accessor-failed",
            `Column ${entry.columnId} accessor failed.`,
            {
              operation: next.#operation,
              rowId: input.rowId,
              columnId: entry.columnId,
              cause,
            },
          );
        }
        if (instrumentation !== undefined)
          instrumentation.work.sortKeyEvaluations += 1;
        return Object.freeze({ columnId: entry.columnId, value });
      }),
    ) as readonly CompiledSortKey<TColumns>[];
    // Keys-only entry: `metadata` stays absent, so a later `evaluate` for
    // this row misses the metadata guard and upgrades the entry in place.
    next.#sharedEvaluationState.cache.set(input.row, {
      rowId: input.rowId,
      sourceOrder: input.sourceOrder,
      metadata: undefined,
      filterPasses: undefined,
      verdictPlan: undefined,
      sortKeys,
    });
    return sortKeys;
  }

  /**
   * Points `nextPlan`'s shared evaluation state — the per-row evaluation
   * cache AND the columnar filter-value store, wrapped in one object — at
   * `previousPlan`'s: one reference assignment for the whole store, no copy
   * and no per-row work. Replaces the per-row `fillSortKeysFromPrevious`
   * walk on the filter fast path.
   *
   * Precondition (CALLER-OWNED, exactly like `fillSortKeysFromPrevious`):
   * `isFilterOnlyChange(previousPlan, nextPlan)`. Only the plan-shape check
   * is enforced here; passing a plan pair the classifier would reject
   * silently corrupts `nextPlan`'s reads, so callers assert first.
   *
   * Why every cached field survives, field by field — this is the safety
   * proof, and a filter-only delta is what each line spends:
   *
   * - `rowId` / `sourceOrder`: guard fields, not derived state. They record
   *   the input the entry was written for, and both `evaluate` and
   *   `filterVerdict` re-check them against the live input, so a drift
   *   demotes to a miss under either plan.
   * - `row`: the WeakMap KEY. Adoption cannot change which row an entry
   *   describes.
   * - `metadata.rowId` / `.row` / `.sourceOrder`: copies of the guarded
   *   input, so they are correct under any plan that hits the guard.
   * - `metadata.groupPath`: one entry per `rowGroups` ordering, valued by
   *   that column's accessor. `isFilterOnlyChange` requires
   *   `!groupsChanged` (identical orderings) and `!derivationsChanged`,
   *   which compares the accessor IDENTITY of every grouped column in BOTH
   *   plans' queries. Same orderings + same accessors + same row object ⇒
   *   the same path. (In practice the fast path also refuses grouped
   *   queries outright.)
   * - `metadata.aggregateLeaves`: one entry per column with an `aggregate`,
   *   carrying the aggregate spec, the row, the accessor value, and a
   *   `dependency`. `derivationsEqualForPlan` compares column id, type and
   *   ORDER positionally, requires `semanticValueEqual` on every
   *   `aggregate`, and forces accessor identity for every aggregated
   *   column — so the leaf set, its order, its specs and its values are all
   *   identical.
   * - the leaves' `dependency` (`{ sourceOrder, sortKeys }`): guarded
   *   `sourceOrder` plus the keys below.
   * - `sortKeys` (on the entry and inside the dependency): one value per
   *   `sort` ordering. `isFilterOnlyChange` requires `!sortChanged`, and
   *   `derivationsEqualForPlan` pins both the accessor and the comparator of
   *   every sorted column. Identical orderings over identical accessors ⇒
   *   value-identical keys, which is precisely why the per-row fill this
   *   replaces reported 100% carries and zero evaluations.
   * - `filterPasses`: the ONE filter-dependent field, and the reason
   *   `verdictPlan` exists. The memo is only read when `verdictPlan` is the
   *   reading plan, so an adopted entry's verdict is invisible to the
   *   adopter and it runs its own filters instead. Nothing stale leaks; the
   *   adopter pays exactly the accessor pass it paid before this change.
   *
   * Sharing is symmetric-safe: the previous plan keeps reading the same map,
   * and anything the next plan writes into it is either value-identical
   * under the argument above or tagged with the writer (`verdictPlan`).
   *
   * The columnar store rides along under the same precondition: its cells
   * are scan-NORMALIZED accessor values per (column, slot), and a
   * filter-only change preserves every accessor's semantics AND every
   * column's type (`!derivationsChanged` compares both), so every present
   * cell is exactly what the adopting plan's own accessors + normalizers
   * would produce. Filters are what changed, but no verdict is stored there
   * — only values — so nothing filter-dependent transfers. See
   * `SharedEvaluationState` and `./mutable-columnar` for the store's own
   * invariants.
   */
  static adoptEvaluationCache(nextPlan: unknown, previousPlan: unknown): void {
    if (
      !(nextPlan instanceof CompiledQueryPlan) ||
      !(previousPlan instanceof CompiledQueryPlan)
    ) {
      throw new TypeError(
        "Evaluation-cache adoption requires compiled query plans.",
      );
    }
    nextPlan.#sharedEvaluationState = previousPlan.#sharedEvaluationState;
  }

  /**
   * Reads one columnar cell: the memoized SCAN-NORMALIZED accessor value
   * (`normalizeCellForScan` of what the accessor returned — NOT the raw
   * value) for (`columnId`, `slot`), or the `COLUMNAR_HOLE` miss signal
   * when no sweep has filled it (column vector absent, or cell
   * cleared/never written). A hole is an instruction to read the live
   * accessor — and, on the bulk sweep, to normalize and fill the cell.
   */
  static columnarCellFor(
    plan: unknown,
    columnId: string,
    slot: number,
  ): unknown | ColumnarHole {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Columnar reads require a compiled query plan.");
    }
    const vector = plan.#sharedEvaluationState.columnar.get(columnId);
    return vector === undefined ? COLUMNAR_HOLE : columnarGetCell(vector, slot);
  }

  /**
   * The bulk sweep's write-through: fills (`columnId`, `slot`) with the
   * SCAN-NORMALIZED value (`normalizeCellForScan` of the accessor read from
   * the committed record bound to `slot` — never the raw value), creating
   * the column's vector on demand. The sweep is the ONLY caller allowed to
   * write cells (Amendment J §3 revised) — commits clear, never write.
   */
  static fillColumnarCell(
    plan: unknown,
    columnId: string,
    slot: number,
    value: unknown,
  ): void {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Columnar fills require a compiled query plan.");
    }
    const { columnar } = plan.#sharedEvaluationState;
    let vector = columnar.get(columnId);
    if (vector === undefined) {
      vector = createColumnarVector();
      columnar.set(columnId, vector);
    }
    columnarSetCell(vector, slot, value);
  }

  /**
   * The commit-side clear: for every slot a committed transaction rebound
   * or released, clear that slot's cell in EVERY column vector present, so
   * the next scan re-reads the slot's (new or absent) row. k-sized per
   * commit. Clearing a slot no vector holds is a no-op, so callers pass
   * their touched-slot set unconditionally.
   */
  static clearColumnarSlots(plan: unknown, slots: Iterable<number>): void {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Columnar clears require a compiled query plan.");
    }
    const { columnar } = plan.#sharedEvaluationState;
    if (columnar.size === 0) return;
    for (const slot of slots) {
      for (const vector of columnar.values()) columnarClearCell(vector, slot);
    }
  }

  /**
   * Wholesale reset: drops every column vector. The set-rows clear —
   * set-rows keeps the SAME plan while replacing arbitrarily many rows, so
   * a k-sized clear cannot bound the staleness; set-rows is O(n) anyway,
   * and the next scan simply refills.
   */
  static resetColumnarStore(plan: unknown): void {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Columnar resets require a compiled query plan.");
    }
    plan.#sharedEvaluationState.columnar.clear();
  }

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
        {
          columnId: ordering.columnId,
          cause,
          groupValues: [left.value, right.value],
          operation: this.#operation,
        },
      );
    }
  }

  /**
   * Facet delta between two plans this module compiled. `undefined` means
   * "treat as everything changed" — a foreign object cannot be inspected, so
   * it never qualifies as a narrow change. Facets are compared on the RUNTIME
   * query, not the public one: under external sort authority the runtime
   * sort is `[]` on both sides, so a public-only sort change classifies as
   * `sortChanged: false` here, same as a true no-op.
   */
  static classifyDelta(
    previous: unknown,
    next: unknown,
  ):
    | Readonly<{
        derivationsChanged: boolean;
        filtersChanged: boolean;
        groupsChanged: boolean;
        sortChanged: boolean;
        authorityChanged: boolean;
      }>
    | undefined {
    if (
      !(previous instanceof CompiledQueryPlan) ||
      !(next instanceof CompiledQueryPlan)
    )
      return undefined;

    // Both directions are required: a column active under only ONE side's
    // query (e.g. sorted in `next` but not in `previous`) would escape a
    // single-sided comparison, narrowing the conservatism guarantee.
    const derivationsChanged = !(
      derivationsEqualForPlan(
        previous.#runtimeColumns,
        next.#runtimeColumns,
        previous.#runtimeQuery,
      ) &&
      derivationsEqualForPlan(
        previous.#runtimeColumns,
        next.#runtimeColumns,
        next.#runtimeQuery,
      )
    );
    const filtersChanged = !filtersEqual(
      previous.#runtimeQuery.filters,
      next.#runtimeQuery.filters,
    );
    const groupsChanged = !orderingEqual(
      previous.#runtimeQuery.rowGroups,
      next.#runtimeQuery.rowGroups,
    );
    const sortChanged = !orderingEqual(
      previous.#runtimeQuery.sort,
      next.#runtimeQuery.sort,
    );
    const authorityChanged =
      previous.#filterAuthority !== next.#filterAuthority ||
      previous.#sortAuthority !== next.#sortAuthority;

    return Object.freeze({
      derivationsChanged,
      filtersChanged,
      groupsChanged,
      sortChanged,
      authorityChanged,
    });
  }
}

/**
 * Facet delta between two compiled plans. `undefined` means either argument
 * was not a plan this module compiled, and callers must treat that as
 * "everything changed."
 */
export type CompiledQueryDelta = NonNullable<
  ReturnType<typeof CompiledQueryPlan.classifyDelta>
>;

export function classifyQueryDelta<TColumns>(
  previous: CompiledQuery<TColumns>,
  next: CompiledQuery<TColumns>,
): CompiledQueryDelta | undefined {
  return CompiledQueryPlan.classifyDelta(previous, next);
}

/**
 * True only when the applied sort is the sole difference between the plans.
 */
export function isSortOnlyChange<TColumns>(
  previous: CompiledQuery<TColumns>,
  next: CompiledQuery<TColumns>,
): boolean {
  const delta = classifyQueryDelta(previous, next);
  return (
    delta !== undefined &&
    delta.sortChanged &&
    !delta.derivationsChanged &&
    !delta.filtersChanged &&
    !delta.groupsChanged &&
    !delta.authorityChanged
  );
}

/**
 * True only when the applied filters are the sole difference between the
 * plans.
 */
export function isFilterOnlyChange<TColumns>(
  previous: CompiledQuery<TColumns>,
  next: CompiledQuery<TColumns>,
): boolean {
  const delta = classifyQueryDelta(previous, next);
  return (
    delta !== undefined &&
    delta.filtersChanged &&
    !delta.derivationsChanged &&
    !delta.groupsChanged &&
    !delta.sortChanged &&
    !delta.authorityChanged
  );
}

/**
 * Orders two evaluated row records under `plan` via the plan's own sort-key
 * store. Both rows must already be in the store (`evaluate` or
 * `fillSortKeysFromPrevious`); a missing entry throws — it is a defect, not a
 * lazy-fill opportunity.
 */
export function compareRecordRows<TColumns, TRowId extends PretableRowId>(
  plan: CompiledQuery<TColumns>,
  left: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  right: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
): number {
  return CompiledQueryPlan.compareRecordRows<TColumns, TRowId>(
    plan,
    left,
    right,
  );
}

/**
 * Orders two rows by keys the caller already resolved (via `sortKeysOf` or
 * `fillSortKeysFromPrevious`) — no store lookups. Exists so O(n log n) sorts
 * resolve keys once per row instead of once per comparison;
 * `compareRecordRows` remains the general entry with identical semantics.
 */
export function compareWithSortKeys<TColumns, TRowId extends PretableRowId>(
  plan: CompiledQuery<TColumns>,
  left: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  leftKeys: readonly CompiledSortKey<TColumns>[],
  right: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  rightKeys: readonly CompiledSortKey<TColumns>[],
): number {
  return CompiledQueryPlan.compareWithSortKeys<TColumns, TRowId>(
    plan,
    left,
    leftKeys,
    right,
    rightKeys,
  );
}

/**
 * Resolves one evaluated row's sort keys from `plan`'s own store. Both the
 * shape and the fail-loud contract match `compareRecordRows`: the row must
 * already be in the store, and a missing entry throws.
 */
export function sortKeysOf<TColumns, TRowId extends PretableRowId>(
  plan: CompiledQuery<TColumns>,
  input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
): readonly CompiledSortKey<TColumns>[] {
  return CompiledQueryPlan.sortKeysOf<TColumns, TRowId>(plan, input);
}

/**
 * Fills `nextPlan`'s sort-key store for one row, carrying values from
 * `previousPlan`'s store where the sort columns overlap and running accessors
 * only for newly-active sort columns. Idempotent per row. Valid ONLY under a
 * plan change that preserves every carried sort column's accessor semantics
 * (`isSortOnlyChange` and `isFilterOnlyChange` both qualify) — the caller
 * owns that check.
 */
export function fillSortKeysFromPrevious<
  TColumns,
  TRowId extends PretableRowId,
>(
  nextPlan: CompiledQuery<TColumns>,
  previousPlan: CompiledQuery<TColumns>,
  input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  instrumentation?: SortKeyFillInstrumentation,
): readonly CompiledSortKey<TColumns>[] {
  return CompiledQueryPlan.fillSortKeysFromPrevious<TColumns, TRowId>(
    nextPlan,
    previousPlan,
    input,
    instrumentation,
  );
}

/**
 * Points `nextPlan` at `previousPlan`'s whole evaluation cache — sort keys
 * AND metadata — by reference. One assignment replaces a per-row fill, which
 * is why the filter fast path uses it instead of walking every row.
 *
 * Valid ONLY when `isFilterOnlyChange(previousPlan, nextPlan)` holds; the
 * caller owns that check. The field-by-field argument for why every cached
 * field survives such a change lives on
 * `CompiledQueryPlan.adoptEvaluationCache`.
 */
export function adoptEvaluationCache<TColumns>(
  nextPlan: CompiledQuery<TColumns>,
  previousPlan: CompiledQuery<TColumns>,
): void {
  CompiledQueryPlan.adoptEvaluationCache(nextPlan, previousPlan);
}

/**
 * Reads one columnar filter-value cell for (`columnId`, `slot`) from
 * `plan`'s shared evaluation state: the memoized SCAN-NORMALIZED accessor
 * value (`normalizeCellForScan` — NOT the raw value), or the
 * `COLUMNAR_HOLE` miss signal (import it from `./mutable-columnar`) when no
 * sweep has filled the cell. A hole means "read the live accessor"; a
 * present cell is guaranteed fresh by the commit-side clears.
 */
export function columnarCellFor<TColumns>(
  plan: CompiledQuery<TColumns>,
  columnId: string,
  slot: number,
): unknown | ColumnarHole {
  return CompiledQueryPlan.columnarCellFor(plan, columnId, slot);
}

/**
 * The bulk sweep's write-through fill for one columnar cell. The sweep is
 * the store's ONLY writer (Amendment J §3 revised): it must pass the
 * SCAN-NORMALIZED value (`normalizeCellForScan`) of the accessor read it
 * just performed on the committed record currently bound to `slot`.
 */
export function fillColumnarCell<TColumns>(
  plan: CompiledQuery<TColumns>,
  columnId: string,
  slot: number,
  value: unknown,
): void {
  CompiledQueryPlan.fillColumnarCell(plan, columnId, slot, value);
}

/**
 * Commit-side maintenance: clears every given slot's cell in every column
 * vector of `plan`'s shared state. Called from a committed (effective)
 * transaction with exactly the slots it rebound or released — k-sized, and
 * a no-op while no scan has filled anything.
 */
export function clearColumnarSlots<TColumns>(
  plan: CompiledQuery<TColumns>,
  slots: Iterable<number>,
): void {
  CompiledQueryPlan.clearColumnarSlots(plan, slots);
}

/**
 * Commit-side maintenance for set-rows: drops every column vector of
 * `plan`'s shared state (rows may have been arbitrarily replaced under the
 * SAME plan, so no k-sized clear bounds the staleness).
 */
export function resetColumnarStore<TColumns>(
  plan: CompiledQuery<TColumns>,
): void {
  CompiledQueryPlan.resetColumnarStore(plan);
}

/**
 * Computes `plan`'s filter verdict for one row: each runtime filter's column
 * accessor runs and its predicate is evaluated, with the same semantics and
 * accessor-failed error shape as `evaluate` — the predicate loop is shared,
 * not duplicated. No metadata is built and no cache entry is written.
 */
export function filterVerdict<TColumns, TRowId extends PretableRowId>(
  plan: CompiledQuery<TColumns>,
  input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
): boolean {
  return CompiledQueryPlan.filterVerdict<TColumns, TRowId>(plan, input);
}

/**
 * Computes `plan`'s filter verdict for EVERY record in `records` in one
 * call, from the columnar store: normalized cells when present, HOLE falls
 * back to the live accessor and writes the normalized value through (the
 * store's only writer), and isEmpty/isNotEmpty filters stay on live
 * accessor reads. Same per-filter semantics, filter order,
 * `every`-short-circuit, and accessor-failed error shape as
 * `filterVerdict`; `onVerdict` receives each record with its verdict, in
 * the slot vector's hole-skipping walk order. The filter rebuild is the
 * intended caller — k-sized and grouped paths keep `filterVerdict`.
 */
export function bulkFilterVerdictSweep<TColumns, TRowId extends PretableRowId>(
  plan: CompiledQuery<TColumns>,
  records: SlotVector<CompiledRowInput<RowForColumns<TColumns>, TRowId>>,
  onVerdict: (
    record: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
    passes: boolean,
  ) => void,
  instrumentation?: ColumnarScanInstrumentation,
): void {
  CompiledQueryPlan.bulkFilterVerdictSweep<TColumns, TRowId>(
    plan,
    records,
    onVerdict,
    instrumentation,
  );
}

export function compileQuery<const TColumns>(
  input: CompileQueryInput<TColumns>,
): CompiledQuery<TColumns> {
  const captured = captureCompileInput(input as object);
  validateDerivations(captured.columns);
  validateQuery(captured.query, captured.columns);

  const previous = captured.previous as
    (CompiledQuery<TColumns> & Partial<InternalCompiledQuery>) | undefined;
  if (
    previous?.[internals]?.semanticallyMatches(
      captured.columns,
      captured.query,
      captured.filterAuthority,
      captured.sortAuthority,
    )
  )
    return previous;

  return new CompiledQueryPlan(
    captured.columns,
    captured.query,
    input.operation ?? "set-query",
    captured.filterAuthority,
    captured.sortAuthority,
  );
}
