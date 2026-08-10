import {
  createRowHeightIndex,
  planViewport,
  type RowHeightAnchor,
  type RowHeightIndex,
  type RowHeightOperation,
  type RowHeightReplacementBuilder,
} from "@pretable-internal/layout-core";
import type {
  PretableChangeSequence,
  PretableRowId,
  PretableRowModelSnapshot,
  PretableVisibleRow,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import { estimateDomRowHeight } from "./create-renderer";
import {
  RowLayoutControllerError,
  type CreateRowLayoutControllerOptions,
  type RowLayoutController,
  type RowLayoutControllerState,
  type RowLayoutScheduler,
  type RowLayoutViewport,
  type RowLayoutWindowRow,
} from "./types";

const READY = Object.freeze({ kind: "ready" as const });
const DISPOSED = Object.freeze({ kind: "disposed" as const });
const DEFAULT_ROW_HEIGHT = 44;
const DEFAULT_BUDGET_MS = 5;
const DEFAULT_MAX_UNITS_PER_SLICE = 256;
const MAX_ESTIMATE_PLAN_PASSES = 256;

export interface RowLayoutControllerDiagnostics {
  readonly replacementSliceCount: number;
  readonly maxReplacementUnitsPerSlice: number;
  readonly scheduledCallbackCount: number;
  readonly retainedBuilderCount: number;
  readonly lastPublishedRangeRows: number;
  readonly anchorSearchUnits: number;
}

const controllerDiagnostics = new WeakMap<
  object,
  () => RowLayoutControllerDiagnostics
>();

/** Direct-module diagnostics seam; intentionally omitted from the barrel. */
export function getRowLayoutControllerDiagnosticsForTesting(
  controller: object,
): RowLayoutControllerDiagnostics {
  const read = controllerDiagnostics.get(controller);
  if (read === undefined) {
    throw new TypeError(
      "Diagnostics require an indexed row-layout controller.",
    );
  }
  return read();
}

export type { RowLayoutScheduler } from "./types";

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
    // Cancellation is advisory host cleanup; controller-owned roots still release.
  }
}

function timeoutScheduler(): RowLayoutScheduler {
  return {
    schedule(task) {
      const handle = setTimeout(task, 0);
      return () => clearTimeout(handle);
    },
  };
}

function defaultScheduler(): RowLayoutScheduler {
  const fallback = timeoutScheduler();
  try {
    const host = Reflect.get(globalThis as object, "scheduler") as
      BrowserScheduler | undefined;
    if (host && typeof host.postTask === "function") {
      const postTask = host.postTask.bind(host);
      return {
        schedule(task) {
          const controller =
            typeof AbortController === "function"
              ? new AbortController()
              : undefined;
          let cancelled = false;
          let ran = false;
          let fallbackCancel: (() => void) | undefined;
          const run = () => {
            if (cancelled || ran) return;
            ran = true;
            task();
          };
          const recover = () => {
            if (cancelled || ran || fallbackCancel !== undefined) return;
            fallbackCancel = fallback.schedule(run);
          };
          try {
            void Promise.resolve(
              postTask(
                run,
                controller ? { signal: controller.signal } : undefined,
              ),
            ).catch(recover);
          } catch {
            recover();
          }
          return () => {
            if (cancelled) return;
            cancelled = true;
            try {
              controller?.abort();
            } catch {
              // Host abort is best-effort too.
            }
            const cancel = fallbackCancel;
            fallbackCancel = undefined;
            bestEffortCancel(cancel);
          };
        },
      };
    }
  } catch {
    // Host capability access is not trusted.
  }
  return fallback;
}

function normalizeViewport(viewport: RowLayoutViewport): RowLayoutViewport {
  if (!Number.isFinite(viewport.scrollTop)) {
    throw new RangeError("Row-layout scrollTop must be finite.");
  }
  if (
    !Number.isFinite(viewport.viewportHeight) ||
    viewport.viewportHeight < 0
  ) {
    throw new RangeError(
      "Row-layout viewportHeight must be finite and non-negative.",
    );
  }
  return Object.freeze({
    scrollTop: Math.max(0, viewport.scrollTop),
    viewportHeight: viewport.viewportHeight,
    overscan:
      Number.isFinite(viewport.overscan) && viewport.overscan > 0
        ? Math.floor(viewport.overscan)
        : 0,
  });
}

