import {
  compileQuery,
  fillSortKeysFromPrevious,
  isSortOnlyChange,
  type CompiledFilterAuthority,
  type CompiledQuery,
  type CompiledSortAuthority,
} from "./compiled-query";
import { rebuildRootForSortOnlyChange } from "./sort-rebuild";
import {
  createCooperativeTransitionCandidate,
  createCooperativeTransitionRuntime,
  runCooperativeTransitionSlice,
  type CooperativeTransitionCandidate,
  type CooperativeTransitionScheduler,
} from "./cooperative-transition";
import { createDistinctValueManager } from "./distinct-values";
import type { LocalRowModelInstrumentation } from "./diagnostics";
import {
  createChangeJournal,
  getChangeJournalDiagnosticsForTesting,
  type ChangeJournal,
  type ChangeJournalDiagnostics,
} from "./change-journal";
import type {
  ColumnDescriptorOf,
  PretableDerivationsFor,
  PretableQueryFor,
  PretableRowId,
} from "./column-types";
import {
  PretableDisposedModelError,
  findPretableReentrantMutationError,
  PretableReentrantMutationError,
  PretableRowModelError,
  PretableTransitionCancelledError,
  type PretableTransitionCancellationReason,
  type PretableRowModelOperation,
} from "./errors";
import type {
  ExpansionRoot,
  PretableRevisionCause,
  RevisionRoot,
  RowRecord,
} from "./internal-types";
import {
  attachGroupIndex,
  getGroupIndex,
  setGroupOverride,
} from "./group-index";
import { createPersistentMap } from "./persistent/persistent-map";
import { buildRowStore } from "./row-store";
import type {
  PretableRowIntegrityDiagnostic,
  PretableRowIntegrityDiagnosticSink,
} from "./row-integrity";
import type {
  PretableDerivationTransition,
  PretableChangeOperation,
  PretableDistinctValueQuery,
  PretableExpansionDefault,
  PretableGroupId,
  PretableMutationResult,
  PretableMutationIssue,
  PretableQueryTransition,
  PretableRowModel,
  PretableRowModelState,
  PretableTransaction,
  PretableVisibleRow,
  PretableVisibleRowRef,
} from "./types";
import { createFlatSnapshot, createVisibleIndex } from "./visible-index";
import {
  applyFlatTransactionDraft,
  replaceFlatRowsDraft,
} from "./transaction-draft";

function createSnapshot<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  root: RevisionRoot<TRow, TRowId, TColumns>,
  instrumentation: LocalRowModelInstrumentation | undefined,
): PretableRowModelState<TRow, TRowId, TColumns>["snapshot"] {
  const snapshot = createFlatSnapshot(root);
  if (instrumentation === undefined) return snapshot;
  const count = <T>(value: T | undefined): T | undefined => {
    if (value !== undefined) instrumentation.work.snapshotOutputRowsRead += 1;
    return value;
  };
  const instrumentedSnapshot = Object.freeze({
    ...snapshot,
    rowAt: (index: number) => count(snapshot.rowAt(index)),
    range: (start: number, end: number) => {
      const rows = snapshot.range(start, end);
      instrumentation.work.snapshotOutputRowsRead += rows.length;
      return rows;
    },
    dataRowAt: (index: number) => count(snapshot.dataRowAt(index)),
    firstDataRow: () => count(snapshot.firstDataRow()),
    lastDataRow: () => count(snapshot.lastDataRow()),
    nextDataRow: (ref: PretableVisibleRowRef<TRowId>) =>
      count(snapshot.nextDataRow(ref)),
    previousDataRow: (ref: PretableVisibleRowRef<TRowId>) =>
      count(snapshot.previousDataRow(ref)),
  });
  instrumentation.snapshotRoots.set(instrumentedSnapshot, root);
  instrumentation.currentRevisionRoot = root;
  return instrumentedSnapshot;
}

interface CreateLocalRowModelBaseOptions<
  TColumns,
  TRowId extends PretableRowId,
> {
  readonly rows: readonly RowForColumns<TColumns>[];
  readonly columns: TColumns;
  readonly derivations?: PretableDerivationsFor<TColumns>;
  readonly query?: PretableQueryFor<TColumns>;
  readonly initialExpansion?: PretableExpansionDefault;
  /**
   * Selects whether published group aggregate outputs use the all-row or
   * post-filter population. Both populations remain indexed; this choice is
   * fixed for the lifetime of the model and defaults to `false`.
   */
  readonly aggregateFilteredRows?: boolean;
  /**
   * Declares who selected the records handed to `rows`. `"external"` keeps
   * `query.filters` published in every reported query and stops the engine
   * re-applying them, so a window that answers a previous query survives on
   * screen while the next one loads. Defaults to `"engine"`.
   *
   * Reached from React through `processing.filter` in rows mode, and mutable
   * afterwards through {@link ɵsetLocalRowModelFilterAuthority} because
   * `processing` is a render-time prop rather than a construction argument.
   *
   * @internal
   */
  readonly ɵfilterAuthority?: CompiledFilterAuthority;
  /**
   * Who ordered the rows handed in. `"external"` keeps `query.sort` reported
   * while the engine stops re-applying it. Set at construction for the same
   * reason as {@link ɵfilterAuthority} — the initial store is built inside
   * `createLocalRowModel`, so a model created under engine authority would
   * paint one locally-sorted frame before any effect could correct it — and
   * flipped afterwards through {@link ɵsetLocalRowModelSortAuthority}.
   *
   * @internal
   */
  readonly ɵsortAuthority?: CompiledSortAuthority;
  /** Overrides the bounded consumer journal size for diagnostics and tests. */
  readonly changeJournalCapacity?: number;
  /** Internal deterministic scheduler injection for cooperative rebuilds. */
  readonly transitionScheduler?: CooperativeTransitionScheduler;
  /** Internal deterministic monotonic clock injection for cooperative rebuilds. */
  readonly transitionClock?: () => number;
  /** Maximum cooperative work-slice duration; checked after every unit. */
  readonly transitionBudgetMs?: number;
  /** Internal deterministic hard cap for work units when clocks stall. */
  readonly transitionMaxUnitsPerSlice?: number;
  /** Internal cache bound override for distinct-value tests and diagnostics. */
  readonly distinctValueCacheCapacity?: number;
  readonly onDiagnostic?: (
    diagnostic: PretableRowIntegrityDiagnostic<TRowId>,
  ) => void;
}

