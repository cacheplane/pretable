import type { PretableRowId } from "./column-types";
import {
  runCooperativeTransitionSlice,
  type CooperativeTransitionRuntime,
} from "./cooperative-transition";
import {
  PretableDisposedModelError,
  PretableRowModelError,
  type PretableRowModelOperation,
} from "./errors";
import type { RevisionRoot, RowRecord } from "./internal-types";
import {
  createOrderStatisticTree,
  type OrderStatisticTree,
} from "./persistent/order-statistic-tree";
import {
  createPersistentMap,
  type PersistentMap,
} from "./persistent/persistent-map";
import type {
  PretableDistinctValueOptions,
  PretableDistinctValueQuery,
  PretableDistinctValueResult,
} from "./types";

const DEFAULT_RESULT_LIMIT = 100;
const MAX_RESULT_LIMIT = 1_000;
const DEFAULT_CACHE_CAPACITY = 8;

type DistinctPopulation = "all" | "filtered";
type BlankOrder = "first" | "last";

interface CapturedQueryOptions {
  readonly search: string | undefined;
  readonly start: number;
  readonly limit: number;
  readonly population: DistinctPopulation;
  readonly includeBlanks: boolean;
  readonly blankOrder: BlankOrder;
}

interface RuntimeColumn<TRow extends object> {
  readonly id: string;
  readonly type: string;
  readonly accessor: (row: TRow) => unknown;
  readonly compare?: (left: unknown, right: unknown) => number;
}

interface ValueDescription {
  readonly id: string;
  readonly blank: boolean;
  readonly blankRank: number;
}

interface ValueEntry {
  readonly id: string;
  readonly value: unknown;
  readonly count: number;
  readonly blank: boolean;
  readonly blankRank: number;
}

type ValueTree = OrderStatisticTree<string, ValueEntry, number>;

interface DictionaryState<TRowId extends PretableRowId> {
  readonly values: ValueTree;
  readonly rowValues: PersistentMap<TRowId, string>;
}

interface DictionaryDelta<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly target: RevisionRoot<TRow, TRowId, TColumns>;
  readonly affectedRowIds: readonly TRowId[];
}

interface DictionaryCandidate<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly processedRows: number;
  readonly deltaCount: number;
  readonly released: boolean;
  append(delta: DictionaryDelta<TRow, TRowId, TColumns>): void;
  step(): boolean;
  finish(): DictionaryState<TRowId>;
  release(): void;
}

type WaiterStatus = "pending" | "ready" | "error" | "cancelled";

interface QueryWaiter<TValue> {
  status: WaiterStatus;
  readonly options: CapturedQueryOptions;
  readonly resolve: (value: PretableDistinctValueResult<TValue>) => void;
  readonly reject: (error: unknown) => void;
}

interface BuildingCacheEntry<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly kind: "building";
  readonly key: string;
  readonly column: RuntimeColumn<TRow>;
  readonly options: CapturedQueryOptions;
  readonly candidate: DictionaryCandidate<TRow, TRowId, TColumns>;
  readonly waiters: Set<QueryWaiter<unknown>>;
  lastUsed: number;
  cancelScheduled: (() => void) | undefined;
}

interface ReadyCacheEntry<TRow extends object, TRowId extends PretableRowId> {
  readonly kind: "ready";
  readonly key: string;
  readonly column: RuntimeColumn<TRow>;
  readonly options: CapturedQueryOptions;
  state: DictionaryState<TRowId> | undefined;
  lastUsed: number;
}

type CacheEntry<TRow extends object, TRowId extends PretableRowId, TColumns> =
  BuildingCacheEntry<TRow, TRowId, TColumns> | ReadyCacheEntry<TRow, TRowId>;

export class PretableDistinctValueCancelledError extends Error {
  readonly name = "PretableDistinctValueCancelledError";

