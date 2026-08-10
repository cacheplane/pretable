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
  const { captured, queryPlan, aggregateFilteredRows, operation } = options;
  let rows = createPersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>();
  let sourceOrder = captured.sourceOrder;
  let expansion = captured.expansion;
  let flatRows = createFlatVisibleTree<TRow, TRowId, TColumns>(
    queryPlan.compareRows as unknown as (
      left: RowRecord<TRow, TRowId, TColumns>["metadata"],
      right: RowRecord<TRow, TRowId, TColumns>["metadata"],
    ) => number,
  );
  let groups: GroupIndexRoot<TRow, TRowId, TColumns> | undefined =
    queryPlan.query.rowGroups.length === 0
      ? undefined
      : createGroupIndex(
          [],
          queryPlan,
          aggregateFilteredRows,
          createPersistentMap(),
          operation,
          getGroupIndex(captured.visible),
        );
  let iterator: Iterator<
    Readonly<{ readonly rowId: TRowId; readonly sourceOrder: number }>
  > | null = captured.sourceOrder.entries();
  const deltas: CooperativeTransitionDelta<TRow, TRowId, TColumns>[] = [];
  let deltaIndex = 0;
  let deltaRowIndex = 0;
  let completedRows = 0;
  let totalRows = captured.rows.size;
  let released = false;

  const removeRecord = (record: RowRecord<TRow, TRowId, TColumns>): void => {
    rows = rows.delete(record.rowId);
    if (groups === undefined) {
      flatRows = flatRows.remove(record.rowId);
    } else {
      groups = updateGroupIndex(groups, [record], [], undefined, operation);
    }
  };

  const insertRecord = (source: RowRecord<TRow, TRowId, TColumns>): void => {
    const metadata = queryPlan.evaluate({
      rowId: source.rowId,
      row: source.row as never,
      sourceOrder: source.sourceOrder,
    }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
    const record = Object.freeze({ ...source, metadata });
    rows = rows.set(record.rowId, record);
    if (groups === undefined) {
      if (metadata.filterPasses) flatRows = flatRows.insertOrReplace(record);
    } else {
      groups = updateGroupIndex(groups, [], [record], undefined, operation);
    }
  };

  const replayRow = (
    target: RevisionRoot<TRow, TRowId, TColumns>,
    rowId: TRowId,
  ): void => {
    const previous = rows.get(rowId);
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
      if (released) return;
      deltas.push(delta);
      totalRows += delta.affectedRowIds.length;
    },
    step() {
      if (released) return true;
      if (iterator !== null) {
        const source = iterator.next();
        if (!source.done) {
          const previous = captured.rows.get(source.value.rowId);
          if (previous !== undefined) insertRecord(previous);
          completedRows += 1;
          return false;
        }
        iterator = null;
      }

      while (deltaIndex < deltas.length) {
        const delta = deltas[deltaIndex]!;
        const rowId = delta.affectedRowIds[deltaRowIndex];
        if (rowId !== undefined) {
          replayRow(delta.target, rowId);
          deltaRowIndex += 1;
          completedRows += 1;
          return false;
        }
        sourceOrder = delta.target.sourceOrder;
        expansion = delta.target.expansion;
        deltaIndex += 1;
        deltaRowIndex = 0;
      }
      return true;
    },
    finish(revision) {
      if (released) throw new Error("Released transition candidate.");
      let visible: VisibleIndexRoot<TRow, TRowId, TColumns>;
      if (groups === undefined) {
        visible = Object.freeze({ rows: flatRows });
      } else {
        groups = updateGroupIndex(
          groups,
          [],
          [],
          expansion.overrides,
          operation,
        );
        visible = attachGroupIndex(flatRows, groups);
      }
      return Object.freeze({
        revision,
        parentRevision: revision - 1,
        rows,
        sourceOrder,
        visible,
        queryPlan,
        expansion,
        cause: Object.freeze({ kind: "set-rows" as const }),
      });
    },
    release() {
      if (released) return;
      released = true;
      iterator = null;
      deltas.length = 0;
      rows = createPersistentMap();
      flatRows = createFlatVisibleTree<TRow, TRowId, TColumns>(
        queryPlan.compareRows as never,
      );
      groups = undefined;
    },
  };
  return candidate;
}
