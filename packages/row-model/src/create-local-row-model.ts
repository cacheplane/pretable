import { compileQuery } from "./compiled-query";
import { createChangeJournal } from "./change-journal";
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
  type PretableRowModelOperation,
} from "./errors";
import type { ExpansionRoot, RevisionRoot } from "./internal-types";
import {
  attachGroupIndex,
  getGroupIndex,
  setGroupOverride,
} from "./group-index";
import { createPersistentMap } from "./persistent/persistent-map";
import { buildRowStore, rebuildRowStoreForQuery } from "./row-store";
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
  /** Overrides the bounded consumer journal size for diagnostics and tests. */
  readonly changeJournalCapacity?: number;
  readonly onDiagnostic?: (
    diagnostic: PretableRowIntegrityDiagnostic<TRowId>,
  ) => void;
}

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

class PretableNotYetImplementedError extends PretableRowModelError {
  readonly name = "PretableNotYetImplementedError";
  readonly reason = "not-yet-implemented" as const;

  constructor(operation: PretableRowModelOperation) {
    super(
      "derivation-failed",
      `The ${operation} command is not implemented in the flat bootstrap model.`,
      { operation },
    );
  }
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
  const defaultPolicy = Object.freeze(
    policy === undefined ? { kind: "collapsed" as const } : { ...policy },
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

/** Creates the persistent, framework-independent local row model. */
export function createLocalRowModel<const TColumns extends readonly unknown[]>(
  options: CreateLocalRowModelWithDefaultIdOptions<TColumns>,
): PretableRowModel<RowForColumns<TColumns>, DefaultRowId<TColumns>, TColumns>;
export function createLocalRowModel<
  const TColumns extends readonly unknown[],
  const TRowId extends PretableRowId,
>(
  options: CreateLocalRowModelOptions<TColumns, TRowId>,
): PretableRowModel<RowForColumns<TColumns>, TRowId, TColumns>;
export function createLocalRowModel<
  const TColumns extends readonly unknown[],
  const TRowId extends PretableRowId,
>(
  options: RuntimeCreateLocalRowModelOptions<TColumns, TRowId>,
): PretableRowModel<RowForColumns<TColumns>, TRowId, TColumns> {
  type TRow = RowForColumns<TColumns>;
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
  let queryPlan = compileQuery({
    derivations: requestedDerivations,
    query: requestedQuery,
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
  let snapshot = createFlatSnapshot(root);
  let state: PretableRowModelState<TRow, TRowId, TColumns> = Object.freeze({
    snapshot,
    status: READY,
  });
  let disposed = false;
  let activeMutation: PretableRowModelOperation | undefined;
  let nextSourceOrder = initialStore.records.length;
  let nextTransitionId = 1;
  const listeners = new Set<() => void>();
  const changeJournal = createChangeJournal<TRowId>(
    options.changeJournalCapacity,
  );

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
  const unavailable = (operation: PretableRowModelOperation): never => {
    assertCommandAllowed(operation);
    throw new PretableNotYetImplementedError(operation);
  };
  const commit = (next: RevisionRoot<TRow, TRowId, TColumns>): void => {
    root = next;
    snapshot = createFlatSnapshot(root);
    state = Object.freeze({ snapshot, status: READY });
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
        commit(
          Object.freeze({
            ...previousRoot,
            revision,
            parentRevision: previousRoot.revision,
            visible:
              groups === undefined
                ? previousRoot.visible
                : attachGroupIndex(previousRoot.visible.rows, groups),
            expansion,
          }),
        );
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
          });
          const pendingDiagnostics = drafted.diagnostics;
          if (drafted.sameReferenceMutation) {
            nextPlan = compileQuery({ derivations, query });
            drafted = replaceFlatRowsDraft({
              root: previousRoot,
              rows: nextRows,
              getRowId,
              queryPlan: nextPlan,
              nextSourceOrder,
              acceptSameReferenceMutation: true,
            });
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
          queryPlan = nextPlan;
          nextSourceOrder = drafted.nextSourceOrder;
          commit(committedRoot);
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
        nextSourceOrder = drafted.nextSourceOrder;
        commit(committedRoot);
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
        const previousRoot = root;
        const nextPlan = compileQuery({
          derivations,
          query: nextQuery,
          previous: queryPlan,
        });
        if (nextPlan === queryPlan) {
          return {
            transition: Object.freeze({
              id,
              requestedQuery: queryPlan.query,
              finished: Promise.resolve(previousRoot.revision),
              cancel: () => assertCommandAllowed("set-query"),
            }),
            notify: false,
          };
        }
        let store: ReturnType<
          typeof rebuildRowStoreForQuery<TRow, TRowId, TColumns>
        >;
        try {
          store = rebuildRowStoreForQuery(
            previousRoot.rows,
            previousRoot.sourceOrder,
            nextPlan,
          );
        } catch (error) {
          if (
            error instanceof PretableRowModelError &&
            error.operation !== "set-query"
          ) {
            throw new PretableRowModelError(error.code, error.message, {
              operation: "set-query",
              rowId: error.rowId,
              columnId: error.columnId,
              cause: error.cause,
            });
          }
          throw error;
        }
        const revision = previousRoot.revision + 1;
        const committedRoot: RevisionRoot<TRow, TRowId, TColumns> =
          Object.freeze({
            revision,
            parentRevision: previousRoot.revision,
            rows: store.rows,
            sourceOrder: store.sourceOrder,
            visible: createVisibleIndex(
              store.records,
              nextPlan,
              aggregateFilteredRows,
              previousRoot.expansion.overrides,
              "set-query",
              getGroupIndex(previousRoot.visible),
            ),
            queryPlan: nextPlan,
            expansion: previousRoot.expansion,
            cause: Object.freeze({ kind: "set-rows" as const }),
          });
        queryPlan = nextPlan;
        query = nextPlan.query;
        commit(committedRoot);
        changeJournal.appendBarrier(previousRoot.revision, revision);
        return {
          transition: Object.freeze({
            id,
            requestedQuery: nextPlan.query,
            finished: Promise.resolve(revision),
            cancel: () => assertCommandAllowed("set-query"),
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
          const id = nextTransitionId;
          const previousRoot = root;
          const nextPlan = compileQuery({
            derivations: nextDerivations,
            query,
            previous: queryPlan,
          });
          if (nextPlan === queryPlan) {
            nextTransitionId += 1;
            return {
              transition: Object.freeze({
                id,
                requestedDerivations: queryPlan.derivations,
                finished: Promise.resolve(previousRoot.revision),
                cancel: () => assertCommandAllowed("set-derivations"),
              }),
              notify: false,
            };
          }
          const store = rebuildRowStoreForQuery(
            previousRoot.rows,
            previousRoot.sourceOrder,
            nextPlan,
          );
          const revision = previousRoot.revision + 1;
          const committedRoot: RevisionRoot<TRow, TRowId, TColumns> =
            Object.freeze({
              revision,
              parentRevision: previousRoot.revision,
              rows: store.rows,
              sourceOrder: store.sourceOrder,
              visible: createVisibleIndex(
                store.records,
                nextPlan,
                aggregateFilteredRows,
                previousRoot.expansion.overrides,
                "set-derivations",
                getGroupIndex(previousRoot.visible),
              ),
              queryPlan: nextPlan,
              expansion: previousRoot.expansion,
              cause: Object.freeze({ kind: "set-rows" as const }),
            });
          queryPlan = nextPlan;
          derivations = nextPlan.derivations;
          commit(committedRoot);
          changeJournal.appendBarrier(previousRoot.revision, revision);
          nextTransitionId += 1;
          return {
            transition: Object.freeze({
              id,
              requestedDerivations: nextPlan.derivations,
              finished: Promise.resolve(revision),
              cancel: () => assertCommandAllowed("set-derivations"),
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
    distinctValues(): PretableDistinctValueQuery<never> {
      return unavailable("distinct-values");
    },
    dispose(): void {
      if (activeMutation !== undefined) {
        throw new PretableReentrantMutationError("dispose", activeMutation);
      }
      if (disposed) return;
      const current = guarded("dispose", () => {
        disposed = true;
        state = Object.freeze({ snapshot, status: DISPOSED });
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
  emitDiagnostics(initialStore.diagnostics, diagnosticSink);
  return model as unknown as PretableRowModel<TRow, TRowId, TColumns>;
}