  constructor(readonly reason: "cancelled" | "superseded" | "evicted") {
    super(`The distinct-value query was ${reason}.`);
  }
}

export interface DistinctValueManagerDiagnostics {
  readonly retainedDictionaryCount: number;
  readonly buildingDictionaryCount: number;
  readonly retainedRowValueCount: number;
  readonly retainedDistinctValueCount: number;
  readonly candidateDeltaCount: number;
  readonly capturedRootCount: number;
  readonly rowsEvaluated: number;
  readonly releasedCandidateCount: number;
  readonly disposed: boolean;
}

const modelManagers = new WeakMap<
  object,
  { readonly diagnostics: () => DistinctValueManagerDiagnostics }
>();

/** Direct internal test seam; intentionally not exported from the barrel. */
export function getDistinctValueDiagnosticsForTesting(
  model: object,
): DistinctValueManagerDiagnostics {
  const manager = modelManagers.get(model);
  if (manager === undefined) {
    throw new TypeError("Diagnostics require a local Pretable row model.");
  }
  return manager.diagnostics();
}

const identityIds = new WeakMap<object, number>();
let nextIdentityId = 1;

function identityId(value: object | undefined): number {
  if (value === undefined) return 0;
  const existing = identityIds.get(value);
  if (existing !== undefined) return existing;
  const id = nextIdentityId++;
  identityIds.set(value, id);
  return id;
}

function captureQueryOptions(
  options: PretableDistinctValueOptions | undefined,
): CapturedQueryOptions {
  if (
    options !== undefined &&
    (options === null || typeof options !== "object")
  ) {
    throw new TypeError("Distinct-value options must be an object.");
  }
  const search = options?.search;
  const start = options?.start ?? 0;
  const limit = options?.limit ?? DEFAULT_RESULT_LIMIT;
  const population = options?.population ?? "all";
  const includeBlanks = options?.includeBlanks ?? false;
  const blankOrder = options?.blankOrder ?? "last";
  if (search !== undefined && typeof search !== "string") {
    throw new TypeError("Distinct-value search must be a string.");
  }
  if (!Number.isSafeInteger(start) || start < 0) {
    throw new RangeError(
      "Distinct-value start must be a non-negative safe integer.",
    );
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_RESULT_LIMIT) {
    throw new RangeError(
      `Distinct-value limit must be a positive safe integer no greater than ${MAX_RESULT_LIMIT}.`,
    );
  }
  if (population !== "all" && population !== "filtered") {
    throw new TypeError(
      'Distinct-value population must be "all" or "filtered".',
    );
  }
  if (typeof includeBlanks !== "boolean") {
    throw new TypeError("Distinct-value includeBlanks must be boolean.");
  }
  if (blankOrder !== "first" && blankOrder !== "last") {
    throw new TypeError('Distinct-value blankOrder must be "first" or "last".');
  }
  return Object.freeze({
    search,
    start,
    limit,
    population,
    includeBlanks,
    blankOrder,
  });
}

function dateTimestamp(value: object): number | undefined {
  try {
    return Date.prototype.getTime.call(value) as number;
  } catch {
    return undefined;
  }
}

function describeValue(value: unknown): ValueDescription {
  if (value === null) {
    return { id: "null", blank: true, blankRank: 0 };
  }
  if (value === undefined) {
    return { id: "undefined", blank: true, blankRank: 1 };
  }
  if (typeof value === "string") {
    return {
      id: `string:${value.length}:${value}`,
      blank: value.trim() === "",
      blankRank: 3,
    };
  }
  if (typeof value === "number") {
    if (Number.isNaN(value)) {
      return { id: "number:nan", blank: true, blankRank: 2 };
    }
    return {
      id: `number:${Object.is(value, -0) ? "0" : String(value)}`,
      blank: false,
      blankRank: 0,
    };
  }
  if (typeof value === "bigint") {
    return { id: `bigint:${String(value)}`, blank: false, blankRank: 0 };
  }
  if (typeof value === "boolean") {
    return { id: `boolean:${value ? "1" : "0"}`, blank: false, blankRank: 0 };
  }
  if (typeof value === "object") {
    const timestamp = dateTimestamp(value);
    if (timestamp !== undefined) {
      return {
        id: `date:${Number.isNaN(timestamp) ? "nan" : String(timestamp)}`,
        blank: Number.isNaN(timestamp),
        blankRank: 4,
      };
    }
  }
  throw new TypeError(
    "Distinct values must be strings, numbers, bigints, booleans, Dates, null, or undefined.",
  );
}

