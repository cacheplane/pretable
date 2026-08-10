import type { CompiledQuery } from "./compiled-query";
import type { PretableRowId } from "./column-types";
import {
  attachGroupIndex,
  createGroupIndex,
  getGroupIndex,
  updateGroupIndex,
  type GroupIndexRoot,
} from "./group-index";
import type {
  RevisionRoot,
  RowRecord,
  VisibleIndexRoot,
} from "./internal-types";
import { createPersistentMap } from "./persistent/persistent-map";
import { createFlatVisibleTree } from "./visible-index";

export interface CooperativeTransitionScheduler {
  /** Queues one continuation and returns an idempotent cancellation hook. */
  schedule(task: () => void): () => void;
}

export interface CooperativeTransitionRuntime {
  readonly scheduler: CooperativeTransitionScheduler;
  readonly now: () => number;
  readonly budgetMs: number;
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

const DEFAULT_BUDGET_MS = 5;

interface BrowserScheduler {
  postTask(
    task: () => void,
    options?: { readonly signal?: AbortSignal },
  ): unknown;
}

function postTaskScheduler(postTask: BrowserScheduler["postTask"]) {
  return {
    schedule(task: () => void) {
      const controller =
        typeof AbortController === "function" ? new AbortController() : null;
      let cancelled = false;
      void Promise.resolve(
        postTask(task, controller ? { signal: controller.signal } : undefined),
      ).catch(() => {
        // Abort is the expected cancellation path. Scheduler failures do not
        // execute stale transition work or create an unhandled rejection.
      });
      return () => {
        if (cancelled) return;
        cancelled = true;
        controller?.abort();
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
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        if (!cancelled) task();
      };
      channel.port2.postMessage(undefined);
      return () => {
        if (cancelled) return;
        cancelled = true;
        channel.port1.close();
        channel.port2.close();
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

/** Resolves browser-preferred scheduling with a safe server/runtime fallback. */
export function createDefaultCooperativeTransitionScheduler(): CooperativeTransitionScheduler {
  try {
    const candidate = Reflect.get(globalThis as object, "scheduler") as
      BrowserScheduler | undefined;
    if (candidate && typeof candidate.postTask === "function") {
      return postTaskScheduler(candidate.postTask.bind(candidate));
    }
  } catch {
    // Host globals are not trusted; continue to the capability fallbacks.
  }
  return messageChannelScheduler() ?? timeoutScheduler();
}

export function createCooperativeTransitionRuntime(options: {
  readonly scheduler?: CooperativeTransitionScheduler;
  readonly now?: () => number;
  readonly budgetMs?: number;
}): CooperativeTransitionRuntime {
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) {
    throw new RangeError("The cooperative transition budget must be positive.");
  }
  return Object.freeze({
    scheduler:
      options.scheduler ?? createDefaultCooperativeTransitionScheduler(),
    now:
      options.now ??
      (() =>
        typeof performance === "object" &&
        performance !== null &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now()),
    budgetMs,
  });
}

/** Runs at least one unit and checks the budget after every completed unit. */
export function runCooperativeTransitionSlice(
  runtime: CooperativeTransitionRuntime,
  step: () => boolean,
): boolean {
  const startedAt = runtime.now();
  do {
    if (step()) return true;
  } while (runtime.now() - startedAt < runtime.budgetMs);
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
  /** Processes one row. Returns true only after initial build and catch-up. */
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
}): CooperativeTransitionCandidate<TRow, TRowId, TColumns> {
  const operation = options.operation;
  let retained:
    | {
        captured: RevisionRoot<TRow, TRowId, TColumns>;
        queryPlan: CompiledQuery<TColumns>;
        rows: RevisionRoot<TRow, TRowId, TColumns>["rows"];
        sourceOrder: RevisionRoot<TRow, TRowId, TColumns>["sourceOrder"];
        expansion: RevisionRoot<TRow, TRowId, TColumns>["expansion"];
        flatRows: VisibleIndexRoot<TRow, TRowId, TColumns>["rows"];
        groups: GroupIndexRoot<TRow, TRowId, TColumns> | undefined;
        iterator: Iterator<
          Readonly<{ readonly rowId: TRowId; readonly sourceOrder: number }>
        > | null;
        deltas: CooperativeTransitionDelta<TRow, TRowId, TColumns>[];
      }
    | undefined = {
    captured: options.captured,
    queryPlan: options.queryPlan,
    rows: createPersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>(),
    sourceOrder: options.captured.sourceOrder,
    expansion: options.captured.expansion,
    flatRows: createFlatVisibleTree<TRow, TRowId, TColumns>(
      options.queryPlan.compareRows as unknown as (
        left: RowRecord<TRow, TRowId, TColumns>["metadata"],
        right: RowRecord<TRow, TRowId, TColumns>["metadata"],
      ) => number,
    ),
    groups:
      options.queryPlan.query.rowGroups.length === 0
        ? undefined
        : createGroupIndex(
            [],
            options.queryPlan,
            options.aggregateFilteredRows,
            createPersistentMap(),
            operation,
            getGroupIndex(options.captured.visible),
          ),
    iterator: options.captured.sourceOrder.entries(),
    deltas: [],
  };
  // Candidate methods retain only the nullable state binding below. Clear the
  // input container so it cannot independently keep the captured root alive.
  options = undefined as never;
  let deltaIndex = 0;
  let deltaRowIndex = 0;
  let completedRows = 0;
  let totalRows = retained.captured.rows.size;
  let released = false;

  const removeRecord = (record: RowRecord<TRow, TRowId, TColumns>): void => {
    const state = retained;
    if (state === undefined) return;
    state.rows = state.rows.delete(record.rowId);
    if (state.groups === undefined) {
      state.flatRows = state.flatRows.remove(record.rowId);
    } else {
      state.groups = updateGroupIndex(
        state.groups,
        [record],
        [],
        undefined,
        operation,
      );
    }
  };

  const insertRecord = (source: RowRecord<TRow, TRowId, TColumns>): void => {
    const state = retained;
    if (state === undefined) return;
    const metadata = state.queryPlan.evaluate({
      rowId: source.rowId,
      row: source.row as never,
      sourceOrder: source.sourceOrder,
    }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
    const record = Object.freeze({ ...source, metadata });
    state.rows = state.rows.set(record.rowId, record);
    if (state.groups === undefined) {
      if (metadata.filterPasses) {
        state.flatRows = state.flatRows.insertOrReplace(record);
      }
    } else {
      state.groups = updateGroupIndex(
        state.groups,
        [],
        [record],
        undefined,
        operation,
      );
    }
  };

  const replayRow = (
    target: RevisionRoot<TRow, TRowId, TColumns>,
    rowId: TRowId,
  ): void => {
    const state = retained;
    if (state === undefined) return;
    const previous = state.rows.get(rowId);
    if (previous !== undefined) removeRecord(previous);
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
      state.deltas.push(delta);
      totalRows += delta.affectedRowIds.length;
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
      }

      while (deltaIndex < state.deltas.length) {
        const delta = state.deltas[deltaIndex]!;
        const rowId = delta.affectedRowIds[deltaRowIndex];
        if (rowId !== undefined) {
          replayRow(delta.target, rowId);
          deltaRowIndex += 1;
          completedRows += 1;
          return false;
        }
        state.sourceOrder = delta.target.sourceOrder;
        state.expansion = delta.target.expansion;
        deltaIndex += 1;
        deltaRowIndex = 0;
      }
      return true;
    },
    finish(revision) {
      const state = retained;
      if (state === undefined)
        throw new Error("Released transition candidate.");
      let visible: VisibleIndexRoot<TRow, TRowId, TColumns>;
      if (state.groups === undefined) {
        visible = Object.freeze({ rows: state.flatRows });
      } else {
        state.groups = updateGroupIndex(
          state.groups,
          [],
          [],
          state.expansion.overrides,
          operation,
        );
        visible = attachGroupIndex(state.flatRows, state.groups);
      }
      return Object.freeze({
        revision,
        parentRevision: revision - 1,
        rows: state.rows,
        sourceOrder: state.sourceOrder,
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
      state.deltas.length = 0;
      retained = undefined;
    },
  };
  candidateDiagnostics.set(candidate, () =>
    Object.freeze({
      released,
      hasCapturedRoot: retained !== undefined,
      hasQueryPlan: retained !== undefined,
      hasIterator: retained?.iterator !== null && retained !== undefined,
      deltaCount: retained?.deltas.length ?? 0,
      hasRows: retained !== undefined,
      hasSourceOrder: retained !== undefined,
      hasExpansion: retained !== undefined,
      hasFlatRows: retained !== undefined,
      hasGroups: retained?.groups !== undefined,
    }),
  );
  return candidate;
}
