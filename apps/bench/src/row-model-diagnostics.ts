import type {
  PretableColumn,
  PretableQueryFor,
  PretableRowModel,
} from "@pretable/react";
import type {
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";
import {
  createInstrumentedLocalRowModel,
  type LocalRowModelDiagnosticSnapshot,
} from "@pretable-internal/row-model/diagnostics";
import {
  createLocalRowModel,
  PretableTransitionCancelledError,
} from "@pretable-internal/row-model";

import type {
  RowModelBenchSummary,
  RowModelQueryTransitionStatus,
  RowModelQueryTransitionSummary,
} from "./bench-types";
import {
  applyUpdatePlanToRows,
  checksumScenarioRows,
  type DeterministicUpdatePlan,
} from "./update-plan";

export const ROW_MODEL_BENCH_CONTROLLER_KEY =
  "__PRETABLE_ROW_MODEL_BENCH__" as const;

type BenchColumn = PretableColumn<ScenarioRow> & {
  readonly accessor: (row: ScenarioRow) => string | number;
  readonly value: (row: ScenarioRow) => string | number;
  readonly type: "text" | "number";
};

type BenchRowModel = PretableRowModel<
  ScenarioRow,
  string,
  readonly BenchColumn[]
>;

export interface RowModelDiagnosticsRead extends LocalRowModelDiagnosticSnapshot {
  readonly diagnosticsEnabled: true;
  readonly acceptedPatchCount: number;
  readonly commitDurationsMs: readonly number[];
  readonly rebuild: {
    readonly completed: boolean;
    readonly durationMs: number;
    readonly streamCommitsObserved: number;
    readonly interactionSamplesObserved: number;
    readonly sourceRowCountBefore: number;
    readonly sourceRowCountAfter: number;
    readonly groupCountBefore: number;
    readonly groupCountAfter: number;
  } | null;
}

export interface RowModelDiagnosticsController {
  readonly model: BenchRowModel;
  readonly columns: readonly BenchColumn[];
  readonly transitionBudgetMs: number | undefined;
  read(): RowModelDiagnosticsRead;
  resetWork(): void;
  applyNextSeededTransaction(): ReturnType<
    RowModelDiagnosticsController["model"]["applyTransaction"]
  >;
  startQueryCandidate(): ReturnType<
    RowModelDiagnosticsController["model"]["setQuery"]
  > | null;
  armNextQueryTransition(): void;
  disarmQueryTransition(): void;
  readQueryTransition(): RowModelQueryTransitionRead | null;
  cancelQueryCandidate(): void;
  startDistinctDictionary(
    columnId: string,
  ): ReturnType<RowModelDiagnosticsController["model"]["distinctValues"]>;
  cancelDistinctDictionary(): void;
  recordInteractionSample(sample?: {
    readonly scrollTop: number;
    readonly activeElement: string | null;
  }): void;
  churnRevisions(count: number): void;
  churnRetentionLimits(): Promise<void>;
  createRunSummary(): RowModelBenchSummary;
  dispose(): void;
}

export interface RowModelQueryTransitionRead extends RowModelQueryTransitionSummary {
  readonly startedAt: number;
  readonly completedAt: number | null;
}

interface QueryTransitionCapture {
  readonly token: object;
  readonly startedAt: number;
  completedAt: number | null;
  status: RowModelQueryTransitionStatus;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );
  return sorted[index] ?? 0;
}

function toQueryTransitionSummary(
  read: RowModelQueryTransitionRead | null,
): RowModelQueryTransitionSummary | null {
  if (read === null) return null;
  return Object.freeze({
    status: read.status,
    durationMs: read.durationMs,
    rowsEvaluated: read.rowsEvaluated,
    transitionRows: read.transitionRows,
    sliceCount: read.sliceCount,
    sliceTotalMs: read.sliceTotalMs,
    sliceP95Ms: read.sliceP95Ms,
    sliceMaxMs: read.sliceMaxMs,
    schedulerWaitCount: read.schedulerWaitCount,
    schedulerWaitTotalMs: read.schedulerWaitTotalMs,
    schedulerWaitP95Ms: read.schedulerWaitP95Ms,
    schedulerWaitMaxMs: read.schedulerWaitMaxMs,
    residualMs: read.residualMs,
    ...(read.preModelHandoffMs === undefined
      ? {}
      : { preModelHandoffMs: read.preModelHandoffMs }),
    ...(read.postModelSurfaceMs === undefined
      ? {}
      : { postModelSurfaceMs: read.postModelSurfaceMs }),
  });
}