function snapshotDistinctValue(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    const timestamp = dateTimestamp(value);
    if (timestamp !== undefined) return new Date(timestamp);
  }
  return value;
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function defaultCompare(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof left === "bigint" && typeof right === "bigint") {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return left === right ? 0 : left ? 1 : -1;
  }
  if (
    typeof left === "object" &&
    left !== null &&
    typeof right === "object" &&
    right !== null
  ) {
    const leftTime = dateTimestamp(left);
    const rightTime = dateTimestamp(right);
    if (leftTime !== undefined && rightTime !== undefined) {
      return leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1;
    }
  }
  return collator.compare(String(left), String(right));
}

function createValueTree<TRow extends object>(
  column: RuntimeColumn<TRow>,
  options: CapturedQueryOptions,
): ValueTree {
  return createOrderStatisticTree<string, ValueEntry, number>({
    getId: (entry) => entry.id,
    compare: (left, right) => {
      if (left.blank || right.blank) {
        if (left.blank && right.blank) {
          if (left.blankRank !== right.blankRank) {
            return left.blankRank - right.blankRank;
          }
          return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        }
        const blankResult = options.blankOrder === "first" ? -1 : 1;
        return left.blank ? blankResult : -blankResult;
      }
      const compared = column.compare
        ? column.compare(left.value, right.value)
        : defaultCompare(left.value, right.value);
      if (typeof compared !== "number" || Number.isNaN(compared)) {
        throw new TypeError(
          "Custom distinct-value comparators must return a number other than NaN.",
        );
      }
      return compared < 0 ? -1 : compared > 0 ? 1 : 0;
    },
    measure: {
      empty: 0,
      fromEntry: () => 1,
      combine: (left, right) => left + right,
    },
  });
}