const modelChangeJournals = new WeakMap<object, ChangeJournal<PretableRowId>>();
const optionInstrumentation = new WeakMap<
  object,
  LocalRowModelInstrumentation
>();
const modelRevisionCauses = new WeakMap<object, () => PretableRevisionCause>();
const modelActiveTransitionCandidates = new WeakMap<
  object,
  () => object | undefined
>();
const modelFilterAuthoritySetters = new WeakMap<
  object,
  (authority: CompiledFilterAuthority) => void
>();
const modelSortAuthoritySetters = new WeakMap<
  object,
  (authority: CompiledSortAuthority) => void
>();

/**
 * Re-declares who selected the loaded records, recompiling the plan when the
 * answer changes. Deliberately a registry lookup rather than a method on
 * `PretableRowModel`: only the rows-mode React surface needs it — a consumer
 * who builds their own model already decides what goes into the query — and
 * the public model interface should not grow a knob that boundary excludes.
 *
 * Silently ignores any model this module did not create. Callers must still
 * withhold it from models they do not own — a consumer-supplied model built by
 * `createLocalRowModel` is registered here too, and moving its authority would
 * be exactly the explicit-model change this design excludes.
 *
 * @internal
 */
export function ɵsetLocalRowModelFilterAuthority(
  model: object,
  // Spelled out rather than named as `CompiledFilterAuthority`: this is the one
  // declaration that crosses into `@pretable/core`'s entry point, and naming an
  // unexported alias there is a forgotten export the public-API guard rejects.
  authority: "engine" | "external",
): void {
  modelFilterAuthoritySetters.get(model)?.(authority);
}

/**
 * Re-declares who ordered the loaded records. The sort twin of
 * `ɵsetLocalRowModelFilterAuthority`, with the same registry design and
 * the same ownership rule: withhold it from models the surface does not own.
 *
 * @internal
 */
export function ɵsetLocalRowModelSortAuthority(
  model: object,
  authority: "engine" | "external",
): void {
  modelSortAuthoritySetters.get(model)?.(authority);
}

/** Direct diagnostics seam; intentionally absent from the package barrel. */
export function registerLocalRowModelInstrumentationForTesting(
  options: object,
  instrumentation: LocalRowModelInstrumentation,
): void {
  optionInstrumentation.set(options, instrumentation);
}

export function getLocalRowModelRevisionCauseForTesting(
  model: object,
): PretableRevisionCause {
  const read = modelRevisionCauses.get(model);
  if (read === undefined) {
    throw new TypeError("Diagnostics require a local Pretable row model.");
  }
  return read();
}

export function getLocalRowModelActiveTransitionCandidateForTesting(
  model: object,
): object | undefined {
  const read = modelActiveTransitionCandidates.get(model);
  if (read === undefined) {
    throw new TypeError("Diagnostics require a local Pretable row model.");
  }
  return read();
}

export function getLocalRowModelChangeJournalDiagnosticsForTesting(
  model: object,
): ChangeJournalDiagnostics {
  const journal = modelChangeJournals.get(model);
  if (journal === undefined) {
    throw new TypeError("Diagnostics require a local Pretable row model.");
  }
  return getChangeJournalDiagnosticsForTesting(journal);
}

/** @public */
export type CreateLocalRowModelOptions<
  TColumns,
  TRowId extends PretableRowId,
> = CreateLocalRowModelBaseOptions<TColumns, TRowId> & {
  readonly getRowId: (row: RowForColumns<TColumns>) => TRowId;
};

type RowForColumns<TColumns> =
  ColumnDescriptorOf<TColumns> extends {
    readonly row: infer TRow extends object;
  }
    ? TRow
    : never;

type DefaultRowId<TColumns> =
  RowForColumns<TColumns> extends {
    readonly id: infer TRowId extends PretableRowId;
  }
    ? TRowId
    : never;

/** @public */
export type CreateLocalRowModelWithDefaultIdOptions<TColumns> =
  RowForColumns<TColumns> extends { readonly id: PretableRowId }
    ? CreateLocalRowModelBaseOptions<TColumns, DefaultRowId<TColumns>> & {
        readonly getRowId?: undefined;
      }
    : never;

type RuntimeCreateLocalRowModelOptions<
  TColumns,
  TRowId extends PretableRowId,
> = CreateLocalRowModelBaseOptions<TColumns, TRowId> & {
  readonly getRowId?: (row: RowForColumns<TColumns>) => TRowId;
};

interface ActiveTransition<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly id: number;
  readonly operation: "set-query" | "set-derivations";
  readonly candidate: CooperativeTransitionCandidate<TRow, TRowId, TColumns>;
  readonly finished: Promise<number>;
  readonly resolve: (revision: number) => void;
  readonly reject: (error: unknown) => void;
  cancelScheduled: (() => void) | undefined;
}

class PretableSetRowsExecutionError extends PretableRowModelError {
  readonly name = "PretableSetRowsExecutionError";
  readonly rowIds: readonly PretableRowId[] | undefined;
  readonly groupValues: readonly unknown[] | undefined;
  readonly groupId: PretableGroupId | undefined;
  readonly value: unknown;

  constructor(error: PretableRowModelError) {
    super(error.code, error.message, {
      operation: "set-rows",
      rowId: error.rowId,
      columnId: error.columnId,
      cause: error.cause,
    });
    const detailed = error as PretableRowModelError & {
      readonly rowIds?: readonly PretableRowId[];
      readonly groupValues?: readonly unknown[];
      readonly groupId?: PretableGroupId;
      readonly value?: unknown;
    };
    this.rowIds = detailed.rowIds && Object.freeze([...detailed.rowIds]);
    this.groupValues =
      detailed.groupValues && Object.freeze([...detailed.groupValues]);
    this.groupId = detailed.groupId;
    this.value = detailed.value;
  }
}

