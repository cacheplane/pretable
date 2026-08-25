import { filterVerdict, type CompiledQuery } from "./compiled-query";
import type { PretableRowId } from "./column-types";
import type { LocalRowModelInstrumentation } from "./diagnostics";
import {
  attachGroupIndex,
  createGroupIndex,
  createGroupIndexBuildDraft,
  getGroupIndex,
  setGroupOverride,
  updateGroupIndex,
  type GroupIndexBuildDraft,
  type GroupIndexRoot,
} from "./group-index";
import type {
  RevisionRoot,
  RowRecord,
  VisibleIndexRoot,
} from "./internal-types";
import {
  createPersistentMap,
  instrumentPersistentMap,
} from "./persistent/persistent-map";
import type { TransientMap } from "./persistent/transient";
import { instrumentOrderStatisticTree } from "./persistent/order-statistic-tree";
import { slotVectorFromEntries } from "./slot-vector";
import type { PretableGroupId } from "./types";
import { orderedRowEntry } from "./ordered-row-entry";
import { EMPTY_MEMBERSHIP } from "./membership-bitset";
import { createFlatVisibleTree, membershipFromFlatTree } from "./visible-index";

export interface CooperativeTransitionScheduler {
  /** Queues one continuation and returns an idempotent cancellation hook. */
  schedule(task: () => void): () => void;
}

export interface CooperativeTransitionRuntime {
  readonly scheduler: CooperativeTransitionScheduler;
  readonly now: () => number;
  readonly budgetMs: number;
  readonly maxUnitsPerSlice: number;
  readonly instrumentation?: LocalRowModelInstrumentation;
}

export interface CooperativeTransitionCandidateDiagnostics {
  readonly released: boolean;
  readonly hasCapturedRoot: boolean;
  readonly hasQueryPlan: boolean;
  readonly hasIterator: boolean;
  readonly deltaCount: number;
  readonly hasRows: boolean;
  readonly hasSourceOrder: boolean;
  readonly hasExpansion: boolean;
  readonly hasFlatRows: boolean;
  readonly hasGroups: boolean;
  readonly deltaSlotCount: number;
  readonly processedDeltaCount: number;
  readonly retainedDeltaRootCount: number;
  readonly overrideReconciliationRemaining: number;
}

const candidateDiagnostics = new WeakMap<
  object,
  () => CooperativeTransitionCandidateDiagnostics
>();

export function getCooperativeTransitionCandidateDiagnosticsForTesting(
  candidate: object,
): CooperativeTransitionCandidateDiagnostics {
  const read = candidateDiagnostics.get(candidate);
  if (read === undefined) {
    throw new TypeError(
      "Diagnostics require a cooperative transition candidate.",
    );
  }
  return read();
}

const DEFAULT_BUDGET_MS = 0.25;
// A clock may be coarse, mocked, or stalled. This cap guarantees a yield while
// keeping enough per-slice work to amortize scheduler overhead.
const DEFAULT_MAX_UNITS_PER_SLICE = 256;

interface BrowserScheduler {
  postTask(
    task: () => void,
    options?: { readonly signal?: AbortSignal },
  ): unknown;
}

function bestEffortCancel(cancel: (() => void) | undefined): void {
  try {
    cancel?.();
  } catch {
    // Scheduler cancellation is advisory infrastructure cleanup. It must not
    // interrupt the model-owned release and settlement that follows.
  }
}

function postTaskScheduler(
  postTask: BrowserScheduler["postTask"],
  fallback: CooperativeTransitionScheduler,
) {
  return {
    schedule(task: () => void) {
      const controller =
        typeof AbortController === "function" ? new AbortController() : null;
      let cancelled = false;
      let ran = false;
      let cancelFallback: (() => void) | undefined;
      const run = () => {
        if (cancelled || ran) return;
        ran = true;
        task();
      };
      const recover = () => {
        if (cancelled || ran || cancelFallback !== undefined) return;
        cancelFallback = fallback.schedule(run);
      };
      try {
        void Promise.resolve(
          postTask(run, controller ? { signal: controller.signal } : undefined),
        ).catch(recover);
      } catch {
        recover();
      }
      return () => {
        if (cancelled) return;
        cancelled = true;
        const cancel = cancelFallback;
        cancelFallback = undefined;
        try {
          controller?.abort();
        } catch {
          // A hostile AbortController is no more authoritative than the task.
        }
        bestEffortCancel(cancel);
      };
    },
  } satisfies CooperativeTransitionScheduler;
}