function semanticValueKey(value: unknown): string {
  if (Array.isArray(value)) {
    return `array:[${value.map(semanticValueKey).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const timestamp = dateTimestamp(value);
    if (timestamp !== undefined) return `date:${String(timestamp)}`;
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `object:{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${semanticValueKey(
            (value as Record<string, unknown>)[key],
          )}`,
      )
      .join(",")}}`;
  }
  if (typeof value === "number" && Object.is(value, -0)) return "number:-0";
  return `${typeof value}:${String(value)}`;
}

function filterSemanticKey<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(root: RevisionRoot<TRow, TRowId, TColumns>): string {
  const derivations = root.queryPlan
    .derivations as unknown as readonly RuntimeColumn<TRow>[];
  const byId = new Map(derivations.map((column) => [column.id, column]));
  return [...root.queryPlan.query.filters]
    .map((filter) => {
      const runtime = filter as {
        readonly columnId: string;
        readonly operator: string;
        readonly value?: unknown;
      };
      return `${runtime.columnId}:${identityId(
        byId.get(runtime.columnId)?.accessor,
      )}:${runtime.operator}:${semanticValueKey(runtime.value)}`;
    })
    .sort()
    .join("|");
}

function columnForDerivations<TRow extends object>(
  derivations: readonly unknown[],
  columnId: string,
): RuntimeColumn<TRow> {
  const column = (derivations as readonly RuntimeColumn<TRow>[]).find(
    (candidate) => candidate.id === columnId,
  );
  if (column === undefined) {
    throw new PretableRowModelError(
      "derivation-failed",
      `Unknown distinct-value column ${columnId}.`,
      { operation: "distinct-values", columnId },
    );
  }
  return column;
}

function cacheKey<TRow extends object, TRowId extends PretableRowId, TColumns>(
  root: RevisionRoot<TRow, TRowId, TColumns>,
  column: RuntimeColumn<TRow>,
  options: CapturedQueryOptions,
): string {
  const filterKey =
    options.population === "filtered" ? filterSemanticKey(root) : "";
  return [
    column.id,
    options.population,
    identityId(column.accessor),
    identityId(column.compare),
    options.includeBlanks ? 1 : 0,
    options.blankOrder,
    filterKey,
  ].join("\u0000");
}

function callbackError(
  code: "accessor-failed" | "comparator-failed",
  operation: PretableRowModelOperation,
  columnId: string,
  rowId: PretableRowId | undefined,
  cause: unknown,
): PretableRowModelError {
  return new PretableRowModelError(
    code,
    `Distinct-value ${code === "accessor-failed" ? "accessor" : "comparator"} failed for column ${columnId}.`,
    { operation, columnId, rowId, cause },
  );
}

function readValue<TRow extends object, TRowId extends PretableRowId, TColumns>(
  record: RowRecord<TRow, TRowId, TColumns>,
  column: RuntimeColumn<TRow>,
  options: CapturedQueryOptions,
  operation: PretableRowModelOperation,
):
  | { readonly description: ValueDescription; readonly value: unknown }
  | undefined {
  if (options.population === "filtered" && !record.metadata.filterPasses) {
    return undefined;
  }
  let value: unknown;
  try {
    value = column.accessor(record.row);
  } catch (cause) {
    throw callbackError(
      "accessor-failed",
      operation,
      column.id,
      record.rowId,
      cause,
    );
  }
  let description: ValueDescription;
  try {
    description = describeValue(value);
  } catch (cause) {
    throw callbackError(
      "accessor-failed",
      operation,
      column.id,
      record.rowId,
      cause,
    );
  }
  if (description.blank && !options.includeBlanks) return undefined;
  return { description, value };
}

function removeValue<TRowId extends PretableRowId>(
  state: DictionaryState<TRowId>,
  rowId: TRowId,
): DictionaryState<TRowId> {
  const valueId = state.rowValues.get(rowId);
  if (valueId === undefined && !state.rowValues.has(rowId)) return state;
  const previous = state.values.get(valueId!);
  if (previous === undefined) {
    return { values: state.values, rowValues: state.rowValues.delete(rowId) };
  }
  const values =
    previous.count === 1
      ? state.values.remove(previous.id)
      : state.values.insertOrReplace(
          Object.freeze({ ...previous, count: previous.count - 1 }),
        );
  return { values, rowValues: state.rowValues.delete(rowId) };
}

function insertValue<TRowId extends PretableRowId>(
  state: DictionaryState<TRowId>,
  rowId: TRowId,
  selected: { readonly description: ValueDescription; readonly value: unknown },
): DictionaryState<TRowId> {
  const previous = state.values.get(selected.description.id);
  const entry = Object.freeze({
    id: selected.description.id,
    value: previous?.value ?? snapshotDistinctValue(selected.value),
    count: (previous?.count ?? 0) + 1,
    blank: selected.description.blank,
    blankRank: selected.description.blankRank,
  });
  return {
    values: state.values.insertOrReplace(entry),
    rowValues: state.rowValues.set(rowId, entry.id),
  };
}

function replayRecord<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  state: DictionaryState<TRowId>,
  target: RevisionRoot<TRow, TRowId, TColumns>,
  rowId: TRowId,
  column: RuntimeColumn<TRow>,
  options: CapturedQueryOptions,
  operation: PretableRowModelOperation,
): DictionaryState<TRowId> {
  let next: DictionaryState<TRowId>;
  try {
    next = removeValue(state, rowId);
  } catch (cause) {
    if (cause instanceof PretableRowModelError) throw cause;
    throw callbackError(
      "comparator-failed",
      operation,
      column.id,
      rowId,
      cause,
    );
  }
  const record = target.rows.get(rowId);
  if (record === undefined) return next;
  const selected = readValue(record, column, options, operation);
  if (selected === undefined) return next;
  try {
    next = insertValue(next, rowId, selected);
  } catch (cause) {
    if (cause instanceof PretableRowModelError) throw cause;
    throw callbackError(
      "comparator-failed",
      operation,
      column.id,
      rowId,
      cause,
    );
  }
  return next;
}