class PretableOperationExecutionError extends PretableRowModelError {
  readonly name = "PretableOperationExecutionError";
  readonly rowIds: readonly PretableRowId[] | undefined;
  readonly groupValues: readonly unknown[] | undefined;
  readonly groupId: PretableGroupId | undefined;
  readonly value: unknown;

  constructor(
    error: PretableRowModelError,
    operation: PretableRowModelOperation,
  ) {
    super(error.code, error.message, {
      operation,
      rowId: error.rowId,
      columnId: error.columnId,
      cause: error.cause,
    });
    const detailed = error as PretableRowModelError & {
      readonly rowIds?: readonly PretableRowId[];
      readonly groupValues?: readonly unknown[];
      readonly groupId?: PretableGroupId;
      readonly value?: unknown;
    };
    this.rowIds = detailed.rowIds && Object.freeze([...detailed.rowIds]);
    this.groupValues =
      detailed.groupValues && Object.freeze([...detailed.groupValues]);
    this.groupId = detailed.groupId;
    this.value = detailed.value;
  }
}

function remapOperationError(
  error: unknown,
  operation: PretableRowModelOperation,
): unknown {
  if (
    error instanceof PretableRowModelError &&
    error.code !== "reentrant-mutation" &&
    error.operation !== operation
  ) {
    return new PretableOperationExecutionError(error, operation);
  }
  return error;
}

function remapSetRowsError(error: unknown): unknown {
  if (
    error instanceof PretableRowModelError &&
    error.code !== "reentrant-mutation" &&
    error.operation !== "set-rows"
  ) {
    return new PretableSetRowsExecutionError(error);
  }
  return error;
}

function emitDiagnostics<TRowId extends PretableRowId>(
  diagnostics: readonly PretableRowIntegrityDiagnostic<TRowId>[],
  sink: PretableRowIntegrityDiagnosticSink<TRowId> | undefined,
): void {
  if (sink === undefined) return;
  for (const diagnostic of diagnostics) {
    try {
      sink(diagnostic);
    } catch {
      // Diagnostics run after publication and never change command success.
    }
  }
}

const READY = Object.freeze({ kind: "ready" as const });
const DISPOSED = Object.freeze({ kind: "disposed" as const });

function emptyQuery<TColumns>(): PretableQueryFor<TColumns> {
  return Object.freeze({
    filters: Object.freeze([]),
    sort: Object.freeze([]),
    rowGroups: Object.freeze([]),
  }) as PretableQueryFor<TColumns>;
}

function createExpansionRoot(
  policy: PretableExpansionDefault | undefined,
): ExpansionRoot {
  // Expanded, not collapsed. Grouping here is an interactive act as much as a
  // configuration one — the user drags a column into the group panel while
  // reading their rows — and collapsing on drop makes the data they were just
  // looking at disappear. AG Grid (`groupDefaultExpanded: 0`) and TanStack
  // (empty expanded map) both default collapsed, where grouping is set up by a
  // developer before the user arrives; `{ kind: "through-depth" }` is the
  // escape hatch for datasets too large to open at once.
  const defaultPolicy = Object.freeze(
    policy === undefined ? { kind: "expanded" as const } : { ...policy },
  );
  return Object.freeze({
    default: defaultPolicy,
    overrides: createPersistentMap<PretableGroupId, boolean>(),
    state: Object.freeze({ default: defaultPolicy, overrideCount: 0 }),
  });
}

function mutationResult<TRowId extends PretableRowId>(
  previousRevision: number,
  revision: number,
  counts: Partial<
    Pick<
      PretableMutationResult<TRowId>,
      "added" | "updated" | "removed" | "unchanged" | "ignored"
    >
  > = {},
  issues: readonly PretableMutationIssue<TRowId>[] = [],
): PretableMutationResult<TRowId> {
  return Object.freeze({
    previousRevision,
    revision,
    added: counts.added ?? 0,
    updated: counts.updated ?? 0,
    removed: counts.removed ?? 0,
    unchanged: counts.unchanged ?? 0,
    ignored: counts.ignored ?? 0,
    issues: Object.freeze(Array.from(issues)),
  });
}

function visibleRef<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  row: PretableVisibleRow<TRow, TRowId, TColumns>,
): PretableVisibleRowRef<TRowId> {
  return row.kind === "data"
    ? Object.freeze({ kind: "data" as const, rowId: row.rowId })
    : Object.freeze({ kind: "group" as const, groupId: row.groupId });
}

function expansionChangeOperations<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  previous: PretableRowModelState<TRow, TRowId, TColumns>["snapshot"],
  next: PretableRowModelState<TRow, TRowId, TColumns>["snapshot"],
  groupId: PretableGroupId,
): readonly PretableChangeOperation<TRowId>[] {
  const ref = Object.freeze({ kind: "group" as const, groupId });
  const previousIndex = previous.indexOf(ref);
  const index = next.indexOf(ref);
  if (previousIndex < 0 || index < 0) return Object.freeze([]);
  const previousGroup = previous.rowAt(previousIndex);
  const nextGroup = next.rowAt(index);
  if (previousGroup?.kind !== "group" || nextGroup?.kind !== "group") {
    return Object.freeze([]);
  }
  const operations: PretableChangeOperation<TRowId>[] = [];
  if (previousGroup.expanded !== nextGroup.expanded) {
    operations.push(
      Object.freeze({
        kind: "update" as const,
        ref,
        index,
        fields: Object.freeze(["expanded" as const]),
      }),
    );
  }
  if (previousGroup.expanded && !nextGroup.expanded) {
    const descendants: {
      readonly ref: PretableVisibleRowRef<TRowId>;
      readonly previousIndex: number;
    }[] = [];
    for (
      let descendantIndex = previousIndex + 1;
      descendantIndex < previous.visibleRowCount;
      descendantIndex += 1
    ) {
      const row = previous.rowAt(descendantIndex);
      if (row === undefined || row.depth <= previousGroup.depth) break;
      descendants.push({
        ref: visibleRef(row),
        previousIndex: descendantIndex,
      });
    }
    for (const descendant of descendants.reverse()) {
      operations.push(
        Object.freeze({ kind: "remove" as const, ...descendant }),
      );
    }
  } else if (!previousGroup.expanded && nextGroup.expanded) {
    for (
      let descendantIndex = index + 1;
      descendantIndex < next.visibleRowCount;
      descendantIndex += 1
    ) {
      const row = next.rowAt(descendantIndex);
      if (row === undefined || row.depth <= nextGroup.depth) break;
      operations.push(
        Object.freeze({
          kind: "insert" as const,
          ref: visibleRef(row),
          index: descendantIndex,
        }),
      );
    }
  }
  return Object.freeze(operations);
}