export interface BenchRowModelOwner {
  readonly model: BenchRowModel;
  readonly diagnostics: RowModelDiagnosticsController | null;
  dispose(): void;
}

export interface CreateRowModelDiagnosticsControllerInput {
  readonly dataset: ScenarioDataset;
  readonly plan: DeterministicUpdatePlan;
  readonly columns?: readonly BenchColumn[];
  readonly now?: () => number;
  readonly changeJournalCapacity?: number;
  readonly distinctValueCacheCapacity?: number;
  readonly query?: PretableQueryFor<readonly BenchColumn[]>;
  readonly scheduler?: {
    schedule(task: () => void): () => void;
  };
  readonly transitionClock?: () => number;
  readonly transitionBudgetMs?: number;
}

export function createBenchModelColumns(
  dataset: Pick<ScenarioDataset, "columns">,
  grouped: boolean,
): readonly BenchColumn[] {
  return Object.freeze(
    dataset.columns.map((column) => {
      const accessor = (row: ScenarioRow) => row[column.id] ?? "";
      return Object.freeze({
        ...column,
        type: column.id === "col_3" ? ("number" as const) : ("text" as const),
        accessorKey: column.id,
        accessor,
        value: accessor,
        ...(grouped && column.id === "col_3"
          ? { aggregate: "sum" as const }
          : {}),
      });
    }),
  );
}

export function createBenchRowModelOwner(
  input: CreateRowModelDiagnosticsControllerInput & {
    readonly diagnostics: boolean;
  },
): BenchRowModelOwner {
  if (input.diagnostics) {
    const diagnostics = createRowModelDiagnosticsController(input);
    return Object.freeze({
      model: diagnostics.model,
      diagnostics,
      dispose: () => diagnostics.dispose(),
    });
  }
  const columns =
    input.columns ??
    createBenchModelColumns(input.dataset, input.plan.grouping !== null);
  const query =
    input.query ??
    ({
      filters: [],
      sort: input.plan.grouping?.sort ?? [],
      rowGroups: input.plan.grouping?.rowGroups ?? [],
    } as PretableQueryFor<typeof columns>);
  const model = createLocalRowModel({
    rows: input.dataset.rows,
    columns,
    getRowId: (row: ScenarioRow) => String(row.id ?? ""),
    query,
    initialExpansion: input.plan.grouping?.initialExpansion,
  } as never) as unknown as BenchRowModel;
  return Object.freeze({
    model,
    diagnostics: null,
    dispose: () => model.dispose(),
  });
}