function createDictionaryCandidate<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(input: {
  readonly captured: RevisionRoot<TRow, TRowId, TColumns>;
  readonly column: RuntimeColumn<TRow>;
  readonly options: CapturedQueryOptions;
}): DictionaryCandidate<TRow, TRowId, TColumns> {
  const column = input.column;
  const queryOptions = input.options;
  let retained:
    | {
        captured: RevisionRoot<TRow, TRowId, TColumns>;
        iterator: Iterator<Readonly<{ readonly rowId: TRowId }>> | null;
        state: DictionaryState<TRowId>;
        deltas: Array<DictionaryDelta<TRow, TRowId, TColumns> | null>;
      }
    | undefined = {
    captured: input.captured,
    iterator: input.captured.sourceOrder.entries(),
    state: {
      values: createValueTree(column, queryOptions),
      rowValues: createPersistentMap<TRowId, string>(),
    },
    deltas: [],
  };
  // Candidate methods retain only the nullable state and immutable callback
  // configuration. Clear the input container so release truly drops the
  // captured row root rather than keeping it through the parameter closure.
  input = undefined as never;
  let deltaIndex = 0;
  let deltaRowIndex = 0;
  let processedRows = 0;
  let released = false;

  return {
    get processedRows() {
      return processedRows;
    },
    get deltaCount() {
      return (
        retained?.deltas.reduce(
          (count, delta) => count + (delta === null ? 0 : 1),
          0,
        ) ?? 0
      );
    },
    get released() {
      return released;
    },
    append(delta) {
      retained?.deltas.push(delta);
    },
    step() {
      const state = retained;
      if (state === undefined) return true;
      if (state.iterator !== null) {
        const next = state.iterator.next();
        if (!next.done) {
          state.state = replayRecord(
            state.state,
            state.captured,
            next.value.rowId,
            column,
            queryOptions,
            "distinct-values",
          );
          processedRows += 1;
          return false;
        }
        state.iterator = null;
      }
      if (deltaIndex < state.deltas.length) {
        const delta = state.deltas[deltaIndex];
        if (delta === null) {
          deltaIndex += 1;
          deltaRowIndex = 0;
          return false;
        }
        const rowId = delta.affectedRowIds[deltaRowIndex];
        if (rowId !== undefined) {
          state.state = replayRecord(
            state.state,
            delta.target,
            rowId,
            column,
            queryOptions,
            "distinct-values",
          );
          deltaRowIndex += 1;
          processedRows += 1;
          return false;
        }
        state.deltas[deltaIndex] = null;
        deltaIndex += 1;
        deltaRowIndex = 0;
        return false;
      }
      return true;
    },
    finish() {
      if (retained === undefined)
        throw new Error("Released dictionary candidate.");
      return retained.state;
    },
    release() {
      if (retained === undefined) return;
      retained.iterator = null;
      retained.deltas.fill(null);
      retained.deltas.length = 0;
      retained = undefined;
      released = true;
    },
  };
}