/**
 * Creates the persistent, framework-independent local row model.
 * @public
 */
export function createLocalRowModel<const TColumns extends readonly unknown[]>(
  options: CreateLocalRowModelWithDefaultIdOptions<TColumns>,
): PretableRowModel<RowForColumns<TColumns>, DefaultRowId<TColumns>, TColumns>;
/** @public */
export function createLocalRowModel<
  const TColumns extends readonly unknown[],
  const TRowId extends PretableRowId,
>(
  options: CreateLocalRowModelOptions<TColumns, TRowId>,
): PretableRowModel<RowForColumns<TColumns>, TRowId, TColumns>;
/** @public */
export function createLocalRowModel<
  const TColumns extends readonly unknown[],
  const TRowId extends PretableRowId,
>(
  options: RuntimeCreateLocalRowModelOptions<TColumns, TRowId>,
): PretableRowModel<RowForColumns<TColumns>, TRowId, TColumns> {
  type TRow = RowForColumns<TColumns>;
  const instrumentation = optionInstrumentation.get(options);
  optionInstrumentation.delete(options);
  const columns = Object.freeze(
    Array.from(options.columns),
  ) as unknown as TColumns;
  const getRowId =
    options.getRowId ??
    ((row: TRow): TRowId =>
      (row as TRow & { readonly id: unknown }).id as TRowId);
  const requestedDerivations = (options.derivations ??
    columns) as PretableDerivationsFor<TColumns>;
  const requestedQuery = options.query ?? emptyQuery<TColumns>();
  let filterAuthority: CompiledFilterAuthority =
    options.ɵfilterAuthority ?? "engine";
  let sortAuthority: CompiledSortAuthority = options.ɵsortAuthority ?? "engine";
  let queryPlan = compileQuery({
    derivations: requestedDerivations,
    query: requestedQuery,
    filterAuthority,
    sortAuthority,
  });
  let derivations = queryPlan.derivations;
  let query = queryPlan.query;
  const aggregateFilteredRows = options.aggregateFilteredRows ?? false;
  const diagnosticSink = options.onDiagnostic as
    PretableRowIntegrityDiagnosticSink<TRowId> | undefined;
  const initialStore = buildRowStore({
    rows: options.rows,
    getRowId,
    queryPlan,
    instrumentation,
  });
  const initialExpansion = createExpansionRoot(options.initialExpansion);
  let root: RevisionRoot<TRow, TRowId, TColumns> = Object.freeze({
    revision: 0,
    parentRevision: null,
    rows: initialStore.rows,
    sourceOrder: initialStore.sourceOrder,
    visible: createVisibleIndex(
      initialStore.records,
      queryPlan,
      aggregateFilteredRows,
      initialExpansion.overrides,
    ),
    queryPlan,
    expansion: initialExpansion,
    cause: Object.freeze({ kind: "initial" as const }),
  });
  let snapshot = createSnapshot(root, instrumentation);
  let state: PretableRowModelState<TRow, TRowId, TColumns> = Object.freeze({
    snapshot,
    status: READY,
  });
  let disposed = false;
  let activeMutation: PretableRowModelOperation | undefined;
  let nextSourceOrder = initialStore.records.length;
  let nextTransitionId = 1;
  let activeTransition: ActiveTransition<TRow, TRowId, TColumns> | undefined;
  const listeners = new Set<() => void>();
  const changeJournal = createChangeJournal<TRowId>(
    options.changeJournalCapacity,
  );
  const transitionRuntime = createCooperativeTransitionRuntime({
    scheduler: options.transitionScheduler,
    now: options.transitionClock,
    budgetMs: options.transitionBudgetMs,
    maxUnitsPerSlice: options.transitionMaxUnitsPerSlice,
    instrumentation,
  });
  const distinctValues = createDistinctValueManager({
    getRoot: () => root,
    getDerivations: () => derivations as readonly unknown[],
    runtime: transitionRuntime,
    cacheCapacity: options.distinctValueCacheCapacity,
  });

  const assertCommandAllowed = (operation: PretableRowModelOperation): void => {
    if (activeMutation !== undefined) {
      throw new PretableReentrantMutationError(operation, activeMutation);
    }
    if (disposed) throw new PretableDisposedModelError(operation);
  };
  const guarded = <T>(
    operation: PretableRowModelOperation,
    action: () => T,
  ): T => {
    assertCommandAllowed(operation);
    activeMutation = operation;
    try {
      return action();
    } catch (error) {
      const reentrant = findPretableReentrantMutationError(error);
      if (reentrant !== undefined) throw reentrant;
      throw error;
    } finally {
      activeMutation = undefined;
    }
  };
  const rebuildingStatus = (
    transition: ActiveTransition<TRow, TRowId, TColumns>,
  ) =>
    Object.freeze({
      kind: "rebuilding" as const,
      transitionId: transition.id,
      completedRows: transition.candidate.completedRows,
      totalRows: transition.candidate.totalRows,
    });
  const commit = (
    next: RevisionRoot<TRow, TRowId, TColumns>,
    status = activeTransition === undefined
      ? READY
      : rebuildingStatus(activeTransition),
  ): void => {
    root = next;
    snapshot = createSnapshot(root, instrumentation);
    state = Object.freeze({ snapshot, status });
  };
  const notify = (): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        // One consumer must not prevent the remaining subscribers from waking.
      }
    }
  };
  const publishCommittedRoot = (
    committedRoot: RevisionRoot<TRow, TRowId, TColumns>,
    previousRevision: number,
    revision: number,
    // Only the sort-only fast path may pass "reorder": it is the one commit
    // that provably changes order and nothing else. Every other publisher
    // keeps the plain barrier default.
    barrierReason: "bulk-replace" | "reorder" = "bulk-replace",
  ): void => {
    queryPlan = committedRoot.queryPlan;
    query = committedRoot.queryPlan.query;
    derivations = committedRoot.queryPlan.derivations;
    commit(committedRoot, READY);
    // On a sort-only change this is structurally a no-op (distinct-value
    // cache keys hash filter/column/population semantics, never sort); kept
    // so both paths publish through one identical recipe.
    distinctValues.publishTransitionRoot(committedRoot);
    changeJournal.appendBarrier(previousRevision, revision, barrierReason);
  };
  const transitionError = (
    error: unknown,
    operation: "set-query" | "set-derivations",
  ): PretableRowModelError => {
    const remapped = remapOperationError(error, operation);
    return remapped instanceof PretableRowModelError
      ? remapped
      : new PretableRowModelError(
          "derivation-failed",
          `The ${operation} transition failed.`,
          { operation, cause: remapped },
        );
  };
  const cancelActiveTransition = (
    reason: PretableTransitionCancellationReason,
  ): ActiveTransition<TRow, TRowId, TColumns> | undefined => {
    const transition = activeTransition;
    if (transition === undefined) return undefined;
    activeTransition = undefined;
    const cancelScheduled = transition.cancelScheduled;
    transition.cancelScheduled = undefined;
    try {
      cancelScheduled?.();
    } catch {
      // Scheduler cancellation is best-effort; model ownership still releases.
    }
    transition.candidate.release();
    transition.reject(
      new PretableTransitionCancelledError(transition.id, reason),
    );
    return transition;
  };
  const failTransition = (
    transition: ActiveTransition<TRow, TRowId, TColumns>,
    error: unknown,
  ): void => {
    if (activeTransition !== transition) return;
    activeTransition = undefined;
    const cancelScheduled = transition.cancelScheduled;
    transition.cancelScheduled = undefined;
    try {
      cancelScheduled?.();
    } catch {
      // Preserve the transition failure rather than a scheduler cleanup error.
    }
    transition.candidate.release();
    const typed =
      findPretableReentrantMutationError(error) ??
      transitionError(error, transition.operation);
    state = Object.freeze({
      snapshot,
      status: Object.freeze({
        kind: "error" as const,
        transitionId: transition.id,
        error: typed,
      }),
    });
    transition.reject(typed);
  };
  const scheduleTransition = (
    transition: ActiveTransition<TRow, TRowId, TColumns>,
  ): void => {
    transition.cancelScheduled = transitionRuntime.scheduler.schedule(() => {
      if (disposed || activeTransition !== transition) return;
      let changed = false;
      try {
        changed = guarded(transition.operation, () => {
          transition.cancelScheduled = undefined;
          return runTransitionSlice(transition);
        });
      } catch (error) {
        failTransition(transition, error);
        changed = true;
      }
      if (changed) notify();
    });
  };
  const runTransitionSlice = (
    transition: ActiveTransition<TRow, TRowId, TColumns>,
  ): boolean => {
    if (activeTransition !== transition || disposed) return false;
    try {
      const complete = runCooperativeTransitionSlice(transitionRuntime, () =>
        transition.candidate.step(),
      );
      if (activeTransition !== transition || disposed) return false;
      if (!complete) {
        state = Object.freeze({
          snapshot,
          status: rebuildingStatus(transition),
        });
        scheduleTransition(transition);
        return true;
      }

      const previousRevision = root.revision;
      const revision = previousRevision + 1;
      const committedRoot = transition.candidate.finish(revision);
      activeTransition = undefined;
      const cancelScheduled = transition.cancelScheduled;
      transition.cancelScheduled = undefined;
      try {
        cancelScheduled?.();
      } catch {
        // Successful publication cannot be rolled back by advisory cleanup.
      }
      publishCommittedRoot(committedRoot, previousRevision, revision);
      transition.candidate.release();
      transition.resolve(revision);
      return true;
    } catch (error) {
      failTransition(transition, error);
      return true;
    }
  };
  const startTransition = (
    id: number,
    operation: "set-query" | "set-derivations",
    nextPlan: CompiledQuery<TColumns>,
  ): ActiveTransition<TRow, TRowId, TColumns> => {
    cancelActiveTransition("superseded");
    let resolve!: (revision: number) => void;
    let reject!: (error: unknown) => void;
    const finished = new Promise<number>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    // Mark internal lifecycle rejection as observed without changing the
    // original promise returned to callers or its await/rejection semantics.
    void finished.catch(() => undefined);
    const transition: ActiveTransition<TRow, TRowId, TColumns> = {
      id,
      operation,
      candidate: createCooperativeTransitionCandidate({
        captured: root,
        queryPlan: nextPlan,
        aggregateFilteredRows,
        operation,
        instrumentation,
      }),
      finished,
      resolve,
      reject,
      cancelScheduled: undefined,
    };
    activeTransition = transition;
    state = Object.freeze({ snapshot, status: rebuildingStatus(transition) });
    runTransitionSlice(transition);
    return transition;
  };
  const appendTransitionDelta = (
    target: RevisionRoot<TRow, TRowId, TColumns>,
    affectedRowIds: readonly TRowId[],
  ): void => {
    activeTransition?.candidate.append(
      Object.freeze({
        target,
        affectedRowIds: Object.freeze([...affectedRowIds]),
      }),
    );
  };
  const cancelTransitionHandle = (
    id: number,
    operation: "set-query" | "set-derivations",
  ): void => {
    const cancelled = guarded(operation, () => {
      if (activeTransition?.id !== id) return false;
      cancelActiveTransition("cancelled");
      state = Object.freeze({ snapshot, status: READY });
      return true;
    });
    if (cancelled) notify();
  };
  const applyExpansionDefault = (
    operation: "set-expansion-default" | "expand-all" | "collapse-all",
    policy: PretableExpansionDefault,
    expansionOptions?: { readonly preserveOverrides?: boolean },
  ): PretableMutationResult<TRowId> => {
    try {
      const prepared = guarded(operation, () => {
        const previousRoot = root;
        const nextPolicy = Object.freeze({
          ...policy,
        }) as PretableExpansionDefault;
        const preserve = expansionOptions?.preserveOverrides === true;
        const samePolicy =
          JSON.stringify(previousRoot.expansion.default) ===
          JSON.stringify(nextPolicy);
        if (
          samePolicy &&
          (preserve || previousRoot.expansion.overrides.size === 0)
        ) {
          return {
            result: mutationResult<TRowId>(
              previousRoot.revision,
              previousRoot.revision,
            ),
            notify: false,
          };
        }
        let groups = getGroupIndex(previousRoot.visible);
        if (!preserve && groups !== undefined) {
          for (const [groupId] of previousRoot.expansion.overrides.entries()) {
            groups = setGroupOverride(groups, groupId, undefined, operation);
          }
        }
        const overrides = preserve
          ? previousRoot.expansion.overrides
          : createPersistentMap<PretableGroupId, boolean>();
        const expansion = Object.freeze({
          default: nextPolicy,
          overrides,
          state: Object.freeze({
            default: nextPolicy,
            overrideCount: overrides.size,
          }),
        });
        const revision = previousRoot.revision + 1;
        const committedRoot = Object.freeze({
          ...previousRoot,
          revision,
          parentRevision: previousRoot.revision,
          visible:
            groups === undefined
              ? previousRoot.visible
              : attachGroupIndex(previousRoot.visible.rows, groups),
          expansion,
        });
        appendTransitionDelta(committedRoot, []);
        commit(committedRoot);
        changeJournal.appendBarrier(previousRoot.revision, revision);
        return {
          result: mutationResult<TRowId>(previousRoot.revision, revision),
          notify: true,
        };
      });
      if (prepared.notify) notify();
      return prepared.result;
    } catch (error) {
      throw remapOperationError(error, operation);
    }
  };

  const model = {
    getState: () => state,
    getColumns: () => columns,
    subscribe(listener: () => void) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
    setRows(nextRows: readonly TRow[]): PretableMutationResult<TRowId> {
      try {
        const prepared = guarded("set-rows", () => {
          const previousRoot = root;
          let nextPlan = queryPlan;
          let drafted = replaceFlatRowsDraft({
            root: previousRoot,
            rows: nextRows,
            getRowId,
            queryPlan: nextPlan,
            nextSourceOrder,
            instrumentation,
          });
          const pendingDiagnostics = drafted.diagnostics;
          if (drafted.sameReferenceMutation) {
            nextPlan = compileQuery({
              derivations,
              query,
              filterAuthority,
              sortAuthority,
            });
            /*
             * The recompile is a plan swap, so the fresh plan's sort-key
             * store must be filled for every surviving row — rows the draft
             * re-evaluates get overwritten with recomputed values right
             * after, and untouched rows carry their previous keys. Without
             * this, records carried into the committed root would be
             * unresolvable under the root's own plan.
             */
            for (const [, record] of previousRoot.rows.entries()) {
              fillSortKeysFromPrevious(
                nextPlan,
                queryPlan,
                record as never,
                instrumentation,
              );
            }
            drafted = replaceFlatRowsDraft({
              root: previousRoot,
              rows: nextRows,
              getRowId,
              queryPlan: nextPlan,
              nextSourceOrder,
              acceptSameReferenceMutation: true,
              instrumentation,
            });
            if (drafted.effective) {
              /*
               * The draft's visible index reuses trees whose comparators
               * captured the RETIRED plan, and that plan's store still holds
               * the pre-mutation keys for every in-place-mutated row object.
               * Rebuild the index under the fresh plan so every entry is
               * re-decorated with keys from the store that actually saw the
               * mutation. The draft emits no per-row operations, so the
               * rebuild is journal-invisible.
               */
              const records: RowRecord<TRow, TRowId, TColumns>[] = [];
              for (const entry of drafted.sourceOrder.entries()) {
                const record = drafted.rows.get(entry.rowId);
                if (record !== undefined) records.push(record);
              }
              drafted = {
                ...drafted,
                visible: createVisibleIndex(
                  records,
                  nextPlan,
                  aggregateFilteredRows,
                  previousRoot.expansion.overrides,
                ),
              };
            }
          }
          if (!drafted.effective) {
            return {
              result: mutationResult<TRowId>(
                previousRoot.revision,
                previousRoot.revision,
                drafted,
              ),
              notify: false,
              diagnostics: Object.freeze(
                [],
              ) as readonly PretableRowIntegrityDiagnostic<TRowId>[],
            };
          }
          const previousRevision = previousRoot.revision;
          const committedRoot: RevisionRoot<TRow, TRowId, TColumns> =
            Object.freeze({
              revision: previousRevision + 1,
              parentRevision: previousRevision,
              rows: drafted.rows,
              sourceOrder: drafted.sourceOrder,
              visible: drafted.visible,
              queryPlan: nextPlan,
              expansion: previousRoot.expansion,
              cause: Object.freeze({ kind: "set-rows" as const }),
            });
          const result = mutationResult<TRowId>(
            previousRevision,
            committedRoot.revision,
            drafted,
          );
          const distinctCommit = distinctValues.prepareCommit(
            committedRoot,
            drafted.affectedRowIds,
            "set-rows",
          );
          queryPlan = nextPlan;
          nextSourceOrder = drafted.nextSourceOrder;
          appendTransitionDelta(committedRoot, drafted.affectedRowIds);
          commit(committedRoot);
          distinctValues.publishCommit(
            distinctCommit,
            committedRoot,
            drafted.affectedRowIds,
          );
          changeJournal.appendBarrier(previousRevision, committedRoot.revision);
          return {
            result,
            notify: true,
            diagnostics: pendingDiagnostics,
          };
        });
        if (prepared.notify) notify();
        emitDiagnostics(prepared.diagnostics, diagnosticSink);
        return prepared.result;
      } catch (error) {
        throw remapSetRowsError(error);
      }
    },
    applyTransaction(transaction: PretableTransaction<TRow, TRowId>) {
      const prepared = guarded("apply-transaction", () => {
        const previousRoot = root;
        const drafted = applyFlatTransactionDraft({
          root: previousRoot,
          transaction,
          getRowId,
          queryPlan,
          nextSourceOrder,
          instrumentation,
        });
        const result = mutationResult<TRowId>(
          previousRoot.revision,
          drafted.effective ? previousRoot.revision + 1 : previousRoot.revision,
          drafted,
          drafted.issues,
        );
        if (!drafted.effective) {
          return { result, notify: false, diagnostics: drafted.diagnostics };
        }
        const committedRoot: RevisionRoot<TRow, TRowId, TColumns> =
          Object.freeze({
            revision: result.revision,
            parentRevision: previousRoot.revision,
            rows: drafted.rows,
            sourceOrder: drafted.sourceOrder,
            visible: drafted.visible,
            queryPlan,
            expansion: previousRoot.expansion,
            cause: Object.freeze({ kind: "set-rows" as const }),
          });
        const distinctCommit = distinctValues.prepareCommit(
          committedRoot,
          drafted.affectedRowIds,
          "apply-transaction",
        );
        nextSourceOrder = drafted.nextSourceOrder;
        appendTransitionDelta(committedRoot, drafted.affectedRowIds);
        commit(committedRoot);
        distinctValues.publishCommit(
          distinctCommit,
          committedRoot,
          drafted.affectedRowIds,
        );
        changeJournal.appendChanges(
          previousRoot.revision,
          committedRoot.revision,
          drafted.operations,
        );
        return { result, notify: true, diagnostics: drafted.diagnostics };
      });
      if (prepared.notify) notify();
      emitDiagnostics(prepared.diagnostics, diagnosticSink);
      return prepared.result;
    },
    setQuery(
      nextQuery: PretableQueryFor<TColumns>,
    ): PretableQueryTransition<TColumns> {
      const prepared = guarded("set-query", () => {
        const id = nextTransitionId++;
        const nextPlan = compileQuery({
          derivations,
          query: nextQuery,
          previous: queryPlan,
          operation: "set-query",
          filterAuthority,
          sortAuthority,
        });
        if (nextPlan === queryPlan) {
          const superseded = cancelActiveTransition("superseded") !== undefined;
          if (superseded) state = Object.freeze({ snapshot, status: READY });
          return {
            transition: Object.freeze({
              id,
              requestedQuery: queryPlan.query,
              finished: Promise.resolve(root.revision),
              cancel: () => cancelTransitionHandle(id, "set-query"),
            }),
            notify: superseded,
          };
        }
        if (
          isSortOnlyChange(queryPlan, nextPlan) &&
          nextPlan.query.rowGroups.length === 0
        ) {
          cancelActiveTransition("superseded");
          const previousRevision = root.revision;
          const revision = previousRevision + 1;
          let committedRoot: RevisionRoot<TRow, TRowId, TColumns>;
          try {
            committedRoot = rebuildRootForSortOnlyChange({
              captured: root,
              nextPlan,
              revision,
              now: transitionRuntime.now,
              instrumentation,
            });
          } catch (error) {
            // Mirrors failTransition's observable semantics: an error status
            // carrying this transition's id, a rejected `finished`, and the
            // committed root left untouched.
            const typed =
              findPretableReentrantMutationError(error) ??
              transitionError(error, "set-query");
            state = Object.freeze({
              snapshot,
              status: Object.freeze({
                kind: "error" as const,
                transitionId: id,
                error: typed,
              }),
            });
            const finished = Promise.reject(typed);
            void finished.catch(() => undefined);
            return {
              transition: Object.freeze({
                id,
                requestedQuery: nextPlan.query,
                finished,
                cancel: () => cancelTransitionHandle(id, "set-query"),
              }),
              notify: true,
            };
          }
          publishCommittedRoot(
            committedRoot,
            previousRevision,
            revision,
            "reorder",
          );
          return {
            transition: Object.freeze({
              id,
              requestedQuery: nextPlan.query,
              finished: Promise.resolve(revision),
              cancel: () => cancelTransitionHandle(id, "set-query"),
            }),
            notify: true,
          };
        }
        const active = startTransition(id, "set-query", nextPlan);
        return {
          transition: Object.freeze({
            id,
            requestedQuery: nextPlan.query,
            finished: active.finished,
            cancel: () => cancelTransitionHandle(id, "set-query"),
          }),
          notify: true,
        };
      });
      if (prepared.notify) notify();
      return prepared.transition;
    },
    setDerivations(
      nextDerivations: PretableDerivationsFor<TColumns>,
    ): PretableDerivationTransition<TColumns> {
      try {
        const prepared = guarded("set-derivations", () => {
          const id = nextTransitionId++;
          const capturedPlan = compileQuery({
            derivations: nextDerivations,
            query,
            operation: "set-derivations",
            filterAuthority,
            sortAuthority,
          });
          const nextPlan = compileQuery({
            derivations: capturedPlan.derivations,
            query,
            previous: queryPlan,
            operation: "set-derivations",
            filterAuthority,
            sortAuthority,
          });
          if (nextPlan === queryPlan) {
            derivations = capturedPlan.derivations;
            distinctValues.publishTransitionRoot(root);
            const superseded =
              cancelActiveTransition("superseded") !== undefined;
            if (superseded) state = Object.freeze({ snapshot, status: READY });
            return {
              transition: Object.freeze({
                id,
                requestedDerivations: capturedPlan.derivations,
                finished: Promise.resolve(root.revision),
                cancel: () => cancelTransitionHandle(id, "set-derivations"),
              }),
              notify: superseded,
            };
          }
          const active = startTransition(id, "set-derivations", nextPlan);
          return {
            transition: Object.freeze({
              id,
              requestedDerivations: nextPlan.derivations,
              finished: active.finished,
              cancel: () => cancelTransitionHandle(id, "set-derivations"),
            }),
            notify: true,
          };
        });
        if (prepared.notify) notify();
        return prepared.transition;
      } catch (error) {
        throw remapOperationError(error, "set-derivations");
      }
    },
    setGroupExpanded(groupId: PretableGroupId, expanded: boolean) {
      try {
        const prepared = guarded("set-group-expanded", () => {
          const previousRoot = root;
          const groups = getGroupIndex(previousRoot.visible);
          const group = groups?.groups.get(groupId);
          if (groups === undefined || group === undefined) {
            return {
              result: mutationResult(
                previousRoot.revision,
                previousRoot.revision,
                { ignored: 1 },
                [Object.freeze({ code: "unknown-group-id" as const, groupId })],
              ),
              notify: false,
            };
          }
          const defaultExpanded =
            previousRoot.expansion.default.kind === "expanded" ||
            (previousRoot.expansion.default.kind === "through-depth" &&
              group.depth <= previousRoot.expansion.default.depth);
          const override = expanded === defaultExpanded ? undefined : expanded;
          const current = previousRoot.expansion.overrides.get(groupId);
          const exists = previousRoot.expansion.overrides.has(groupId);
          if (
            (override === undefined && !exists) ||
            (override !== undefined && exists && current === override)
          ) {
            return {
              result: mutationResult(
                previousRoot.revision,
                previousRoot.revision,
              ),
              notify: false,
            };
          }
          const overrides =
            override === undefined
              ? previousRoot.expansion.overrides.delete(groupId)
              : previousRoot.expansion.overrides.set(groupId, override);
          const nextGroups = setGroupOverride(
            groups,
            groupId,
            override,
            "set-group-expanded",
          );
          const expansion = Object.freeze({
            default: previousRoot.expansion.default,
            overrides,
            state: Object.freeze({
              default: previousRoot.expansion.default,
              overrideCount: overrides.size,
            }),
          });
          const revision = previousRoot.revision + 1;
          const committedRoot = Object.freeze({
            ...previousRoot,
            revision,
            parentRevision: previousRoot.revision,
            visible: attachGroupIndex(previousRoot.visible.rows, nextGroups),
            expansion,
          });
          const previousSnapshot = snapshot;
          const nextSnapshot = createFlatSnapshot(committedRoot);
          const operations = expansionChangeOperations(
            previousSnapshot,
            nextSnapshot,
            groupId,
          );
          appendTransitionDelta(committedRoot, []);
          commit(committedRoot);
          changeJournal.appendChanges(
            previousRoot.revision,
            revision,
            operations,
          );
          return {
            result: mutationResult(previousRoot.revision, revision),
            notify: true,
          };
        });
        if (prepared.notify) notify();
        return prepared.result;
      } catch (error) {
        throw remapOperationError(error, "set-group-expanded");
      }
    },
    setExpansionDefault(
      policy: PretableExpansionDefault,
      expansionOptions?: { readonly preserveOverrides?: boolean },
    ) {
      return applyExpansionDefault(
        "set-expansion-default",
        policy,
        expansionOptions,
      );
    },
    expandAll() {
      return applyExpansionDefault("expand-all", { kind: "expanded" });
    },
    collapseAll() {
      return applyExpansionDefault("collapse-all", { kind: "collapsed" });
    },
    changesSince(revision: number) {
      assertCommandAllowed("changes-since");
      return changeJournal.changesSince(revision, root.revision);
    },
    distinctValues(
      columnId: string,
      distinctOptions?: Parameters<typeof distinctValues.query>[1],
    ): PretableDistinctValueQuery<unknown> {
      return guarded("distinct-values", () =>
        distinctValues.query(columnId, distinctOptions),
      );
    },
    dispose(): void {
      if (activeMutation !== undefined) {
        throw new PretableReentrantMutationError("dispose", activeMutation);
      }
      if (disposed) return;
      const current = guarded("dispose", () => {
        cancelActiveTransition("disposed");
        distinctValues.dispose(
          new PretableDisposedModelError("distinct-values"),
        );
        changeJournal.clear();
        disposed = true;
        state = Object.freeze({ snapshot, status: DISPOSED });
        if (instrumentation !== undefined)
          instrumentation.currentRevisionRoot = root;
        const captured = Array.from(listeners);
        listeners.clear();
        return captured;
      });
      for (const listener of current) {
        try {
          listener();
        } catch {
          // Disposal still detaches and wakes every listener exactly once.
        }
      }
    },
  };

  // Construction has no subscribers. Future ingestion diagnostics, if any,
  // are delivered only after the initial immutable state and model exist.
  modelChangeJournals.set(model, changeJournal as ChangeJournal<PretableRowId>);
  modelRevisionCauses.set(model, () => root.cause);
  modelActiveTransitionCandidates.set(model, () => activeTransition?.candidate);
  /*
   * Re-running `setQuery` with the query the model already holds is what makes
   * the flip take effect: the query is unchanged, so nothing reported moves,
   * while the plan differs by authority alone and `semanticallyMatches` now
   * refuses to reuse it. The rebuild is the ordinary cooperative transition,
   * cancellation and status included.
   */
  modelFilterAuthoritySetters.set(model, (authority) => {
    if (disposed || authority === filterAuthority) return;
    filterAuthority = authority;
    const transition = model.setQuery(query);
    void transition.finished.catch(() => undefined);
  });
  modelSortAuthoritySetters.set(model, (authority) => {
    if (disposed || authority === sortAuthority) return;
    sortAuthority = authority;
    const transition = model.setQuery(query);
    void transition.finished.catch(() => undefined);
  });
  distinctValues.attachModel(model);
  emitDiagnostics(initialStore.diagnostics, diagnosticSink);
  return model as unknown as PretableRowModel<TRow, TRowId, TColumns>;
}
