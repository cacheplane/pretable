import type { ColumnDescriptorOf, PretableRowId } from "./column-types";
import { getCooperativeTransitionCandidateDiagnosticsForTesting } from "./cooperative-transition";
import {
  createLocalRowModel,
  getLocalRowModelActiveTransitionCandidateForTesting,
  getLocalRowModelChangeJournalDiagnosticsForTesting,
  registerLocalRowModelInstrumentationForTesting,
  type CreateLocalRowModelOptions,
  type CreateLocalRowModelWithDefaultIdOptions,
} from "./create-local-row-model";
import { getDistinctValueDiagnosticsForTesting } from "./distinct-values";
import type { PretableRowModel, PretableRowModelSnapshot } from "./types";

export interface LocalRowModelWorkDiagnostics {
  readonly rowsEvaluated: number;
  readonly hamtNodesCopied: number;
  readonly orderNodesCopied: number;
  /**
   * Immutable logical group nodes rebuilt on changed paths plus each immutable
   * node allocated by the measured group-order AVL, including rotations.
   */
  readonly groupNodesCopied: number;
  readonly aggregateMerges: number;
  readonly transitionRows: number;
  /** Sort-only rebuilds taken synchronously, bypassing the cooperative path. */
  readonly synchronousRebuilds: number;
  /** Total wall time inside synchronous sort-only rebuilds. */
  readonly synchronousRebuildMs: number;
  /** Filter-only rebuilds taken synchronously, bypassing the cooperative path. */
  readonly filterRebuilds: number;
  /** Rows whose filter verdict flipped (either direction) across those rebuilds. */
  readonly filterRowsFlipped: number;
  /** Flipped-in rows merged into the surviving visible order — the ONLY rows sorted. */
  readonly filterMergeSortedInsertions: number;
  /**
   * Total wall time inside synchronous filter-only rebuilds. Its own field —
   * not folded into `synchronousRebuildMs` — so sort and filter fast paths
   * stay separately attributable in bench traces.
   */
  readonly filterRebuildMs: number;
  /**
   * Bulk tree builds that derived `byId` from a base map (k edits) instead of
   * refilling it from the built entries (n inserts).
   */
  readonly bulkByIdDerived: number;
  /**
   * Bulk tree builds that skipped the n−1 strict-order verification on a
   * caller-supplied proof. Every other build still pays for it.
   */
  readonly bulkOrderVerificationsSkipped: number;
  /**
   * Plan changes that adopted the previous plan's evaluation cache wholesale
   * (by reference, zero per-row work) instead of refilling it. Only a
   * filter-only change qualifies, so this counts filter fast paths that took
   * the cheap route — one per rebuild, never per row.
   */
  readonly evaluationCacheAdoptions: number;
  /** Sort-key entries carried from a previous plan's store, per (row, column). */
  readonly sortKeyCarries: number;
  /** Sort-key entries produced by running an accessor, per (row, column). */
  readonly sortKeyEvaluations: number;
  readonly snapshotOutputRowsRead: number;
  readonly schedulerSliceDurations: readonly number[];
}

export interface LocalRowModelRetentionDiagnostics {
  readonly liveRevisionRootCount: number;
  readonly explicitlyRetainedSnapshotCount: number;
  readonly consumerJournalEntryCount: number;
  readonly transitionCandidateRootCount: number;
  readonly transitionDeltaRootCount: number;
  readonly distinctCacheEntryCount: number;
  readonly distinctDictionaryRootCount: number;
  readonly distinctProjectionRootCount: number;
  readonly scheduledCallbackCount: number;
}

export interface LocalRowModelDiagnosticSnapshot {
  readonly work: LocalRowModelWorkDiagnostics;
  readonly retention: LocalRowModelRetentionDiagnostics;
}

export interface LocalRowModelDiagnostics {
  read(): LocalRowModelDiagnosticSnapshot;
  resetWork(): void;
  /**
   * Explicitly includes this model's validated immutable snapshot root in the
   * ownership graph until the returned idempotent handle is released. Arbitrary
   * external JavaScript references cannot be observed and are not counted.
   */
  retainSnapshot(
    snapshot: PretableRowModelSnapshot<object, PretableRowId, unknown>,
  ): () => void;
}

type CounterName = Exclude<
  keyof LocalRowModelWorkDiagnostics,
  "schedulerSliceDurations"
>;

/** Internal recorder threaded only through explicitly instrumented models. */
export interface LocalRowModelInstrumentation {
  readonly work: Record<CounterName, number> & {
    schedulerSliceDurations: number[];
  };
  /** Snapshots created by this exact model, mapped to their immutable root. */
  readonly snapshotRoots: WeakMap<object, object>;
  /** Explicit diagnostic handles. External references are intentionally opaque. */
  readonly retainedSnapshots: Map<
    object,
    { readonly root: object; handleCount: number }
  >;
  readonly scheduledCallbacks: Set<object>;
  currentRevisionRoot: object | undefined;
  model: object | undefined;
}

function newInstrumentation(): LocalRowModelInstrumentation {
  return {
    work: {
      rowsEvaluated: 0,
      hamtNodesCopied: 0,
      orderNodesCopied: 0,
      groupNodesCopied: 0,
      aggregateMerges: 0,
      transitionRows: 0,
      synchronousRebuilds: 0,
      synchronousRebuildMs: 0,
      filterRebuilds: 0,
      filterRowsFlipped: 0,
      filterMergeSortedInsertions: 0,
      filterRebuildMs: 0,
      bulkByIdDerived: 0,
      bulkOrderVerificationsSkipped: 0,
      evaluationCacheAdoptions: 0,
      sortKeyCarries: 0,
      sortKeyEvaluations: 0,
      snapshotOutputRowsRead: 0,
      schedulerSliceDurations: [],
    },
    snapshotRoots: new WeakMap(),
    retainedSnapshots: new Map(),
    scheduledCallbacks: new Set(),
    currentRevisionRoot: undefined,
    model: undefined,
  };
}

