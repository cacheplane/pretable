import type {
  ColumnDescriptorOf,
  ColumnIdOf,
  PretableDerivationsFor,
  PretableQueryFor,
  PretableRowId,
} from "./column-types";
import { PretableRowModelError } from "./errors";
import type { AggregateTreeLeaf } from "./persistent/aggregate-tree";
import {
  filterNodeListEqual,
  isPlainObject,
  orderingEqual,
  queryEqual,
  semanticValueEqual,
} from "./query-equality";

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
   * Unread today; threaded so slot-indexed storage can consume the handle
   * directly instead of re-deriving it from the row id.
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
    evaluationCacheLookups: number;
  };
}

/**
 * Structural slice consumed by `filterVerdict`'s lookup counting — the
 * verdict-only callers that thread instrumentation (the flat identity-carry
 * sweep) count their cache reads; everyone else passes nothing.
 */
export interface EvaluationCacheLookupInstrumentation {
  readonly work: {
    evaluationCacheLookups: number;
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

interface RuntimeFilterGroup {
  readonly op: "and" | "or";
  readonly children: readonly RuntimeFilterNode[];
}

type RuntimeFilterNode = RuntimeFilter | RuntimeFilterGroup;

/**
 * The internal twin of `isPretableFilterGroup`, deliberately WEAKER: the
 * public guard re-checks `op` because it runs on whatever a caller hands it,
 * whereas capture has already rejected any node carrying `children` without a
 * valid `op`. Over a captured tree the presence of `children` is therefore
 * decisive on its own. Never call this on un-captured input.
 */
function isRuntimeFilterGroup(
  node: RuntimeFilterNode,
): node is RuntimeFilterGroup {
  return "children" in node;
}

/**
 * The leaves of a filter tree, in depth-first order — the tree's COLUMN
 * DEPENDENCY set, flattened deliberately. Join operators are irrelevant here:
 * a column is read if any leaf anywhere in the tree mentions it, whatever
 * joins that leaf to its siblings. Evaluation does NOT go through this — see
 * `compileFilterNodes`.
 */
function filterLeavesOf(
  nodes: readonly RuntimeFilterNode[],
): readonly RuntimeFilter[] {
  const leaves: RuntimeFilter[] = [];
  const visit = (node: RuntimeFilterNode): void => {
    if (isRuntimeFilterGroup(node)) node.children.forEach(visit);
    else leaves.push(node);
  };
  nodes.forEach(visit);
  return leaves;
}

/*
 * A filter node compiled for evaluation: a closure answering that node's
 * question about one row. The whole tree collapses into a nest of these at
 * construction — column lookups resolved, operands normalized, joins baked
 * in — so a verdict never inspects a `RuntimeFilterNode` and never branches
 * on a node kind. A leaf and a group are the same callable to their parent,
 * which is what lets ONE evaluation path serve a grouped query and a flat
 * one without either paying for the other.
 */
type CompiledFilterMatcher = (
  valueOf: (columnId: string) => unknown,
) => boolean;

/*
 * Its own const rather than the `FilterPredicate` twin a thousand lines down:
 * the two are structurally identical and tsc would accept either, but a
 * predicate answers about a VALUE and a matcher about a ROW, and borrowing
 * one for the other is a pun a reader has to unpick.
 */
const alwaysMatches: CompiledFilterMatcher = () => true;

/**
 * Compiles a sibling list joined by `op` into a single matcher. Used for
 * groups and for the query's root list alike — the roots are an `and`, which
 * is exactly what a top-level filter list has always meant.
 *
 * The join loops are indexed rather than `every`/`some`, which is not a style
 * preference: a callback join allocates a closure per group PER ROW, on the
 * hottest loop in the package. Deliberately unquantified — two harnesses
 * measured the gap differently enough to disagree, and a figure pasted here
 * would rot where no reader could re-derive it. Measure it yourself on an
 * isolated verdict loop; a whole-model benchmark cannot resolve it.
 *
 * Both operators are written once here, so there is one implementation of
 * `and` and one of `or` whatever shape the tree has.
 */
function compileFilterNodes(
  nodes: readonly RuntimeFilterNode[],
  op: "and" | "or",
  byId: ReadonlyMap<string, RuntimeColumn>,
): CompiledFilterMatcher {
  /*
   * An EMPTY list is TRUE under BOTH joins — it constrains nothing, so it
   * removes nothing. The branch is not decoration: the `or` loop below falls
   * through to `false` on no children, which would make a half-built `or`
   * group in a builder UI blank the grid the instant a user adds it and
   * before they fill it in.
   */
  if (nodes.length === 0) return alwaysMatches;

  const matchers = nodes.map((node) => {
    if (isRuntimeFilterGroup(node))
      return compileFilterNodes(node.children, node.op, byId);
    const { columnId } = node;
    const predicate = compileFilterPredicate(node, byId.get(columnId)!);
    return (valueOf: (columnId: string) => unknown) =>
      predicate(valueOf(columnId));
  });

  if (op === "and")
    return (valueOf) => {
      for (let index = 0; index < matchers.length; index += 1)
        if (!matchers[index](valueOf)) return false;
      return true;
    };
  return (valueOf) => {
    for (let index = 0; index < matchers.length; index += 1)
      if (matchers[index](valueOf)) return true;
    return false;
  };
}

interface RuntimeOrdering {
  readonly columnId: string;
  readonly direction?: string;
  readonly nulls?: string;
}

interface RuntimeQuery {
  readonly filters: readonly RuntimeFilterNode[];
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
      (entry, index) => captureFilterNode(entry, `query.filters[${index}]`),
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

/*
 * The deepest a captured filter tree may nest, counting root nodes as depth 0.
 *
 * Capture is the chokepoint: validation, snapshotting, descriptor keys, leaf
 * collection, structural equality and per-row evaluation all recurse over a
 * tree only AFTER it has been captured, so bounding it here bounds every one
 * of them at once. Without the bound the failure mode was not merely a deep
 * tree — measured against this file's pre-bound revision, a 1000-level tree
 * CAPTURED cleanly and then overflowed the stack in `filterNodeListEqual` on
 * the next recompile, so the `RangeError` surfaced from a later `setQuery` on
 * a plan the engine had already accepted; at 2000 `compileQuery` threw a raw
 * `RangeError` instead of this module's validation error.
 *
 * 64 is chosen as far beyond any tree a human or a builder UI produces (real
 * filter trees nest a handful of levels) while sitting an order of magnitude
 * below the depth at which any of the downstream recursions is at risk.
 */
const MAX_FILTER_TREE_DEPTH = 64;

/**
 * One node of the filter tree. A node carrying `children` is a group and is
 * captured recursively, breadcrumbed as `<path>.children[i]`; anything else is
 * captured as a leaf. Every level is frozen on the way out, so the captured
 * tree is owned by the plan rather than aliasing the caller's objects.
 *
 * `depth` is the node's own nesting level and is bounded — see
 * `MAX_FILTER_TREE_DEPTH` for why the bound lives here and nowhere else.
 */
function captureFilterNode(
  raw: unknown,
  path: string,
  depth = 0,
): RuntimeFilterNode {
  if (depth > MAX_FILTER_TREE_DEPTH)
    fail(`filter group nesting exceeds ${MAX_FILTER_TREE_DEPTH} levels`, path);
  if (raw === null || typeof raw !== "object")
    fail("filter entry is not an object", path);
  const children = captureProperty(raw, "children", `${path}.children`);
  if (children === undefined) return captureFilter(raw, path);

  const op = captureProperty(raw, "op", `${path}.op`);
  if (op !== "and" && op !== "or")
    fail("filter group must join with and or or", `${path}.op`);
  return Object.freeze({
    op,
    children: captureDenseArray(
      children,
      `${path}.children`,
      "filter group children must be an array",
      (entry, index) =>
        captureFilterNode(entry, `${path}.children[${index}]`, depth + 1),
    ),
  });
}

function captureFilter(raw: object, path: string): RuntimeFilter {
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

function validateFilterNode(
  node: RuntimeFilterNode,
  columns: ReadonlyMap<string, RuntimeColumn>,
  path: string,
): void {
  if (isRuntimeFilterGroup(node)) {
    node.children.forEach((child, index) =>
      validateFilterNode(child, columns, `${path}.children[${index}]`),
    );
    return;
  }
  validateFilter(node, columns, path);
}

function validateFilter(
  filter: RuntimeFilter,
  columns: ReadonlyMap<string, RuntimeColumn>,
  path: string,
): void {
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
  query.filters.forEach((node, index) =>
    validateFilterNode(node, byId, `query.filters[${index}]`),
  );
  query.sort.forEach((entry, index) =>
    validateOrdering(entry, byId, "sort", index),
  );
  query.rowGroups.forEach((entry, index) =>
    validateOrdering(entry, byId, "rowGroups", index),
  );
}

/*
 * Nodes are matched STRUCTURALLY, never by a serialized key: the descriptor
 * key is raw concatenation over unframed user operands, so a filter value can
 * forge the separators and impersonate a sibling — harmless for the ordering
 * job the key exists for, a wrong-results bug as an identity test (the plan
 * would be reused and the incoming query silently discarded).
 *
 * Groups match when their join operators match and their children match as an
 * unordered multiset, recursively — the same used-set shape the node list one
 * level up uses, for the same reason: both joins are commutative.
 */
/*
 * `filterLeaves` is the caller's own `#filterLeaves`, passed rather than
 * re-derived: this runs on every recompile check (`semanticallyMatches`, so
 * every `setQuery`), and walking the tree here would allocate a fresh leaf
 * array per call for a set the plan already holds.
 */
function derivationsEqualForPlan(
  left: readonly RuntimeColumn[],
  right: readonly RuntimeColumn[],
  query: RuntimeQuery,
  filterLeaves: readonly RuntimeFilter[],
): boolean {
  if (left.length !== right.length) return false;
  const accessorIds = new Set<string>();
  const comparatorIds = new Set<string>();
  filterLeaves.forEach((entry) => accessorIds.add(entry.columnId));
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
  const snapshotNode = (
    node: RuntimeFilterNode,
    nodePath: string,
  ): RuntimeFilterNode =>
    isRuntimeFilterGroup(node)
      ? Object.freeze({
          op: node.op,
          children: Object.freeze(
            node.children.map((child, index) =>
              snapshotNode(child, `${nodePath}.children[${index}]`),
            ),
          ),
        })
      : Object.freeze({
          ...node,
          value: cloneOwnedValue(
            node.value,
            `${nodePath}.value`,
            new WeakSet(),
          ),
        });
  const filters = query.filters.map((node, index) =>
    snapshotNode(node, `${path}.filters[${index}]`),
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

const EMPTY_FILTERS = Object.freeze([]) as readonly RuntimeFilterNode[];
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
  left: RuntimeFilterNode,
  right: RuntimeFilterNode,
): number {
  return filterDescriptorKey(left).localeCompare(filterDescriptorKey(right));
}

function filterDescriptorKey(node: RuntimeFilterNode): string {
  if (isRuntimeFilterGroup(node)) {
    // Children are keyed then sorted for the same reason the roots are
    // sorted in `canonicalRuntimeQuery`: both joins are commutative, so a
    // reordered group is the same question and must reuse the same plan.
    return `group\u0000${node.op}\u0000[${node.children
      .map(filterDescriptorKey)
      .sort()
      .join("\u0001")}]`;
  }
  return `${node.columnId}\u0000${node.operator}\u0000${filterValueKey(node.value)}`;
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
  /*
   * The LEAVES of `#runtimeQuery.filters`, depth-first — not the filter list
   * itself, which under a tree holds groups and has a different length. This
   * is a DEPENDENCY set (which columns the filters read), never the evaluation
   * order: joins are honoured by `#compiledFilterTree`.
   */
  readonly #filterLeaves: readonly RuntimeFilter[];
  /*
   * The whole filter tree as ONE closure, built at construction so no verdict
   * re-normalizes an operand, re-resolves a column, or reads a join per row.
   *
   * Built the same way for EVERY query, grouped or flat. A flat query briefly
   * had a second, separate predicate array and loop of its own; that bought a
   * real cost (a grouped query compiled every leaf predicate twice) and the
   * standing risk of two implementations of one semantics drifting apart,
   * catchable only after the fact. It bought no speed either: the flat loop
   * it saved allocated a closure per row of its own, so the single path is
   * measurably the FASTER of the two on an isolated verdict loop.
   */
  readonly #compiledFilterTree: CompiledFilterMatcher;
  readonly #active: readonly RuntimeColumn[];
  readonly #aggregateColumns: readonly RuntimeColumn[];
  readonly #operation: "set-query" | "set-derivations";
  readonly #filterAuthority: CompiledFilterAuthority;
  readonly #sortAuthority: CompiledSortAuthority;
  // Not `readonly`: `adoptEvaluationCache` repoints it at a previous plan's
  // map (by reference — no copy, no per-row work) on a filter-only change.
  #evaluationCache = new WeakMap<object, CachedEvaluation>();

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
        this.#filterLeaves,
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
    this.#filterLeaves = filterLeavesOf(this.#runtimeQuery.filters);
    this.#compiledFilterTree = compileFilterNodes(
      this.#runtimeQuery.filters,
      "and",
      this.#byId,
    );
    const activeIds = new Set<string>();
    this.#filterLeaves.forEach((entry) => activeIds.add(entry.columnId));
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
    const existing = this.#evaluationCache.get(input.row);
    if (existing === undefined) {
      this.#evaluationCache.set(input.row, {
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
   * The ONE filter verdict, parameterized over the value source the same way
   * `#finalizeMetadata` is: `evaluate` supplies its collected value map, the
   * verdict-only path supplies live accessor reads. Predicate semantics live
   * in `compileFilterPredicate` and join semantics in `compileFilterNodes`,
   * both reached through the construction-time `#compiledFilterTree` — no
   * `#byId` lookup and no operand re-normalization per row.
   *
   * The ROOT list joins conjunctively, as it always has — a query's top-level
   * filters all have to hold. Below the roots, groups join by their own `op`.
   */
  #filterVerdict(valueOf: (columnId: string) => unknown): boolean {
    return this.#compiledFilterTree(valueOf);
  }

  /**
   * The plan's OWN captured filter tree — the objects `captureFilterNode`
   * produced, not the re-frozen copy the `query` getter hands out.
   * @internal
   */
  static capturedFilterTreeForTesting<TColumns>(
    plan: CompiledQuery<TColumns>,
  ): readonly unknown[] {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Captured filters require a compiled query plan.");
    }
    return plan.#publicQuery.filters;
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
    instrumentation?: EvaluationCacheLookupInstrumentation,
  ): boolean {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Filter verdicts require a compiled query plan.");
    }
    const compiled = plan as CompiledQueryPlan<TColumns>;
    if (instrumentation !== undefined)
      instrumentation.work.evaluationCacheLookups += 1;
    const cached = compiled.#evaluationCache.get(input.row);
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
   * Fused verdict + sort-key resolution for the ADOPTED identity-carry
   * sweep: ONE evaluation-cache read answers both questions
   * `filterVerdict` + `fillSortKeysFromPrevious` used to pay two reads for
   * (the verdict lookup discarded its entry, then the fill looked the same
   * key up again to hit its early return — one redundant get per survivor).
   *
   * Returns the row's sort keys when the row passes THIS plan's filters and
   * `undefined` when it does not; a rejected row's keys are never read, so
   * key resolution rides the verdict's single lookup for free.
   *
   * Precondition (CALLER-OWNED, exactly `adoptEvaluationCache`'s): this
   * plan's cache was adopted from the plan whose lineage evaluated
   * `input.row` — a filter-only change — so the cached `sortKeys` are the
   * ones this plan's accessors would produce (same orderings, same
   * accessors; see the adoption proof). The verdict is still recomputed
   * under this plan whenever the memo's `verdictPlan` is not this plan —
   * adopted entries always miss that guard, exactly as before the fusion.
   */
  static sortKeysIfPasses<TColumns, TRowId extends PretableRowId>(
    plan: unknown,
    input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
    instrumentation?: SortKeyFillInstrumentation,
  ): readonly CompiledSortKey<TColumns>[] | undefined {
    if (!(plan instanceof CompiledQueryPlan)) {
      throw new TypeError("Filter verdicts require a compiled query plan.");
    }
    const compiled = plan as CompiledQueryPlan<TColumns>;
    if (instrumentation !== undefined)
      instrumentation.work.evaluationCacheLookups += 1;
    const cached = compiled.#evaluationCache.get(input.row);
    const passes =
      cached !== undefined &&
      cached.metadata !== undefined &&
      cached.filterPasses !== undefined &&
      cached.verdictPlan === compiled &&
      Object.is(cached.rowId, input.rowId) &&
      cached.sourceOrder === input.sourceOrder
        ? cached.filterPasses
        : compiled.#filterVerdict((columnId) =>
            compiled.#readColumnValue(
              compiled.#byId.get(columnId)!,
              input.row,
              input.rowId,
            ),
          );
    if (!passes) return undefined;
    if (cached !== undefined) {
      // The same UNGUARDED read the carry fill's early return performs:
      // sort keys depend only on the row object and the (unchanged) sort
      // columns, so an entry from anywhere in the adopted lineage answers.
      return cached.sortKeys as readonly CompiledSortKey<TColumns>[];
    }
    // A row the adopted lineage never evaluated: resolve keys by accessor
    // and seed a keys-only entry, mirroring the carry fill's miss arm with
    // nothing to carry (`metadata` absent, so a later `evaluate` upgrades).
    const sortKeys = Object.freeze(
      compiled.#runtimeQuery.sort.map((entry) => {
        const value = compiled.#readColumnValue(
          compiled.#byId.get(entry.columnId)!,
          input.row,
          input.rowId,
        );
        if (instrumentation !== undefined)
          instrumentation.work.sortKeyEvaluations += 1;
        return Object.freeze({ columnId: entry.columnId, value });
      }),
    ) as readonly CompiledSortKey<TColumns>[];
    compiled.#evaluationCache.set(input.row, {
      rowId: input.rowId,
      sourceOrder: input.sourceOrder,
      metadata: undefined,
      filterPasses: undefined,
      verdictPlan: undefined,
      sortKeys,
    });
    return sortKeys;
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
    const keys = this.#evaluationCache.get(input.row)?.sortKeys as
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
    if (instrumentation !== undefined)
      instrumentation.work.evaluationCacheLookups += 1;
    const existing = next.#evaluationCache.get(input.row);
    if (existing !== undefined) {
      return existing.sortKeys as readonly CompiledSortKey<TColumns>[];
    }

    if (instrumentation !== undefined)
      instrumentation.work.evaluationCacheLookups += 1;
    const carried = previous.#evaluationCache.get(input.row)?.sortKeys as
      readonly CompiledSortKey<TColumns>[] | undefined;
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
    next.#evaluationCache.set(input.row, {
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
   * Points `nextPlan`'s evaluation cache at `previousPlan`'s — one reference
   * assignment for the whole store, no copy and no per-row work. Replaces the
   * per-row `fillSortKeysFromPrevious` walk on the filter fast path.
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
    nextPlan.#evaluationCache = previousPlan.#evaluationCache;
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
        previous.#filterLeaves,
      ) &&
      derivationsEqualForPlan(
        previous.#runtimeColumns,
        next.#runtimeColumns,
        next.#runtimeQuery,
        next.#filterLeaves,
      )
    );
    const filtersChanged = !filterNodeListEqual(
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
 * The plan's OWN captured filter tree — the objects `captureFilterNode`
 * produced, not the re-frozen copy the `query` getter hands out. Exists so
 * capture-level invariants (freezing, ownership) are assertable at all.
 * @internal
 */
export function getCapturedFilterTreeForTesting<TColumns>(
  plan: CompiledQuery<TColumns>,
): readonly unknown[] {
  return CompiledQueryPlan.capturedFilterTreeForTesting(plan);
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
 * Computes `plan`'s filter verdict for one row: each runtime filter's column
 * accessor runs and its predicate is evaluated, with the same semantics and
 * accessor-failed error shape as `evaluate` — the predicate loop is shared,
 * not duplicated. No metadata is built and no cache entry is written.
 */
export function filterVerdict<TColumns, TRowId extends PretableRowId>(
  plan: CompiledQuery<TColumns>,
  input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  instrumentation?: EvaluationCacheLookupInstrumentation,
): boolean {
  return CompiledQueryPlan.filterVerdict<TColumns, TRowId>(
    plan,
    input,
    instrumentation,
  );
}

/**
 * Fused verdict + sort-key resolution under an ADOPTED evaluation cache —
 * one cache read instead of `filterVerdict` + `fillSortKeysFromPrevious`'s
 * two. Returns the keys when the row passes `plan`'s filters, `undefined`
 * when it does not. Valid ONLY after `adoptEvaluationCache(plan, previous)`
 * for the plan lineage that evaluated the row (a filter-only change); see
 * `CompiledQueryPlan.sortKeysIfPasses` for the semantics proof.
 */
export function sortKeysIfPasses<TColumns, TRowId extends PretableRowId>(
  plan: CompiledQuery<TColumns>,
  input: CompiledRowInput<RowForColumns<TColumns>, TRowId>,
  instrumentation?: SortKeyFillInstrumentation,
): readonly CompiledSortKey<TColumns>[] | undefined {
  return CompiledQueryPlan.sortKeysIfPasses<TColumns, TRowId>(
    plan,
    input,
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