function projectResult<TValue, TRowId extends PretableRowId>(
  state: DictionaryState<TRowId>,
  options: CapturedQueryOptions,
  revision: number,
): PretableDistinctValueResult<TValue> {
  const search = options.search?.toLocaleLowerCase();
  const values: { readonly value: TValue; readonly count: number }[] = [];
  let matchingCount = 0;
  for (const entry of state.values.entries()) {
    if (
      search !== undefined &&
      !String(entry.value).toLocaleLowerCase().includes(search)
    ) {
      continue;
    }
    if (matchingCount >= options.start && values.length < options.limit) {
      values.push(
        Object.freeze({
          value: snapshotDistinctValue(entry.value) as TValue,
          count: entry.count,
        }),
      );
    }
    matchingCount += 1;
  }
  return Object.freeze({
    values: Object.freeze(values),
    totalDistinct: matchingCount,
    population: options.population,
    rowModelRevision: revision,
  });
}

export interface PreparedDistinctValueCommit<TRowId extends PretableRowId> {
  readonly updates: readonly {
    readonly entry: ReadyCacheEntry<object, TRowId>;
    readonly state: DictionaryState<TRowId>;
  }[];
}

export interface DistinctValueManager<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  query<TValue>(
    columnId: string,
    options: PretableDistinctValueOptions | undefined,
  ): PretableDistinctValueQuery<TValue>;
  prepareCommit(
    target: RevisionRoot<TRow, TRowId, TColumns>,
    affectedRowIds: readonly TRowId[],
    operation: "set-rows" | "apply-transaction",
  ): PreparedDistinctValueCommit<TRowId>;
  publishCommit(
    prepared: PreparedDistinctValueCommit<TRowId>,
    target: RevisionRoot<TRow, TRowId, TColumns>,
    affectedRowIds: readonly TRowId[],
  ): void;
  publishTransitionRoot(target: RevisionRoot<TRow, TRowId, TColumns>): void;
  dispose(error: PretableDisposedModelError): void;
  attachModel(model: object): void;
}