function resetWork(instrumentation: LocalRowModelInstrumentation): void {
  for (const counter of [
    "rowsEvaluated",
    "hamtNodesCopied",
    "orderNodesCopied",
    "groupNodesCopied",
    "aggregateMerges",
    "transitionRows",
    "synchronousRebuilds",
    "synchronousRebuildMs",
    "filterRebuilds",
    "filterRowsFlipped",
    "filterMergeSortedInsertions",
    "filterRebuildMs",
    "bulkByIdDerived",
    "bulkOrderVerificationsSkipped",
    "evaluationCacheAdoptions",
    "sortKeyCarries",
    "sortKeyEvaluations",
    "snapshotOutputRowsRead",
  ] as const) {
    instrumentation.work[counter] = 0;
  }
  instrumentation.work.schedulerSliceDurations.length = 0;
}

function diagnosticHandle(
  instrumentation: LocalRowModelInstrumentation,
): LocalRowModelDiagnostics {
  return Object.freeze({
    read(): LocalRowModelDiagnosticSnapshot {
      const model = instrumentation.model;
      if (model === undefined)
        throw new Error("Instrumented model unavailable.");
      const journal = getLocalRowModelChangeJournalDiagnosticsForTesting(model);
      const distinct = getDistinctValueDiagnosticsForTesting(model);
      const candidate =
        getLocalRowModelActiveTransitionCandidateForTesting(model);
      const transition =
        candidate === undefined
          ? undefined
          : getCooperativeTransitionCandidateDiagnosticsForTesting(candidate);
      const liveRevisionRoots = new Set<object>();
      if (instrumentation.currentRevisionRoot !== undefined)
        liveRevisionRoots.add(instrumentation.currentRevisionRoot);
      for (const retained of instrumentation.retainedSnapshots.values())
        liveRevisionRoots.add(retained.root);
      return Object.freeze({
        work: Object.freeze({
          ...instrumentation.work,
          schedulerSliceDurations: Object.freeze([
            ...instrumentation.work.schedulerSliceDurations,
          ]),
        }),
        retention: Object.freeze({
          liveRevisionRootCount: liveRevisionRoots.size,
          explicitlyRetainedSnapshotCount:
            instrumentation.retainedSnapshots.size,
          consumerJournalEntryCount: journal.entryCount,
          transitionCandidateRootCount:
            transition?.hasCapturedRoot === true ? 1 : 0,
          transitionDeltaRootCount: transition?.retainedDeltaRootCount ?? 0,
          distinctCacheEntryCount: distinct.cacheEntryCount,
          distinctDictionaryRootCount:
            distinct.retainedDictionaryCount + distinct.buildingDictionaryCount,
          distinctProjectionRootCount: distinct.activeProjectionCount,
          scheduledCallbackCount: instrumentation.scheduledCallbacks.size,
        }),
      });
    },
    resetWork: () => resetWork(instrumentation),
    retainSnapshot(snapshot: object) {
      const root = instrumentation.snapshotRoots.get(snapshot);
      if (root === undefined) {
        throw new TypeError(
          "Diagnostics can retain only snapshots created by this model.",
        );
      }
      const existing = instrumentation.retainedSnapshots.get(snapshot);
      if (existing === undefined) {
        instrumentation.retainedSnapshots.set(snapshot, {
          root,
          handleCount: 1,
        });
      } else {
        existing.handleCount += 1;
      }
      let retained = true;
      return () => {
        if (!retained) return;
        retained = false;
        const current = instrumentation.retainedSnapshots.get(snapshot);
        if (current === undefined) return;
        current.handleCount -= 1;
        if (current.handleCount === 0)
          instrumentation.retainedSnapshots.delete(snapshot);
      };
    },
  });
}

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

export interface InstrumentedLocalRowModel<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly model: PretableRowModel<TRow, TRowId, TColumns>;
  readonly diagnostics: LocalRowModelDiagnostics;
}

export function createInstrumentedLocalRowModel<
  const TColumns extends readonly unknown[],
>(
  options: CreateLocalRowModelWithDefaultIdOptions<TColumns>,
): InstrumentedLocalRowModel<
  RowForColumns<TColumns>,
  DefaultRowId<TColumns>,
  TColumns
>;
export function createInstrumentedLocalRowModel<
  const TColumns extends readonly unknown[],
  const TRowId extends PretableRowId,
>(
  options: CreateLocalRowModelOptions<TColumns, TRowId>,
): InstrumentedLocalRowModel<RowForColumns<TColumns>, TRowId, TColumns>;
export function createInstrumentedLocalRowModel(
  options: object,
): InstrumentedLocalRowModel<object, PretableRowId, readonly unknown[]> {
  const instrumentation = newInstrumentation();
  const captured = { ...options };
  registerLocalRowModelInstrumentationForTesting(captured, instrumentation);
  const model = createLocalRowModel(captured as never) as PretableRowModel<
    object,
    PretableRowId,
    readonly unknown[]
  >;
  instrumentation.model = model;
  return Object.freeze({
    model,
    diagnostics: diagnosticHandle(instrumentation),
  });
}
