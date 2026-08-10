import { compileQuery } from "./compiled-query";
import type {
  ColumnDescriptorOf,
  PretableDerivationsFor,
  PretableQueryFor,
  PretableRowId,
} from "./column-types";
import {
  PretableDisposedModelError,
  PretableRowModelError,
  type PretableRowModelOperation,
} from "./errors";
import type { ExpansionRoot, RevisionRoot, RowRecord } from "./internal-types";
import { createPersistentMap } from "./persistent/persistent-map";
import { buildRowStore } from "./row-store";
import type {
  PretableRowIntegrityDiagnostic,
  PretableRowIntegrityDiagnosticSink,
} from "./row-integrity";
import type {
  PretableDerivationTransition,
  PretableDistinctValueQuery,
  PretableExpansionDefault,
  PretableGroupId,
  PretableMutationResult,
  PretableQueryTransition,
  PretableRowModel,
  PretableRowModelState,
} from "./types";
import { createFlatSnapshot, createFlatVisibleIndex } from "./visible-index";

interface CreateLocalRowModelBaseOptions<
  TColumns,
  TRowId extends PretableRowId,
> {
  readonly rows: readonly RowForColumns<TColumns>[];
  readonly columns: TColumns;
  readonly derivations?: PretableDerivationsFor<TColumns>;
  readonly query?: PretableQueryFor<TColumns>;
  readonly initialExpansion?: PretableExpansionDefault;
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
): PretableMutationResult<TRowId> {
  return Object.freeze({
    previousRevision,
    revision,
    added: counts.added ?? 0,
    updated: counts.updated ?? 0,
    removed: counts.removed ?? 0,
    unchanged: counts.unchanged ?? 0,
    ignored: counts.ignored ?? 0,
    issues: Object.freeze([]),
  });
}

interface ReplacementCounts {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
}

function classifyReplacement<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  previous: RevisionRoot<TRow, TRowId, TColumns>,
  nextRecords: readonly RowRecord<TRow, TRowId, TColumns>[],
  sameReferenceMutationCount: number,
): ReplacementCounts {
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  const retained = new Set<TRowId>();
  nextRecords.forEach((record) => {
    const { row, rowId, sourceOrder } = record;
    retained.add(rowId);
    const old = previous.rows.get(rowId);
    if (old === undefined) added += 1;
    else if (Object.is(old.row, row) && old.sourceOrder === sourceOrder)
      unchanged += 1;
    else updated += 1;
  });
  let removed = 0;
  for (const [rowId] of previous.rows.entries()) {
    if (!retained.has(rowId)) removed += 1;
  }
  updated += sameReferenceMutationCount;
  unchanged -= sameReferenceMutationCount;
  return { added, updated, removed, unchanged };
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
  const derivations = queryPlan.derivations;
  const query = queryPlan.query;
  const diagnosticSink = options.onDiagnostic as
    PretableRowIntegrityDiagnosticSink<TRowId> | undefined;
  const initialStore = buildRowStore({
    rows: options.rows,
    getRowId,
    queryPlan,
    onDiagnostic: diagnosticSink,
  });
  let root: RevisionRoot<TRow, TRowId, TColumns> = Object.freeze({
    revision: 0,
    parentRevision: null,
    rows: initialStore.rows,
    sourceOrder: initialStore.sourceOrder,
    visible: createFlatVisibleIndex(
      initialStore.records,
      queryPlan.compareRows as unknown as (
        left: RowRecord<TRow, TRowId, TColumns>["metadata"],
        right: RowRecord<TRow, TRowId, TColumns>["metadata"],
      ) => number,
    ),
    queryPlan,
    expansion: createExpansionRoot(options.initialExpansion),
    cause: Object.freeze({ kind: "initial" as const }),
  });
  let snapshot = createFlatSnapshot(root);
  let state: PretableRowModelState<TRow, TRowId, TColumns> = Object.freeze({
    snapshot,
    status: READY,
  });
  let disposed = false;
  const listeners = new Set<() => void>();

  const assertActive = (operation: PretableRowModelOperation): void => {
    if (disposed) throw new PretableDisposedModelError(operation);
  };
  const unavailable = (operation: PretableRowModelOperation): never => {
    assertActive(operation);
    throw new PretableNotYetImplementedError(operation);
  };
  const publish = (next: RevisionRoot<TRow, TRowId, TColumns>): void => {
    root = next;
    snapshot = createFlatSnapshot(root);
    state = Object.freeze({ snapshot, status: READY });
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        // One consumer must not prevent the remaining subscribers from waking.
      }
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
      assertActive("set-rows");
      let nextPlan = queryPlan;
      let store = buildRowStore({
        rows: nextRows,
        getRowId,
        queryPlan: nextPlan,
        previous: root.rows,
        onDiagnostic: diagnosticSink,
      });
      const classified = classifyReplacement(
        root,
        store.records,
        store.sameReferenceMutationCount,
      );
      if (store.sameReferenceMutation) {
        nextPlan = compileQuery({ derivations, query });
        store = buildRowStore({
          rows: nextRows,
          getRowId,
          queryPlan: nextPlan,
          previous: root.rows,
        });
      }
      const noOp =
        classified.added === 0 &&
        classified.updated === 0 &&
        classified.removed === 0 &&
        !store.sameReferenceMutation;
      if (noOp) {
        return mutationResult(root.revision, root.revision, classified);
      }
      const previousRevision = root.revision;
      queryPlan = nextPlan;
      publish(
        Object.freeze({
          revision: previousRevision + 1,
          parentRevision: previousRevision,
          rows: store.rows,
          sourceOrder: store.sourceOrder,
          visible: createFlatVisibleIndex(
            store.records,
            queryPlan.compareRows as unknown as (
              left: RowRecord<TRow, TRowId, TColumns>["metadata"],
              right: RowRecord<TRow, TRowId, TColumns>["metadata"],
            ) => number,
          ),
          queryPlan,
          expansion: root.expansion,
          cause: Object.freeze({ kind: "set-rows" as const }),
        }),
      );
      return mutationResult(previousRevision, root.revision, classified);
    },
    applyTransaction() {
      return unavailable("apply-transaction");
    },
    setQuery(): PretableQueryTransition<TColumns> {
      return unavailable("set-query");
    },
    setDerivations(): PretableDerivationTransition<TColumns> {
      return unavailable("set-derivations");
    },
    setGroupExpanded() {
      return unavailable("set-group-expanded");
    },
    setExpansionDefault() {
      return unavailable("set-expansion-default");
    },
    expandAll() {
      return unavailable("expand-all");
    },
    collapseAll() {
      return unavailable("collapse-all");
    },
    changesSince() {
      return unavailable("changes-since");
    },
    distinctValues(): PretableDistinctValueQuery<never> {
      return unavailable("distinct-values");
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      state = Object.freeze({ snapshot, status: DISPOSED });
      const current = Array.from(listeners);
      listeners.clear();
      for (const listener of current) {
        try {
          listener();
        } catch {
          // Disposal still detaches and wakes every listener exactly once.
        }
      }
    },
  };

  return model as unknown as PretableRowModel<TRow, TRowId, TColumns>;
}