export function createDistinctValueManager<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(options: {
  readonly getRoot: () => RevisionRoot<TRow, TRowId, TColumns>;
  readonly getDerivations: () => readonly unknown[];
  readonly runtime: CooperativeTransitionRuntime;
  readonly cacheCapacity?: number;
}): DistinctValueManager<TRow, TRowId, TColumns> {
  const capacity = options.cacheCapacity ?? DEFAULT_CACHE_CAPACITY;
  if (!Number.isSafeInteger(capacity) || capacity <= 0) {
    throw new RangeError(
      "The distinct-value cache capacity must be a positive safe integer.",
    );
  }
  const cache = new Map<string, CacheEntry<TRow, TRowId, TColumns>>();
  let clock = 0;
  let disposed = false;
  let rowsEvaluated = 0;
  let releasedCandidateCount = 0;

  const releaseBuilding = (
    entry: BuildingCacheEntry<TRow, TRowId, TColumns>,
  ): void => {
    entry.cancelScheduled?.();
    entry.cancelScheduled = undefined;
    if (!entry.candidate.released) {
      rowsEvaluated += entry.candidate.processedRows;
      entry.candidate.release();
      releasedCandidateCount += 1;
    }
  };
  const cancelBuilding = (
    entry: BuildingCacheEntry<TRow, TRowId, TColumns>,
    reason: "superseded" | "evicted",
  ): void => {
    releaseBuilding(entry);
    for (const waiter of entry.waiters) {
      waiter.status = "cancelled";
      waiter.reject(new PretableDistinctValueCancelledError(reason));
    }
    entry.waiters.clear();
    cache.delete(entry.key);
  };
  const evictReady = (): void => {
    const ready = [...cache.values()].filter(
      (entry): entry is ReadyCacheEntry<TRow, TRowId> =>
        entry.kind === "ready" && entry.state !== undefined,
    );
    while (ready.length > capacity) {
      ready.sort((left, right) => left.lastUsed - right.lastUsed);
      const evicted = ready.shift()!;
      evicted.state = undefined;
      cache.delete(evicted.key);
    }
  };
  const resolveReady = (
    entry: BuildingCacheEntry<TRow, TRowId, TColumns>,
  ): void => {
    const dictionary = entry.candidate.finish();
    rowsEvaluated += entry.candidate.processedRows;
    entry.candidate.release();
    releasedCandidateCount += 1;
    const ready: ReadyCacheEntry<TRow, TRowId> = {
      kind: "ready",
      key: entry.key,
      column: entry.column,
      options: entry.options,
      state: dictionary,
      lastUsed: ++clock,
    };
    cache.set(entry.key, ready);
    for (const waiter of entry.waiters) {
      if (waiter.status !== "pending") continue;
      try {
        const result = projectResult(
          dictionary,
          waiter.options,
          options.getRoot().revision,
        );
        waiter.status = "ready";
        waiter.resolve(result);
      } catch (error) {
        waiter.status = "error";
        waiter.reject(error);
      }
    }
    entry.waiters.clear();
    evictReady();
  };
  const failBuilding = (
    entry: BuildingCacheEntry<TRow, TRowId, TColumns>,
    error: unknown,
  ): void => {
    releaseBuilding(entry);
    cache.delete(entry.key);
    for (const waiter of entry.waiters) {
      waiter.status = "error";
      waiter.reject(error);
    }
    entry.waiters.clear();
  };
  const runBuildSlice = (
    entry: BuildingCacheEntry<TRow, TRowId, TColumns>,
  ): void => {
    if (disposed || cache.get(entry.key) !== entry) return;
    try {
      const complete = runCooperativeTransitionSlice(options.runtime, () =>
        entry.candidate.step(),
      );
      if (disposed || cache.get(entry.key) !== entry) return;
      if (complete) {
        resolveReady(entry);
        return;
      }
      entry.cancelScheduled = options.runtime.scheduler.schedule(() => {
        entry.cancelScheduled = undefined;
        runBuildSlice(entry);
      });
    } catch (error) {
      failBuilding(entry, error);
    }
  };

  const manager: DistinctValueManager<TRow, TRowId, TColumns> = {
    query<TValue>(
      columnId: string,
      rawOptions: PretableDistinctValueOptions | undefined,
    ) {
      const captured = captureQueryOptions(rawOptions);
      const root = options.getRoot();
      const column = columnForDerivations<TRow>(
        options.getDerivations(),
        columnId,
      );
      const key = cacheKey(root, column, captured);
      const existing = cache.get(key);
      if (existing?.kind === "ready" && existing.state !== undefined) {
        existing.lastUsed = ++clock;
        let status: WaiterStatus = "ready";
        const finished = Promise.resolve(
          projectResult<TValue, TRowId>(
            existing.state,
            captured,
            root.revision,
          ),
        );
        return Object.freeze({
          get status() {
            return status;
          },
          finished,
          cancel() {
            status = "ready";
          },
        });
      }

      let resolve!: (value: PretableDistinctValueResult<TValue>) => void;
      let reject!: (error: unknown) => void;
      const finished = new Promise<PretableDistinctValueResult<TValue>>(
        (res, rej) => {
          resolve = res;
          reject = rej;
        },
      );
      void finished.catch(() => undefined);
      const waiter: QueryWaiter<TValue> = {
        status: "pending",
        options: captured,
        resolve,
        reject,
      };
      let entry: BuildingCacheEntry<TRow, TRowId, TColumns>;
      if (existing?.kind === "building") {
        entry = existing;
        entry.lastUsed = ++clock;
      } else {
        entry = {
          kind: "building",
          key,
          column,
          options: captured,
          candidate: createDictionaryCandidate({
            captured: root,
            column,
            options: captured,
          }),
          waiters: new Set(),
          lastUsed: ++clock,
          cancelScheduled: undefined,
        };
        cache.set(key, entry);
      }
      entry.waiters.add(waiter as QueryWaiter<unknown>);
      const query = Object.freeze({
        get status() {
          return waiter.status;
        },
        finished,
        cancel() {
          if (waiter.status !== "pending") return;
          waiter.status = "cancelled";
          entry.waiters.delete(waiter as QueryWaiter<unknown>);
          waiter.reject(new PretableDistinctValueCancelledError("cancelled"));
          if (entry.waiters.size === 0 && cache.get(entry.key) === entry) {
            releaseBuilding(entry);
            cache.delete(entry.key);
          }
        },
      }) as PretableDistinctValueQuery<TValue>;
      if (existing?.kind !== "building") runBuildSlice(entry);
      return query;
    },
    prepareCommit(target, affectedRowIds, operation) {
      const updates: {
        readonly entry: ReadyCacheEntry<object, TRowId>;
        readonly state: DictionaryState<TRowId>;
      }[] = [];
      for (const entry of cache.values()) {
        if (entry.kind !== "ready" || entry.state === undefined) continue;
        let state = entry.state;
        for (const rowId of affectedRowIds) {
          state = replayRecord(
            state,
            target,
            rowId,
            entry.column,
            entry.options,
            operation,
          );
        }
        updates.push({
          entry: entry as unknown as ReadyCacheEntry<object, TRowId>,
          state,
        });
      }
      return Object.freeze({ updates: Object.freeze(updates) });
    },
    publishCommit(prepared, target, affectedRowIds) {
      for (const update of prepared.updates) update.entry.state = update.state;
      const delta = Object.freeze({
        target,
        affectedRowIds: Object.freeze([...affectedRowIds]),
      });
      for (const entry of cache.values()) {
        if (entry.kind === "building") entry.candidate.append(delta);
      }
    },
    publishTransitionRoot(target) {
      for (const entry of [...cache.values()]) {
        const currentColumn = columnForDerivations<TRow>(
          options.getDerivations(),
          entry.column.id,
        );
        if (cacheKey(target, currentColumn, entry.options) === entry.key) {
          continue;
        }
        if (entry.kind === "building") cancelBuilding(entry, "superseded");
        else {
          entry.state = undefined;
          cache.delete(entry.key);
        }
      }
    },
    dispose(error) {
      if (disposed) return;
      disposed = true;
      for (const entry of cache.values()) {
        if (entry.kind === "building") {
          releaseBuilding(entry);
          for (const waiter of entry.waiters) {
            waiter.status = "cancelled";
            waiter.reject(error);
          }
          entry.waiters.clear();
        } else entry.state = undefined;
      }
      cache.clear();
    },
    attachModel(model) {
      modelManagers.set(model, {
        diagnostics: () => {
          let retainedDictionaryCount = 0;
          let buildingDictionaryCount = 0;
          let retainedRowValueCount = 0;
          let retainedDistinctValueCount = 0;
          let candidateDeltaCount = 0;
          let capturedRootCount = 0;
          for (const entry of cache.values()) {
            if (entry.kind === "ready" && entry.state !== undefined) {
              retainedDictionaryCount += 1;
              retainedRowValueCount += entry.state.rowValues.size;
              retainedDistinctValueCount += entry.state.values.size;
            } else if (entry.kind === "building") {
              buildingDictionaryCount += 1;
              candidateDeltaCount += entry.candidate.deltaCount;
              capturedRootCount += entry.candidate.released ? 0 : 1;
            }
          }
          return Object.freeze({
            retainedDictionaryCount,
            buildingDictionaryCount,
            retainedRowValueCount,
            retainedDistinctValueCount,
            candidateDeltaCount,
            rowsEvaluated:
              rowsEvaluated +
              [...cache.values()].reduce(
                (count, entry) =>
                  count +
                  (entry.kind === "building"
                    ? entry.candidate.processedRows
                    : 0),
                0,
              ),
            releasedCandidateCount,
            capturedRootCount,
            disposed,
          });
        },
      });
    },
  };
  return manager;
}