function messageChannelScheduler(): CooperativeTransitionScheduler | null {
  if (typeof MessageChannel !== "function") return null;
  return {
    schedule(task) {
      const channel = new MessageChannel();
      let cancelled = false;
      const close = () => {
        try {
          channel.port1.close();
        } catch {
          // Closing a host channel is best-effort cleanup.
        }
        try {
          channel.port2.close();
        } catch {
          // Closing a host channel is best-effort cleanup.
        }
      };
      channel.port1.onmessage = () => {
        close();
        if (!cancelled) task();
      };
      try {
        channel.port2.postMessage(undefined);
      } catch (error) {
        close();
        throw error;
      }
      return () => {
        if (cancelled) return;
        cancelled = true;
        close();
      };
    },
  };
}

function timeoutScheduler(): CooperativeTransitionScheduler {
  return {
    schedule(task) {
      const handle = setTimeout(task, 0);
      return () => clearTimeout(handle);
    },
  };
}

function fallbackScheduler(): CooperativeTransitionScheduler {
  const messageChannel = messageChannelScheduler();
  const timeout = timeoutScheduler();
  return {
    schedule(task) {
      if (messageChannel !== null) {
        try {
          return messageChannel.schedule(task);
        } catch {
          // A present but unusable MessageChannel must not strand the task.
        }
      }
      return timeout.schedule(task);
    },
  };
}

/** Resolves browser-preferred scheduling with a safe server/runtime fallback. */
export function createDefaultCooperativeTransitionScheduler(): CooperativeTransitionScheduler {
  const fallback = fallbackScheduler();
  try {
    const candidate = Reflect.get(globalThis as object, "scheduler") as
      BrowserScheduler | undefined;
    if (candidate && typeof candidate.postTask === "function") {
      return postTaskScheduler(candidate.postTask.bind(candidate), fallback);
    }
  } catch {
    // Host globals are not trusted; continue to the capability fallbacks.
  }
  return fallback;
}

export function createCooperativeTransitionRuntime(options: {
  readonly scheduler?: CooperativeTransitionScheduler;
  readonly now?: () => number;
  readonly budgetMs?: number;
  readonly maxUnitsPerSlice?: number;
  readonly instrumentation?: LocalRowModelInstrumentation;
}): CooperativeTransitionRuntime {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxUnitsPerSlice =
    options.maxUnitsPerSlice ?? DEFAULT_MAX_UNITS_PER_SLICE;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError("The cooperative transition budget must be positive.");
  }
  if (!Number.isSafeInteger(maxUnitsPerSlice) || maxUnitsPerSlice <= 0) {
    throw new RangeError(
      "The cooperative transition unit cap must be a positive safe integer.",
    );
  }
  const scheduler =
    options.scheduler ?? createDefaultCooperativeTransitionScheduler();
  const instrumentedScheduler: CooperativeTransitionScheduler | undefined =
    options.instrumentation === undefined
      ? undefined
      : {
          schedule(task) {
            const token = {};
            options.instrumentation!.scheduledCallbacks.add(token);
            let cancel: () => void;
            try {
              cancel = scheduler.schedule(() => {
                options.instrumentation!.scheduledCallbacks.delete(token);
                task();
              });
            } catch (error) {
              options.instrumentation!.scheduledCallbacks.delete(token);
              throw error;
            }
            return () => {
              options.instrumentation!.scheduledCallbacks.delete(token);
              bestEffortCancel(cancel);
            };
          },
        };
  return Object.freeze({
    scheduler: instrumentedScheduler ?? scheduler,
    now:
      options.now ??
      (() =>
        typeof performance === "object" &&
        performance !== null &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now()),
    budgetMs,
    maxUnitsPerSlice,
    instrumentation: options.instrumentation,
  });
}