function rowRef<TRowId extends PretableRowId, TRow extends object, TColumns>(
  row: PretableVisibleRow<TRow, TRowId, TColumns>,
): PretableVisibleRowRef<TRowId> {
  return row.kind === "data"
    ? Object.freeze({ kind: "data" as const, rowId: row.rowId })
    : Object.freeze({ kind: "group" as const, groupId: row.groupId });
}

function identityOf<TRowId extends PretableRowId>(
  ref: PretableVisibleRowRef<TRowId>,
): string {
  if (ref.kind === "group") {
    return `g:${ref.groupId.length}:${ref.groupId}`;
  }
  return typeof ref.rowId === "number"
    ? `d:n:${Object.is(ref.rowId, -0) ? 0 : ref.rowId}`
    : `d:s:${ref.rowId.length}:${ref.rowId}`;
}

function sameRef<TRowId extends PretableRowId>(
  left: PretableVisibleRowRef<TRowId>,
  right: PretableVisibleRowRef<TRowId>,
): boolean {
  return identityOf(left) === identityOf(right);
}

function validateRuntime(options: {
  readonly budgetMs: number;
  readonly maxUnitsPerSlice: number;
}): void {
  if (!Number.isFinite(options.budgetMs) || options.budgetMs <= 0) {
    throw new RangeError("Row-layout cooperative budget must be positive.");
  }
  if (
    !Number.isSafeInteger(options.maxUnitsPerSlice) ||
    options.maxUnitsPerSlice <= 0
  ) {
    throw new RangeError(
      "Row-layout cooperative unit cap must be a positive safe integer.",
    );
  }
}

interface CapturedAnchor<TRowId extends PretableRowId> {
  readonly heightAnchor: RowHeightAnchor<PretableVisibleRowRef<TRowId>>;
  readonly oldSnapshot: PretableRowModelSnapshot<object, TRowId, unknown>;
  readonly oldIndex: number;
}

interface ActiveReplacement<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly token: object;
  readonly target: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  readonly builder: RowHeightReplacementBuilder<PretableVisibleRowRef<TRowId>>;
  anchor: CapturedAnchor<TRowId> | undefined;
  cancelScheduled: (() => void) | undefined;
  candidate: RowHeightIndex<PretableVisibleRowRef<TRowId>> | undefined;
  searchDistance: number;
  searchPrevious: boolean;
}