export function createRowModelDiagnosticsController(
  input: CreateRowModelDiagnosticsControllerInput,
): RowModelDiagnosticsController {
  const now = input.now ?? (() => performance.now());
  const journalCapacity = input.changeJournalCapacity ?? 32;
  const distinctCapacity = input.distinctValueCacheCapacity ?? 4;
  const columns =
    input.columns ??
    createBenchModelColumns(input.dataset, input.plan.grouping !== null);
  const initialQuery =
    input.query ??
    ({
      filters: [],
      sort: input.plan.grouping?.sort ?? [],
      rowGroups: input.plan.grouping?.rowGroups ?? [],
    } as PretableQueryFor<typeof columns>);
  const instrumented = createInstrumentedLocalRowModel({
    rows: input.dataset.rows,
    columns,
    getRowId: (row: ScenarioRow) => String(row.id ?? ""),
    query: initialQuery,
    initialExpansion: input.plan.grouping?.initialExpansion,
    changeJournalCapacity: journalCapacity,
    distinctValueCacheCapacity: distinctCapacity,
    transitionScheduler: input.scheduler,
    transitionClock: input.transitionClock,
    transitionBudgetMs: input.transitionBudgetMs,
  } as never);
  // The private package and @pretable/core declarations carry distinct
  // compile-time brands, but this is the exact runtime implementation that
  // core re-exports. Keep the nominal bridge isolated at this bench-only seam.
  const rawModel = instrumented.model as unknown as BenchRowModel;
  const commitDurationsMs: number[] = [];
  let acceptedPatchCount = 0;
  let nextTick = 0;
  let activeTransition: ReturnType<typeof rawModel.setQuery> | null = null;
  let activeDistinct: ReturnType<typeof rawModel.distinctValues> | null = null;
  let previousInteractionSample: {
    readonly scrollTop: number;
    readonly activeElement: string | null;
  } | null = null;
  let disposed = false;
  let queryTransitionArmed = false;
  let queryTransitionCapture: QueryTransitionCapture | null = null;
  let retentionRevision = 0;
  const rowGroupValues = new Map<string, unknown>();
  const groupCounts = new Map<unknown, number>();
  if (input.plan.grouping !== null) {
    for (const row of input.dataset.rows) {
      const id = String(row.id ?? "");
      const group = row.col_1;
      rowGroupValues.set(id, group);
      groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    }
  }
  let rebuild: {
    startedAt: number;
    completedAt: number | null;
    streamCommitsObserved: number;
    interactionSamplesObserved: number;
    sourceRowCountBefore: number;
    sourceRowCountAfter: number;
    groupCountBefore: number;
    groupCountAfter: number;
  } | null = null;

  const timedApply: typeof rawModel.applyTransaction = (transaction) => {
    const rebuilding = rawModel.getState().status.kind === "rebuilding";
    const startedAt = now();
    const result = rawModel.applyTransaction(transaction);
    commitDurationsMs.push(Math.max(0, now() - startedAt));
    acceptedPatchCount +=
      (transaction.add?.length ?? 0) +
      (transaction.update?.length ?? 0) +
      (transaction.remove?.length ?? 0);
    if (rebuilding && rebuild !== null) rebuild.streamCommitsObserved += 1;
    if (input.plan.grouping !== null) {
      for (const update of transaction.update ?? []) {
        if (!("col_1" in update.changes)) continue;
        const previous = rowGroupValues.get(update.id);
        const next = update.changes.col_1;
        if (Object.is(previous, next)) continue;
        const previousCount = groupCounts.get(previous) ?? 0;
        if (previousCount <= 1) groupCounts.delete(previous);
        else groupCounts.set(previous, previousCount - 1);
        rowGroupValues.set(update.id, next);
        groupCounts.set(next, (groupCounts.get(next) ?? 0) + 1);
      }
    }
    return result;
  };
  const timedSetQuery: typeof rawModel.setQuery = (query) => {
    if (!queryTransitionArmed) return rawModel.setQuery(query);
    queryTransitionArmed = false;
    const capture: QueryTransitionCapture = {
      token: {},
      startedAt: now(),
      completedAt: null,
      status: "running",
    };
    queryTransitionCapture = capture;
    let transition: ReturnType<typeof rawModel.setQuery>;
    try {
      transition = rawModel.setQuery(query);
    } catch (error) {
      capture.completedAt = now();
      capture.status = "error";
      throw error;
    }
    void transition.finished.then(
      () => {
        if (queryTransitionCapture?.token !== capture.token) return;
        capture.completedAt = now();
        capture.status = "completed";
      },
      (error: unknown) => {
        if (queryTransitionCapture?.token !== capture.token) return;
        capture.completedAt = now();
        capture.status =
          error instanceof PretableTransitionCancelledError
            ? "cancelled"
            : "error";
      },
    );
    return transition;
  };
  const model = new Proxy(rawModel, {
    get(target, property, receiver) {
      if (property === "applyTransaction") return timedApply;
      if (property === "setQuery") return timedSetQuery;
      return Reflect.get(target, property, receiver);
    },
  }) as typeof rawModel;

  const applyNextSeededTransaction = () => {
    const tick = input.plan.ticks[nextTick];
    if (tick === undefined) {
      throw new RangeError("The deterministic update plan is exhausted.");
    }
    nextTick += 1;
    return timedApply({
      update: tick.patches.map((patch) => ({
        id: patch.id,
        changes: patch.changes,
      })),
    });
  };

  const startQueryCandidate = () => {
    if (input.plan.rebuild === null || activeTransition !== null) return null;
    const snapshot = rawModel.getState().snapshot;
    rebuild = {
      startedAt: now(),
      completedAt: null,
      streamCommitsObserved: 0,
      interactionSamplesObserved: 0,
      sourceRowCountBefore: snapshot.sourceRowCount,
      sourceRowCountAfter: snapshot.sourceRowCount,
      groupCountBefore: groupCounts.size,
      groupCountAfter: 0,
    };
    previousInteractionSample = null;
    activeTransition = rawModel.setQuery({
      ...snapshot.query,
      sort: input.plan.rebuild.sort,
    } as PretableQueryFor<typeof columns>);
    const transition = activeTransition;
    void transition.finished.then(
      () => {
        if (rebuild === null) return;
        const next = rawModel.getState().snapshot;
        rebuild.completedAt = now();
        rebuild.sourceRowCountAfter = next.sourceRowCount;
        rebuild.groupCountAfter = groupCounts.size;
        activeTransition = null;
      },
      () => {
        activeTransition = null;
      },
    );
    return transition;
  };

  const read = (): RowModelDiagnosticsRead => {
    const diagnostic = instrumented.diagnostics.read();
    return Object.freeze({
      diagnosticsEnabled: true as const,
      ...diagnostic,
      acceptedPatchCount,
      commitDurationsMs: Object.freeze([...commitDurationsMs]),
      rebuild:
        rebuild === null
          ? null
          : Object.freeze({
              completed: rebuild.completedAt !== null,
              durationMs: (rebuild.completedAt ?? now()) - rebuild.startedAt,
              streamCommitsObserved: rebuild.streamCommitsObserved,
              interactionSamplesObserved: rebuild.interactionSamplesObserved,
              sourceRowCountBefore: rebuild.sourceRowCountBefore,
              sourceRowCountAfter: rebuild.sourceRowCountAfter,
              groupCountBefore: rebuild.groupCountBefore,
              groupCountAfter: rebuild.groupCountAfter,
            }),
    });
  };

  const readQueryTransition = (): RowModelQueryTransitionRead | null => {
    const capture = queryTransitionCapture;
    if (capture === null) return null;
    const completedAt = capture.completedAt;
    const durationMs = Math.max(0, (completedAt ?? now()) - capture.startedAt);
    const work = instrumented.diagnostics.read().work;
    const sliceTotalMs = sum(work.schedulerSliceDurations);
    const schedulerWaitTotalMs = sum(work.schedulerWaitDurations);
    return Object.freeze({
      status: capture.status,
      startedAt: capture.startedAt,
      completedAt,
      durationMs,
      rowsEvaluated: work.rowsEvaluated,
      transitionRows: work.transitionRows,
      sliceCount: work.schedulerSliceDurations.length,
      sliceTotalMs,
      sliceP95Ms: percentile(work.schedulerSliceDurations, 0.95),
      sliceMaxMs: Math.max(0, ...work.schedulerSliceDurations),
      schedulerWaitCount: work.schedulerWaitDurations.length,
      schedulerWaitTotalMs,
      schedulerWaitP95Ms: percentile(work.schedulerWaitDurations, 0.95),
      schedulerWaitMaxMs: Math.max(0, ...work.schedulerWaitDurations),
      residualMs: Math.max(0, durationMs - sliceTotalMs - schedulerWaitTotalMs),
    });
  };

  const controller: RowModelDiagnosticsController = {
    model,
    columns,
    transitionBudgetMs: input.transitionBudgetMs,
    read,
    resetWork: instrumented.diagnostics.resetWork,
    armNextQueryTransition() {
      instrumented.diagnostics.resetWork();
      queryTransitionCapture = null;
      queryTransitionArmed = true;
    },
    disarmQueryTransition() {
      queryTransitionArmed = false;
      queryTransitionCapture = null;
    },
    readQueryTransition,
    applyNextSeededTransaction,
    startQueryCandidate,
    cancelQueryCandidate() {
      activeTransition?.cancel();
    },
    startDistinctDictionary(columnId) {
      activeDistinct = rawModel.distinctValues(columnId, {
        limit: 32,
      });
      void activeDistinct.finished.catch(() => undefined);
      return activeDistinct;
    },
    cancelDistinctDictionary() {
      activeDistinct?.cancel();
      activeDistinct = null;
    },
    recordInteractionSample(sample) {
      if (
        rawModel.getState().status.kind === "rebuilding" &&
        rebuild !== null &&
        sample !== undefined &&
        Number.isFinite(sample.scrollTop)
      ) {
        if (
          previousInteractionSample !== null &&
          (sample.scrollTop !== previousInteractionSample.scrollTop ||
            sample.activeElement !== previousInteractionSample.activeElement)
        ) {
          rebuild.interactionSamplesObserved += 1;
        }
        previousInteractionSample = sample;
      }
    },
    churnRevisions(count) {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new RangeError(
          "Revision churn count must be a non-negative integer.",
        );
      }
      const source = input.dataset.rows;
      if (source.length === 0) return;
      for (let index = 0; index < count; index += 1) {
        const row = source[0]!;
        retentionRevision += 1;
        timedApply({
          update: [
            {
              id: String(row.id ?? ""),
              changes: { col_0: `retention-${retentionRevision}` },
            },
          ],
        });
      }
    },
    async churnRetentionLimits() {
      controller.churnRevisions(journalCapacity + 2);
      for (const { id: columnId } of columns.slice(0, distinctCapacity + 1)) {
        await rawModel.distinctValues(columnId, { limit: 1 }).finished;
      }
    },
    createRunSummary() {
      const diagnostic = read();
      const actualRows = collectDataRows(rawModel);
      const finalChecksum = checksumScenarioRows(actualRows);
      const expectedFinalChecksum = checksumScenarioRows(
        applyUpdatePlanToRows(input.dataset.rows, input.plan),
      );
      const rebuildDiagnostic = diagnostic.rebuild;
      const responsive =
        rebuildDiagnostic !== null &&
        (rebuildDiagnostic.durationMs <= 50 ||
          (rebuildDiagnostic.streamCommitsObserved > 0 &&
            rebuildDiagnostic.interactionSamplesObserved > 0));
      return Object.freeze({
        diagnostics: true,
        updatePlanChecksum: input.plan.scheduleChecksum,
        acceptedPatchCount,
        checksumAcceptedPatchCount:
          finalChecksum === expectedFinalChecksum ? acceptedPatchCount : 0,
        finalChecksum,
        expectedFinalChecksum,
        queryTransition: toQueryTransitionSummary(readQueryTransition()),
        rebuild:
          rebuildDiagnostic === null
            ? null
            : Object.freeze({
                completed: rebuildDiagnostic.completed,
                responsive,
                durationMs: rebuildDiagnostic.durationMs,
                streamCommitsObserved: rebuildDiagnostic.streamCommitsObserved,
                interactionSamplesObserved:
                  rebuildDiagnostic.interactionSamplesObserved,
                sourceRowCountBefore: rebuildDiagnostic.sourceRowCountBefore,
                sourceRowCountAfter: rebuildDiagnostic.sourceRowCountAfter,
                groupCountBefore: rebuildDiagnostic.groupCountBefore,
                groupCountAfter: countVisibleGroups(
                  rawModel.getState().snapshot,
                ),
                expectedGroupCountAfter: groupCounts.size,
              }),
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      activeTransition?.cancel();
      activeDistinct?.cancel();
      rawModel.dispose();
    },
  };
  return Object.freeze(controller);
}

function countVisibleGroups(
  snapshot: ReturnType<BenchRowModel["getState"]>["snapshot"],
): number {
  let count = 0;
  for (let index = 0; index < snapshot.visibleRowCount; index += 1) {
    if (snapshot.rowAt(index)?.kind === "group") count += 1;
  }
  return count;
}

function collectDataRows(
  model: RowModelDiagnosticsController["model"],
): readonly ScenarioRow[] {
  const snapshot = model.getState().snapshot;
  const rows: ScenarioRow[] = [];
  for (let index = 0; index < snapshot.visibleRowCount; index += 1) {
    const visible = snapshot.rowAt(index);
    if (visible?.kind === "data") rows.push(visible.row);
  }
  return rows;
}