/** Runs at least one unit and checks the budget after every completed unit. */
export function runCooperativeTransitionSlice(
  runtime: CooperativeTransitionRuntime,
  step: () => boolean,
): boolean {
  const startedAt = runtime.now();
  let completedUnits = 0;
  do {
    if (step()) {
      if (runtime.instrumentation !== undefined) {
        runtime.instrumentation.work.schedulerSliceDurations.push(
          Math.max(0, runtime.now() - startedAt),
        );
      }
      return true;
    }
    completedUnits += 1;
  } while (
    completedUnits < runtime.maxUnitsPerSlice &&
    runtime.now() - startedAt < runtime.budgetMs
  );
  if (runtime.instrumentation !== undefined) {
    runtime.instrumentation.work.schedulerSliceDurations.push(
      Math.max(0, runtime.now() - startedAt),
    );
  }
  return false;
}

export interface CooperativeTransitionDelta<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly target: RevisionRoot<TRow, TRowId, TColumns>;
  readonly affectedRowIds: readonly TRowId[];
}

export interface CooperativeTransitionCandidate<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly completedRows: number;
  readonly totalRows: number;
  append(delta: CooperativeTransitionDelta<TRow, TRowId, TColumns>): void;
  /** Processes one cooperative unit. Returns true only after build/catch-up. */
  step(): boolean;
  finish(revision: number): RevisionRoot<TRow, TRowId, TColumns>;
  release(): void;
}

/**
 * Builds against an immutable source root and replays exact live-row deltas.
 * Nothing reachable here is published before `finish` returns the swap root.
 */