export function createRowLayoutController<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  options: CreateRowLayoutControllerOptions<TRow, TRowId, TColumns>,
): RowLayoutController<TRow, TRowId, TColumns> {
  const scheduler = options.scheduler ?? defaultScheduler();
  const now = options.now ?? (() => performance.now());
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const maxUnitsPerSlice = Math.min(
    256,
    options.maxUnitsPerSlice ?? DEFAULT_MAX_UNITS_PER_SLICE,
  );
  validateRuntime({ budgetMs, maxUnitsPerSlice });
  let viewport = normalizeViewport(options.viewport);
  const defaultRowHeight = options.defaultRowHeight ?? DEFAULT_ROW_HEIGHT;
  const rawEstimate =
    options.estimateRowHeight ??
    ((row: TRow) => estimateDomRowHeight(row, options.columns));
  const estimate = (row: TRow): number => {
    const height = rawEstimate(row);
    if (!Number.isFinite(height) || height <= 0) {
      throw new RangeError(
        "Estimated row height must be a finite number greater than zero.",
      );
    }
    return Math.max(defaultRowHeight, height);
  };
  const listeners = new Set<() => void>();
  let disposed = false;
  let notifying = false;
  let projecting = false;
  let drainingActions = false;
  let synchronizing = false;
  let synchronizeAgain = false;
  const queuedActions: Array<() => void> = [];
  let active: ActiveReplacement<TRow, TRowId, TColumns> | undefined;
  let stagedRowHeights:
    RowHeightIndex<PretableVisibleRowRef<TRowId>> | undefined;
  let replacementSliceCount = 0;
  let maxReplacementUnitsPerSlice = 0;
  let scheduledCallbackCount = 0;
  let lastPublishedRangeRows = 0;
  let anchorSearchUnits = 0;
  let deferredViewportWithoutAnchor = false;
  let unsubscribeModel: (() => void) | undefined;
  let detachModelWhenAvailable = false;
  const initialModelState = options.model.getState();
  let unreadInitialModelState: typeof initialModelState | undefined =
    initialModelState;

  const empty = createRowHeightIndex<PretableVisibleRowRef<TRowId>>({
    defaultHeight: defaultRowHeight,
    getKey: identityOf,
    maxRetainedMeasurements: options.maxRetainedMeasurements,
  });
  let state: RowLayoutControllerState<TRow, TRowId, TColumns> = Object.freeze({
    observedRevision: null,
    snapshot: null,
    rowHeights: empty,
    viewport,
    scrollTop: viewport.scrollTop,
    range: Object.freeze({ start: 0, end: 0 }),
    window: Object.freeze([]),
    status: Object.freeze({
      kind: "rebuilding" as const,
      targetRevision: initialModelState.snapshot.revision,
    }),
  });

  const notify = (): void => {
    notifying = true;
    try {
      for (const listener of Array.from(listeners)) {
        try {
          listener();
        } catch {
          // An external-store listener cannot prevent other subscribers or commits.
        }
      }
    } finally {
      notifying = false;
    }
    drainActions();
  };

  const drainActions = (): void => {
    if (notifying || drainingActions || synchronizing || disposed) return;
    drainingActions = true;
    try {
      while (queuedActions.length > 0 && !disposed) {
        try {
          queuedActions.shift()!();
        } catch {
          // A command issued by a listener has no synchronous error channel
          // after that listener returns. Isolate it like the listener itself
          // and continue later FIFO commands/model catch-up.
        }
      }
      if (synchronizeAgain && !disposed) synchronize();
    } finally {
      drainingActions = false;
    }
    if ((queuedActions.length > 0 || synchronizeAgain) && !disposed) {
      drainActions();
    }
  };

  const publishError = (
    code: RowLayoutControllerError["code"],
    message: string,
    cause: unknown,
  ): void => {
    if (disposed) return;
    state = Object.freeze({
      ...state,
      status: Object.freeze({
        kind: "error" as const,
        error: new RowLayoutControllerError(code, message, cause),
      }),
    });
    notify();
  };

  const cancelActive = (): void => {
    const replacement = active;
    if (replacement === undefined) return;
    active = undefined;
    const cancel = replacement.cancelScheduled;
    replacement.cancelScheduled = undefined;
    scheduledCallbackCount = Math.max(
      0,
      scheduledCallbackCount - (cancel ? 1 : 0),
    );
    bestEffortCancel(cancel);
    replacement.builder.cancel();
    replacement.candidate = undefined;
  };

  const rollbackDeferredViewport = (): void => {
    if (!deferredViewportWithoutAnchor) return;
    viewport = state.viewport;
    deferredViewportWithoutAnchor = false;
  };

  const prepareWindow = (
    snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
    initialRoot: RowHeightIndex<PretableVisibleRowRef<TRowId>>,
    requestedViewport: RowLayoutViewport,
    scrollTop: number,
  ): {
    readonly root: RowHeightIndex<PretableVisibleRowRef<TRowId>>;
    readonly range: { readonly start: number; readonly end: number };
    readonly window: readonly RowLayoutWindowRow<TRow, TRowId, TColumns>[];
  } => {
    let root = initialRoot;
    const estimated = new Set<string>();
    for (let pass = 0; pass < MAX_ESTIMATE_PLAN_PASSES; pass += 1) {
      const plan = planViewport({
        scrollTop,
        viewportHeight: requestedViewport.viewportHeight,
        overscan: requestedViewport.overscan,
        rowMetrics: root,
      });
      const rows = snapshot.range(plan.range.start, plan.range.end);
      if (rows.length !== plan.range.end - plan.range.start) {
        throw new RowLayoutControllerError(
          "layout-failed",
          "The row-model range did not match its published visible count.",
        );
      }
      const estimates: RowHeightOperation<PretableVisibleRowRef<TRowId>>[] = [];
      for (let offset = 0; offset < rows.length; offset += 1) {
        const row = rows[offset]!;
        const ref = rowRef(row);
        const index = plan.range.start + offset;
        const indexedRef = root.keyAt(index);
        if (indexedRef === undefined || !sameRef(indexedRef, ref)) {
          throw new RowLayoutControllerError(
            "layout-failed",
            "The model snapshot and height root disagree about visible identity.",
          );
        }
        const identity = identityOf(ref);
        if (
          row.kind === "data" &&
          !root.hasMeasurement(ref) &&
          !estimated.has(identity)
        ) {
          estimated.add(identity);
          estimates.push({
            kind: "update",
            ref,
            index,
            estimatedHeight: estimate(row.row),
          });
        }
      }
      if (estimates.length > 0) {
        const estimatedRoot = root.apply(estimates);
        if (estimatedRoot !== root) {
          root = estimatedRoot;
          continue;
        }
      }
      const window = plan.rows.map((geometry, offset) =>
        Object.freeze({
          ...geometry,
          ref: rowRef(rows[offset]!),
          row: rows[offset]!,
        }),
      );
      return {
        root,
        range: Object.freeze({ ...plan.range }),
        window: Object.freeze(window),
      };
    }
    throw new RowLayoutControllerError(
      "layout-failed",
      `Row-height estimation did not converge within ${MAX_ESTIMATE_PLAN_PASSES} viewport plans.`,
    );
  };

  const publishReady = (
    snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
    root: RowHeightIndex<PretableVisibleRowRef<TRowId>>,
    scrollTop: number,
  ): void => {
    projecting = true;
    try {
      const prepared = prepareWindow(snapshot, root, viewport, scrollTop);
      lastPublishedRangeRows = prepared.window.length;
      state = Object.freeze({
        observedRevision: snapshot.revision,
        snapshot,
        rowHeights: prepared.root,
        viewport,
        scrollTop,
        range: prepared.range,
        window: prepared.window,
        status: READY,
      });
    } finally {
      projecting = false;
    }
    notify();
  };

  const captureAnchor = (): CapturedAnchor<TRowId> | undefined => {
    if (state.snapshot === null || state.rowHeights.rowCount === 0)
      return undefined;
    const index = state.rowHeights.getIndexForOffset(state.scrollTop);
    const heightAnchor = state.rowHeights.captureAnchor(index, state.scrollTop);
    if (heightAnchor === undefined) return undefined;
    return {
      heightAnchor,
      oldSnapshot: state.snapshot as PretableRowModelSnapshot<
        object,
        TRowId,
        unknown
      >,
      oldIndex: index,
    };
  };

  const resolveAnchorRef = (
    replacement: ActiveReplacement<TRow, TRowId, TColumns>,
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableVisibleRowRef<TRowId> | undefined => {
    const nearest = replacement.target.nearestVisibleRef(ref);
    if (nearest === undefined || replacement.target.indexOf(nearest) < 0) {
      return undefined;
    }
    return nearest;
  };

  const finishReplacement = (
    replacement: ActiveReplacement<TRow, TRowId, TColumns>,
    resolvedAnchor: PretableVisibleRowRef<TRowId> | undefined,
  ): void => {
    if (
      active !== replacement ||
      disposed ||
      replacement.candidate === undefined
    ) {
      return;
    }
    active = undefined;
    const candidate = replacement.candidate;
    replacement.candidate = undefined;
    let scrollTop = viewport.scrollTop;
    if (replacement.anchor !== undefined && resolvedAnchor !== undefined) {
      const index = replacement.target.indexOf(resolvedAnchor);
      if (index >= 0) {
        scrollTop = Math.max(
          0,
          candidate.restoreAnchor(
            {
              ref: resolvedAnchor,
              offset: replacement.anchor.heightAnchor.offset,
            },
            index,
          ),
        );
      }
    }
    try {
      publishReady(replacement.target, candidate, scrollTop);
      stagedRowHeights = undefined;
      deferredViewportWithoutAnchor = false;
    } catch (error) {
      stagedRowHeights = undefined;
      rollbackDeferredViewport();
      publishError(
        "layout-failed",
        "The rebuilt row window could not be published.",
        error,
      );
    }
  };

  const runReplacementSlice = (
    replacement: ActiveReplacement<TRow, TRowId, TColumns>,
  ): void => {
    if (active !== replacement || disposed) return;
    replacement.cancelScheduled = undefined;
    scheduledCallbackCount = Math.max(0, scheduledCallbackCount - 1);
    try {
      if (!replacement.builder.done) {
        const startedAt = now();
        const progress = replacement.builder.advance({
          maxUnits: maxUnitsPerSlice,
          deadline: startedAt + budgetMs,
          now,
        });
        replacementSliceCount += 1;
        maxReplacementUnitsPerSlice = Math.max(
          maxReplacementUnitsPerSlice,
          progress.unitsThisSlice,
        );
        if (!progress.done) {
          scheduleReplacement(replacement);
          return;
        }
        replacement.candidate = replacement.builder.finish();
      }

      const anchor = replacement.anchor;
      if (anchor === undefined) {
        finishReplacement(replacement, undefined);
        return;
      }
      const exact = resolveAnchorRef(replacement, anchor.heightAnchor.ref);
      if (exact !== undefined) {
        finishReplacement(replacement, exact);
        return;
      }

      let units = 0;
      const startedAt = now();
      do {
        const distance = replacement.searchDistance;
        const candidateIndex = replacement.searchPrevious
          ? anchor.oldIndex - distance
          : anchor.oldIndex + distance;
        replacement.searchPrevious = !replacement.searchPrevious;
        if (!replacement.searchPrevious) replacement.searchDistance += 1;
        units += 1;
        anchorSearchUnits += 1;
        if (
          candidateIndex >= 0 &&
          candidateIndex < anchor.oldSnapshot.visibleRowCount
        ) {
          const oldRow = anchor.oldSnapshot.rowAt(candidateIndex);
          if (oldRow !== undefined) {
            const resolved = resolveAnchorRef(replacement, rowRef(oldRow));
            if (resolved !== undefined) {
              finishReplacement(replacement, resolved);
              return;
            }
          }
        }
        if (
          anchor.oldIndex - replacement.searchDistance < 0 &&
          anchor.oldIndex + replacement.searchDistance >=
            anchor.oldSnapshot.visibleRowCount
        ) {
          finishReplacement(replacement, undefined);
          return;
        }
      } while (units < maxUnitsPerSlice && now() - startedAt < budgetMs);
      scheduleReplacement(replacement);
    } catch (error) {
      if (active !== replacement || disposed) return;
      active = undefined;
      replacement.builder.cancel();
      replacement.candidate = undefined;
      stagedRowHeights = undefined;
      rollbackDeferredViewport();
      publishError(
        "layout-failed",
        "The cooperative row-layout replacement failed.",
        error,
      );
    }
  };

  const scheduleReplacement = (
    replacement: ActiveReplacement<TRow, TRowId, TColumns>,
  ): void => {
    if (active !== replacement || disposed) return;
    const token = replacement.token;
    let scheduling = true;
    let ranSynchronously = false;
    const invoke = () => {
      if (scheduling) {
        ranSynchronously = true;
        return;
      }
      const current = active;
      if (current?.token !== token || disposed) return;
      runReplacementSlice(current);
    };
    try {
      const cancel = scheduler.schedule(invoke);
      scheduling = false;
      if (ranSynchronously) {
        bestEffortCancel(cancel);
        replacement.cancelScheduled = timeoutScheduler().schedule(invoke);
      } else if (active === replacement && !disposed) {
        replacement.cancelScheduled = cancel;
      } else {
        bestEffortCancel(cancel);
        return;
      }
      scheduledCallbackCount += 1;
    } catch (error) {
      scheduling = false;
      if (active !== replacement || disposed) return;
      active = undefined;
      replacement.builder.cancel();
      replacement.candidate = undefined;
      stagedRowHeights = undefined;
      rollbackDeferredViewport();
      publishError(
        "scheduler-failed",
        "The row-layout scheduler rejected a continuation.",
        error,
      );
    }
  };

  const startReplacement = (
    target: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
    shouldNotify: boolean,
    updateStatus = true,
  ): void => {
    cancelActive();
    const anchor = deferredViewportWithoutAnchor ? undefined : captureAnchor();
    const base = stagedRowHeights ?? state.rowHeights;
    let builder: RowHeightReplacementBuilder<PretableVisibleRowRef<TRowId>>;
    try {
      builder = base.beginReplacement({
        rowCount: target.visibleRowCount,
        entryAt(index) {
          const row = target.rowAt(index);
          if (row === undefined) {
            throw new RowLayoutControllerError(
              "layout-failed",
              `The row-model snapshot omitted visible row ${index}.`,
            );
          }
          return { key: rowRef(row) };
        },
      });
    } catch (error) {
      stagedRowHeights = undefined;
      rollbackDeferredViewport();
      publishError(
        "layout-failed",
        "The row-layout replacement source could not be captured.",
        error,
      );
      return;
    }
    const replacement: ActiveReplacement<TRow, TRowId, TColumns> = {
      token: {},
      target,
      builder,
      anchor,
      cancelScheduled: undefined,
      candidate: undefined,
      searchDistance: 1,
      searchPrevious: false,
    };
    active = replacement;
    if (updateStatus) {
      state = Object.freeze({
        ...state,
        status: Object.freeze({
          kind: "rebuilding" as const,
          targetRevision: target.revision,
        }),
      });
    }
    if (shouldNotify) notify();
    scheduleReplacement(replacement);
  };

  const validateChanges = (
    sequence: PretableChangeSequence<TRowId>,
    fromRevision: number,
    targetRevision: number,
  ): sequence is Extract<
    PretableChangeSequence<TRowId>,
    { kind: "changes" }
  > => {
    if (
      sequence.kind !== "changes" ||
      sequence.fromRevision !== fromRevision ||
      sequence.toRevision !== targetRevision
    ) {
      return false;
    }
    let expected = fromRevision;
    for (const change of sequence.changes) {
      if (
        change.previousRevision !== expected ||
        change.revision !== expected + 1
      ) {
        return false;
      }
      expected = change.revision;
    }
    return expected === targetRevision;
  };

  const applyChanges = (
    sequence: Extract<PretableChangeSequence<TRowId>, { kind: "changes" }>,
  ): RowHeightIndex<PretableVisibleRowRef<TRowId>> => {
    const operations: RowHeightOperation<PretableVisibleRowRef<TRowId>>[] = [];
    for (const change of sequence.changes) {
      for (const operation of change.operations) {
        if (operation.kind === "insert") {
          operations.push({
            kind: "insert",
            ref: operation.ref,
            index: operation.index,
          });
        } else if (operation.kind === "remove") {
          operations.push({
            kind: "remove",
            ref: operation.ref,
            previousIndex: operation.previousIndex,
          });
        } else if (operation.kind === "move") {
          operations.push({
            kind: "move",
            ref: operation.ref,
            previousIndex: operation.previousIndex,
            index: operation.index,
          });
        } else {
          // A change record cannot prove that rendered height is unaffected.
          operations.push({
            kind: "update",
            ref: operation.ref,
            index: operation.index,
          });
        }
      }
    }
    return state.rowHeights.apply(operations);
  };

  const synchronize = (): void => {
    if (disposed) return;
    if (synchronizing || notifying || projecting) {
      synchronizeAgain = true;
      return;
    }
    synchronizing = true;
    try {
      do {
        synchronizeAgain = false;
        const modelState = unreadInitialModelState ?? options.model.getState();
        unreadInitialModelState = undefined;
        if (modelState.status.kind === "disposed") {
          disposeController();
          return;
        }
        const target = modelState.snapshot;
        if (active !== undefined) {
          if (active.target.revision !== target.revision) {
            startReplacement(target, true);
          }
          continue;
        }
        if (state.observedRevision === target.revision) continue;
        if (state.observedRevision === null) {
          startReplacement(target, false);
          continue;
        }
        let sequence: PretableChangeSequence<TRowId>;
        try {
          sequence = options.model.changesSince(state.observedRevision);
          if (
            !validateChanges(sequence, state.observedRevision, target.revision)
          ) {
            startReplacement(target, true);
            continue;
          }
        } catch {
          startReplacement(target, true);
          continue;
        }
        try {
          const previousAnchor = captureAnchor();
          const root = applyChanges(sequence);
          let scrollTop = viewport.scrollTop;
          if (previousAnchor !== undefined) {
            const resolved = target.nearestVisibleRef(
              previousAnchor.heightAnchor.ref,
            );
            if (resolved !== undefined) {
              const index = target.indexOf(resolved);
              if (index >= 0) {
                scrollTop = Math.max(
                  0,
                  root.restoreAnchor(
                    {
                      ref: resolved,
                      offset: previousAnchor.heightAnchor.offset,
                    },
                    index,
                  ),
                );
              }
            }
          }
          publishReady(target, root, scrollTop);
        } catch (error) {
          if (error instanceof RowLayoutControllerError) {
            publishError(
              "layout-failed",
              "The incremental row window could not be published.",
              error,
            );
          } else {
            startReplacement(target, true);
          }
        }
      } while (synchronizeAgain && !disposed);
    } finally {
      synchronizing = false;
    }
    drainActions();
  };

  function detachModel(): void {
    const unsubscribe = unsubscribeModel;
    if (unsubscribe === undefined) {
      detachModelWhenAvailable = true;
      return;
    }
    unsubscribeModel = undefined;
    bestEffortCancel(unsubscribe);
  }

  function disposeController(): void {
    if (disposed) return;
    disposed = true;
    cancelActive();
    stagedRowHeights = undefined;
    rollbackDeferredViewport();
    detachModel();
    queuedActions.length = 0;
    const captured = Array.from(listeners);
    listeners.clear();
    state = Object.freeze({ ...state, status: DISPOSED });
    for (const listener of captured) {
      try {
        listener();
      } catch {
        // Disposal still settles and wakes every attached subscriber once.
      }
    }
  }

  const controller: RowLayoutController<TRow, TRowId, TColumns> = {
    getState: () => state,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setViewport(nextViewport) {
      if (disposed) {
        throw new RowLayoutControllerError(
          "disposed-controller",
          "A disposed row-layout controller cannot change its viewport.",
        );
      }
      const normalized = normalizeViewport(nextViewport);
      if (notifying || projecting || synchronizing) {
        queuedActions.push(() => {
          if (!disposed) controller.setViewport(normalized);
        });
        return;
      }
      if (
        normalized.scrollTop === viewport.scrollTop &&
        normalized.viewportHeight === viewport.viewportHeight &&
        normalized.overscan === viewport.overscan
      ) {
        return;
      }
      viewport = normalized;
      if (active !== undefined) {
        active.anchor = undefined;
        deferredViewportWithoutAnchor = true;
        return;
      }
      deferredViewportWithoutAnchor = false;
      if (state.snapshot === null) return;
      try {
        publishReady(state.snapshot, state.rowHeights, viewport.scrollTop);
      } catch (error) {
        publishError(
          "layout-failed",
          "The requested row window could not be planned.",
          error,
        );
      }
    },
    measure(ref, height) {
      if (disposed) {
        throw new RowLayoutControllerError(
          "disposed-controller",
          "A disposed row-layout controller cannot accept measurements.",
        );
      }
      if (state.snapshot === null) return;
      const index = state.snapshot.indexOf(ref);
      if (index < 0) {
        throw new RangeError("Cannot measure a row that is not visible.");
      }
      if (!Number.isFinite(height) || height <= 0) {
        throw new RangeError(
          "Measured row height must be a finite number greater than zero.",
        );
      }
      if (notifying || projecting || synchronizing) {
        queuedActions.push(() => {
          if (!disposed) controller.measure(ref, height);
        });
        return;
      }
      if (active !== undefined) {
        const previousStaged = stagedRowHeights;
        const base = previousStaged ?? state.rowHeights;
        try {
          const measured = base.measure(index, ref, height);
          if (measured === base) return;
          stagedRowHeights = measured;
          const target = active.target;
          startReplacement(target, false, false);
        } catch (error) {
          stagedRowHeights = previousStaged;
          throw error;
        }
        return;
      }
      const previous = state;
      try {
        const anchor = captureAnchor();
        const root = state.rowHeights.measure(index, ref, height);
        if (root === state.rowHeights) return;
        let scrollTop = viewport.scrollTop;
        if (anchor !== undefined) {
          const anchorIndex = state.snapshot.indexOf(anchor.heightAnchor.ref);
          if (anchorIndex >= 0) {
            scrollTop = Math.max(
              0,
              root.restoreAnchor(anchor.heightAnchor, anchorIndex),
            );
          }
        }
        publishReady(state.snapshot, root, scrollTop);
      } catch (error) {
        state = previous;
        throw error;
      }
    },
    dispose() {
      if (notifying || projecting || synchronizing) {
        queuedActions.push(disposeController);
        return;
      }
      disposeController();
    },
  };

  controllerDiagnostics.set(controller, () =>
    Object.freeze({
      replacementSliceCount,
      maxReplacementUnitsPerSlice,
      scheduledCallbackCount,
      retainedBuilderCount: active === undefined ? 0 : 1,
      lastPublishedRangeRows,
      anchorSearchUnits,
    }),
  );
  try {
    const unsubscribe = options.model.subscribe(synchronize);
    if (typeof unsubscribe !== "function") {
      throw new TypeError(
        "The row model subscribe method must return a function.",
      );
    }
    unsubscribeModel = unsubscribe;
    if (detachModelWhenAvailable || disposed) detachModel();
  } catch (error) {
    disposed = true;
    cancelActive();
    stagedRowHeights = undefined;
    rollbackDeferredViewport();
    queuedActions.length = 0;
    listeners.clear();
    state = Object.freeze({ ...state, status: DISPOSED });
    throw error;
  }
  synchronize();
  return controller;
}
