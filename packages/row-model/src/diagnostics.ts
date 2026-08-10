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
  readonly groupNodesCopied: number;
  readonly aggregateMerges: number;
  readonly transitionRows: number;
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
  readonly retainedSnapshots: Set<object>;
  readonly scheduledCallbacks: Set<object>;
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
      snapshotOutputRowsRead: 0,
      schedulerSliceDurations: [],
    },
    retainedSnapshots: new Set(),
    scheduledCallbacks: new Set(),
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
      return Object.freeze({
        work: Object.freeze({
          ...instrumentation.work,
          schedulerSliceDurations: Object.freeze([
            ...instrumentation.work.schedulerSliceDurations,
          ]),
        }),
        retention: Object.freeze({
          liveRevisionRootCount: 1,
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
      instrumentation.retainedSnapshots.add(snapshot);
      let retained = true;
      return () => {
        if (!retained) return;
        retained = false;
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