export function createCooperativeTransitionCandidate<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(options: {
  readonly captured: RevisionRoot<TRow, TRowId, TColumns>;
  readonly queryPlan: CompiledQuery<TColumns>;
  readonly aggregateFilteredRows: boolean;
  readonly operation: "set-query" | "set-derivations";
  readonly instrumentation?: LocalRowModelInstrumentation;
}): CooperativeTransitionCandidate<TRow, TRowId, TColumns> {
  const operation = options.operation;
  const instrumentation = options.instrumentation;
  const grouped = options.queryPlan.query.rowGroups.length > 0;
  const builtinAggregatesOnly = (
    options.queryPlan.derivations as unknown as readonly {
      readonly aggregate?: unknown;
    }[]
  ).every(
    (derivation) =>
      derivation.aggregate === undefined ||
      typeof derivation.aggregate === "string",
  );
  const useBulkGroupBuilder = grouped && builtinAggregatesOnly;
  const initialRows = instrumentPersistentMap(
    createPersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>(),
    instrumentation,
  );
  let retained:
    | {
        captured: RevisionRoot<TRow, TRowId, TColumns>;
        queryPlan: CompiledQuery<TColumns>;
        rows: RevisionRoot<TRow, TRowId, TColumns>["rows"];
        rowBuilder:
          TransientMap<TRowId, RowRecord<TRow, TRowId, TColumns>> | undefined;
        sourceOrder: RevisionRoot<TRow, TRowId, TColumns>["sourceOrder"];
        expansion: RevisionRoot<TRow, TRowId, TColumns>["expansion"];
        flatRows: VisibleIndexRoot<TRow, TRowId, TColumns>["rows"];
        /**
         * Slot-indexed records, as a PLAIN MUTABLE array: nothing here is
         * reachable outside the candidate until `finish` chunks it into the
         * published root's immutable vector, so per-step writes are O(1)
         * instead of a COW chunk copy per slice.
         */
        recordsBySlot: Array<RowRecord<TRow, TRowId, TColumns> | undefined>;
        /**
         * The slot-space size for the root `finish` will publish. Seeded from
         * the CAPTURED root's self-described capacity and widened only by
         * replayed delta targets' capacities — never read from the live
         * allocator, so growth after capture cannot leak into this build's
         * domain.
         */
        slotCapacity: number;
        groups: GroupIndexRoot<TRow, TRowId, TColumns> | undefined;
        groupBuilder: GroupIndexBuildDraft<TRow, TRowId, TColumns> | undefined;
        groupSealRemaining: number;
        iterator: Iterator<
          Readonly<{ readonly rowId: TRowId; readonly sourceOrder: number }>
        > | null;
        deltas: Array<CooperativeTransitionDelta<
          TRow,
          TRowId,
          TColumns
        > | null>;
        appliedOverrides: RevisionRoot<
          TRow,
          TRowId,
          TColumns
        >["expansion"]["overrides"];
        reconciledExpansion:
          RevisionRoot<TRow, TRowId, TColumns>["expansion"] | undefined;
        overrideReconciliation:
          | {
              phase: "remove" | "apply";
              removalIterator: Iterator<readonly [PretableGroupId, boolean]>;
              desiredIterator: Iterator<readonly [PretableGroupId, boolean]>;
              remaining: number;
            }
          | undefined;
      }
    | undefined = {
    captured: options.captured,
    queryPlan: options.queryPlan,
    rows: initialRows,
    rowBuilder: useBulkGroupBuilder ? initialRows.asTransient() : undefined,
    sourceOrder: options.captured.sourceOrder,
    expansion: options.captured.expansion,
    flatRows: instrumentOrderStatisticTree(
      createFlatVisibleTree<TRow, TRowId, TColumns>(options.queryPlan),
      instrumentation,
    ),
    recordsBySlot: [],
    slotCapacity: options.captured.slotCapacity,
    groups:
      grouped && !useBulkGroupBuilder
        ? createGroupIndex(
            [],
            options.queryPlan,
            options.aggregateFilteredRows,
            createPersistentMap(),
            operation,
            getGroupIndex(options.captured.visible),
            instrumentation,
          )
        : undefined,
    groupBuilder: !useBulkGroupBuilder
      ? undefined
      : createGroupIndexBuildDraft({
          queryPlan: options.queryPlan,
          aggregateFilteredRows: options.aggregateFilteredRows,
          operation,
          reusable: getGroupIndex(options.captured.visible),
          overrides: options.captured.expansion.overrides,
          instrumentation,
        }),
    groupSealRemaining: 0,
    iterator: options.captured.sourceOrder.entries(),
    deltas: [],
    appliedOverrides: createPersistentMap(),
    reconciledExpansion: undefined,
    overrideReconciliation: undefined,
  };
  // Candidate methods retain only the nullable state binding below. Clear the
  // input container so it cannot independently keep the captured root alive.
  options = undefined as never;
  let deltaIndex = 0;
  let deltaRowIndex = 0;
  let deltaRowPhase: "remove" | "insert" = "remove";
  let completedRows = 0;
  let totalRows = retained.captured.rows.size;
  let released = false;

  const resetOverrideReconciliation = (
    state: Exclude<typeof retained, undefined>,
  ): void => {
    if (state.overrideReconciliation !== undefined) {
      totalRows -= state.overrideReconciliation.remaining;
      state.overrideReconciliation = undefined;
    }
    state.reconciledExpansion = undefined;
  };

  const reconcileGroupOverride = (
    state: Exclude<typeof retained, undefined>,
    groupId: PretableGroupId,
    desired: boolean | undefined,
  ): void => {
    const group = state.groups?.groups.get(groupId);
    if (group === undefined) {
      state.appliedOverrides = state.appliedOverrides.delete(groupId);
      return;
    }
    if (group.override !== desired) {
      state.groups = setGroupOverride(
        state.groups!,
        groupId,
        desired,
        operation,
      );
    }
    state.appliedOverrides =
      desired === undefined
        ? state.appliedOverrides.delete(groupId)
        : state.appliedOverrides.set(groupId, desired);
  };

  const reconcileOneOverride = (
    state: Exclude<typeof retained, undefined>,
  ): boolean => {
    if (state.groups === undefined) {
      state.reconciledExpansion = state.expansion;
      return true;
    }
    if (state.reconciledExpansion === state.expansion) return true;
    let reconciliation = state.overrideReconciliation;
    if (reconciliation === undefined) {
      const remaining =
        state.appliedOverrides.size + state.expansion.overrides.size;
      reconciliation = {
        phase: "remove",
        removalIterator: state.appliedOverrides.entries(),
        desiredIterator: state.expansion.overrides.entries(),
        remaining,
      };
      state.overrideReconciliation = reconciliation;
      totalRows += remaining;
    }

    while (reconciliation.phase === "remove") {
      const next = reconciliation.removalIterator.next();
      if (next.done) {
        reconciliation.phase = "apply";
        break;
      }
      const [groupId] = next.value;
      reconcileGroupOverride(
        state,
        groupId,
        state.expansion.overrides.get(groupId),
      );
      reconciliation.remaining -= 1;
      completedRows += 1;
      return false;
    }

    const next = reconciliation.desiredIterator.next();
    if (!next.done) {
      const [groupId, expanded] = next.value;
      reconcileGroupOverride(state, groupId, expanded);
      reconciliation.remaining -= 1;
      completedRows += 1;
      return false;
    }
    state.overrideReconciliation = undefined;
    state.reconciledExpansion = state.expansion;
    return true;
  };

  const removeRecord = (record: RowRecord<TRow, TRowId, TColumns>): void => {
    const state = retained;
    if (state === undefined) return;
    state.rows = state.rows.delete(record.rowId);
    state.recordsBySlot[record.slot] = undefined;
    if (state.groups === undefined) {
      state.flatRows = state.flatRows.remove(record.rowId);
    } else {
      state.groups = updateGroupIndex(
        state.groups,
        [record],
        [],
        undefined,
        operation,
        instrumentation,
      );
    }
  };

  const insertRecord = (source: RowRecord<TRow, TRowId, TColumns>): void => {
    const state = retained;
    if (state === undefined) return;
    if (instrumentation !== undefined) {
      instrumentation.work.transitionRows += 1;
      instrumentation.work.rowsEvaluated += 1;
    }
    const metadata = state.queryPlan.evaluate({
      rowId: source.rowId,
      row: source.row as never,
      sourceOrder: source.sourceOrder,
      slot: source.slot,
    }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
    const record = Object.freeze({ ...source, metadata });
    if (state.rowBuilder !== undefined)
      state.rowBuilder.set(record.rowId, record);
    else state.rows = state.rows.set(record.rowId, record);
    state.recordsBySlot[record.slot] = record;
    if (state.groupBuilder !== undefined) {
      state.groupBuilder.insert(record);
    } else if (state.groups === undefined) {
      // Computed here, used here: the flat tree this inserts into is where
      // the verdict is recorded.
      if (filterVerdict(state.queryPlan, record as never)) {
        state.flatRows = state.flatRows.insertOrReplace(
          orderedRowEntry(state.queryPlan, record),
        );
      }
    } else {
      state.groups = updateGroupIndex(
        state.groups,
        [],
        [record],
        undefined,
        operation,
        instrumentation,
      );
    }
  };

  const removeReplayRow = (rowId: TRowId): void => {
    const state = retained;
    if (state === undefined) return;
    const previous = state.rows.get(rowId);
    if (previous !== undefined) removeRecord(previous);
  };

  const insertReplayRow = (
    target: RevisionRoot<TRow, TRowId, TColumns>,
    rowId: TRowId,
  ): void => {
    if (retained === undefined) return;
    const next = target.rows.get(rowId);
    if (next !== undefined) insertRecord(next);
  };

  const candidate: CooperativeTransitionCandidate<TRow, TRowId, TColumns> = {
    get completedRows() {
      return completedRows;
    },
    get totalRows() {
      return totalRows;
    },
    append(delta) {
      const state = retained;
      if (state === undefined) return;
      resetOverrideReconciliation(state);
      state.deltas.push(delta);
      // Capacity is monotone across commits, so the widest replayed target
      // bounds every slot this candidate can ever bind (still a captured
      // root's value — the live allocator is never consulted).
      state.slotCapacity = Math.max(
        state.slotCapacity,
        delta.target.slotCapacity,
      );
      totalRows += delta.affectedRowIds.length * 2 + 1;
    },
    step() {
      const state = retained;
      if (state === undefined) return true;
      if (state.iterator !== null) {
        const source = state.iterator.next();
        if (!source.done) {
          const previous = state.captured.rows.get(source.value.rowId);
          if (previous !== undefined) insertRecord(previous);
          completedRows += 1;
          return false;
        }
        state.iterator = null;
        if (state.groupBuilder !== undefined) {
          state.groupSealRemaining =
            state.groupBuilder.pendingFinalizationCount;
          totalRows += state.groupSealRemaining;
        }
      }

      if (state.groupBuilder !== undefined) {
        const builder = state.groupBuilder;
        const complete = builder.sealStep();
        if (state.groupSealRemaining > 0) {
          state.groupSealRemaining -= 1;
          completedRows += 1;
        }
        if (complete) {
          state.groups = builder.finish();
          builder.release();
          state.groupBuilder = undefined;
          state.rows = state.rowBuilder!.freeze();
          state.rowBuilder = undefined;
          state.appliedOverrides = state.captured.expansion.overrides;
          state.reconciledExpansion = state.captured.expansion;
        }
        return false;
      }

      while (deltaIndex < state.deltas.length) {
        const delta = state.deltas[deltaIndex];
        if (delta === null) {
          deltaIndex += 1;
          deltaRowIndex = 0;
          deltaRowPhase = "remove";
          continue;
        }
        const rowId = delta.affectedRowIds[deltaRowIndex];
        if (rowId !== undefined) {
          if (deltaRowPhase === "remove") {
            removeReplayRow(rowId);
            deltaRowPhase = "insert";
          } else {
            insertReplayRow(delta.target, rowId);
            deltaRowPhase = "remove";
            deltaRowIndex += 1;
          }
          completedRows += 1;
          return false;
        }
        state.sourceOrder = delta.target.sourceOrder;
        state.expansion = delta.target.expansion;
        resetOverrideReconciliation(state);
        state.deltas[deltaIndex] = null;
        deltaIndex += 1;
        deltaRowIndex = 0;
        deltaRowPhase = "remove";
        completedRows += 1;
        return false;
      }
      return reconcileOneOverride(state);
    },
    finish(revision) {
      const state = retained;
      if (state === undefined)
        throw new Error("Released transition candidate.");
      if (
        state.groupBuilder !== undefined ||
        (state.groups !== undefined &&
          state.reconciledExpansion !== state.expansion)
      ) {
        throw new Error("Transition expansion overrides are not reconciled.");
      }
      let visible: VisibleIndexRoot<TRow, TRowId, TColumns>;
      if (state.groups === undefined) {
        visible = Object.freeze({ rows: state.flatRows });
      } else {
        visible = attachGroupIndex(state.flatRows, state.groups);
      }
      const slotEntries: Array<
        readonly [number, RowRecord<TRow, TRowId, TColumns>]
      > = [];
      for (let slot = 0; slot < state.recordsBySlot.length; slot += 1) {
        const record = state.recordsBySlot[slot];
        if (record !== undefined) slotEntries.push([slot, record]);
      }
      return Object.freeze({
        revision,
        parentRevision: revision - 1,
        rows: state.rows,
        sourceOrder: state.sourceOrder,
        recordsBySlot: slotVectorFromEntries(slotEntries, state.slotCapacity),
        slotCapacity: state.slotCapacity,
        // Flat transitions built their membership into `flatRows`; index it
        // over the state's self-described capacity. Grouped transitions keep
        // answering from the group index — sentinel.
        visibleSlots:
          state.groups === undefined
            ? membershipFromFlatTree(state.flatRows, state.slotCapacity)
            : EMPTY_MEMBERSHIP,
        visible,
        queryPlan: state.queryPlan,
        expansion: state.expansion,
        cause: Object.freeze({ kind: operation }),
      });
    },
    release() {
      const state = retained;
      if (state === undefined) return;
      released = true;
      state.iterator = null;
      state.groupBuilder?.release();
      state.groupBuilder = undefined;
      state.rowBuilder = undefined;
      state.groupSealRemaining = 0;
      state.deltas.fill(null);
      state.deltas.length = 0;
      state.recordsBySlot.length = 0;
      state.overrideReconciliation = undefined;
      state.reconciledExpansion = undefined;
      retained = undefined;
    },
  };
  candidateDiagnostics.set(candidate, () =>
    Object.freeze({
      released,
      hasCapturedRoot: retained !== undefined,
      hasQueryPlan: retained !== undefined,
      hasIterator: retained?.iterator !== null && retained !== undefined,
      deltaCount:
        retained?.deltas.reduce(
          (count, delta) => count + (delta === null ? 0 : 1),
          0,
        ) ?? 0,
      hasRows: retained !== undefined,
      hasSourceOrder: retained !== undefined,
      hasExpansion: retained !== undefined,
      hasFlatRows: retained !== undefined,
      hasGroups:
        retained?.groups !== undefined || retained?.groupBuilder !== undefined,
      deltaSlotCount: retained?.deltas.length ?? 0,
      processedDeltaCount: retained === undefined ? 0 : deltaIndex,
      retainedDeltaRootCount:
        retained?.deltas.reduce(
          (count, delta) => count + (delta === null ? 0 : 1),
          0,
        ) ?? 0,
      overrideReconciliationRemaining:
        retained?.overrideReconciliation?.remaining ?? 0,
    }),
  );
  return candidate;
}
