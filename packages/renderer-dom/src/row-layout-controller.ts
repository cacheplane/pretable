import {
  createRowHeightIndex,
  planViewport,
  type RowHeightAnchor,
  type RowHeightIndex,
  type RowHeightOperation,
  type RowHeightReplacementBuilder,
} from "@pretable-internal/layout-core";
import type {
  PretableChangeOperation,
  PretableChangeSequence,
  PretableChangeSet,
  PretableRowId,
  PretableRowModelSnapshot,
  PretableVisibleRow,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import {
  DEFAULT_ROW_HEIGHT,
  estimateDomRowHeight,
  predictRowLineCount,
} from "./create-renderer";
import { createRowHeightCalibration } from "./row-height-calibration";
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
const DEFAULT_BUDGET_MS = 5;
const DEFAULT_MAX_UNITS_PER_SLICE = 256;
const MAX_ESTIMATE_PLAN_PASSES = 256;
// How many data rows keep their last DOM-reported height for use as an update's
// fallback. Analogous to layout-core's `maxRetainedMeasurements` but NOT the
// same population, and deliberately not wired to it: that option bounds
// tombstones — measurements for rows absent from the visible set — and leaves
// live measurements unbounded, whereas this bounds every data row we have
// measured, visible ones included. Sharing the option would mean a legitimate
// `maxRetainedMeasurements: 0` ("keep no tombstones") silently switched off
// height retention, and any modest value silently shrank its reach on a large
// grid.
const DEFAULT_MAX_RETAINED_ROW_HEIGHTS = 100_000;

class CatchUpSequenceError extends Error {}
class StaleReplacementPublicationError extends Error {}

export interface RowLayoutControllerDiagnostics {
  readonly replacementSliceCount: number;
  readonly maxReplacementUnitsPerSlice: number;
  readonly scheduledCallbackCount: number;
  readonly retainedBuilderCount: number;
  readonly retainedCandidateRootCount: number;
  readonly lastPublishedRangeRows: number;
  readonly anchorSearchUnits: number;
  readonly replacementStartCount: number;
  readonly pendingCatchUpChangeSetCount: number;
  readonly pendingCatchUpOperationCount: number;
  readonly retainedCatchUpSnapshotCount: number;
  readonly stagedMeasurementCount: number;
  readonly lastMeasuredHeightCount: number;
  readonly catchUpUnits: number;
  readonly maxCatchUpUnitsPerSlice: number;
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

/**
 * A yield that is not clamped.
 *
 * `setTimeout(task, 0)` is the obvious continuation and the wrong one: every
 * browser clamps nested zero-delay timers to ~4ms once the chain is a few deep,
 * and a chunked layout build IS such a chain — each slice schedules the next
 * from inside the previous one. The clamp is pure latency, paid per slice,
 * while the grid shows nothing.
 *
 * Measured on the 2,500 x 500 showcase, mount to first painted cell: Chromium
 * 13ms (it has `scheduler.postTask`), WebKit 263ms across 25 timer hops. Safari
 * ships no `postTask`, so it always lands here, and removing `postTask` from
 * Chromium reproduced the stall exactly (176-190ms) — the engine was never the
 * variable, the fallback was.
 *
 * A `MessageChannel` message is a macrotask with no clamp, which is why the
 * row model's cooperative transition already prefers one
 * (`row-model/src/cooperative-transition.ts`). This is the same ladder.
 */
function messageChannelScheduler(): RowLayoutScheduler | null {
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

function fallbackScheduler(): RowLayoutScheduler {
  const messageChannel = messageChannelScheduler();
  const timeout = timeoutScheduler();
  return {
    schedule(task) {
      if (messageChannel !== null) {
        try {
          return messageChannel.schedule(task);
        } catch {
          // A present but unusable MessageChannel must not strand the slice.
        }
      }
      return timeout.schedule(task);
    },
  };
}

function defaultScheduler(): RowLayoutScheduler {
  const fallback = fallbackScheduler();
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
  readonly baseTarget: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  readonly builder: RowHeightReplacementBuilder<PretableVisibleRowRef<TRowId>>;
  latestTarget: PretableRowModelSnapshot<TRow, TRowId, TColumns>;
  capturedRevision: number;
  capturedWakeVersion: number;
  appliedRevision: number;
  readonly pending: Array<
    | {
        readonly toRevision: number;
        readonly changes: readonly PretableChangeSet<TRowId>[];
      }
    | undefined
  >;
  pendingHead: number;
  pendingChangeIndex: number;
  pendingOperationIndex: number;
  currentOperations: readonly PretableChangeOperation<TRowId>[] | undefined;
  pendingChangeSetCount: number;
  pendingOperationCount: number;
  anchor: CapturedAnchor<TRowId> | undefined;
  cancelScheduled: (() => void) | undefined;
  candidate: RowHeightIndex<PretableVisibleRowRef<TRowId>> | undefined;
  searchDistance: number;
  searchPrevious: boolean;
}

interface StagedMeasurement<TRowId extends PretableRowId> {
  readonly ref: PretableVisibleRowRef<TRowId>;
  readonly height: number;
  readonly capturedRevision: number;
  readonly appliedToken: object | undefined;
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
  const eagerInitialRowLimit = Math.min(
    maxUnitsPerSlice - 1,
    Math.max(0, options.eagerInitialRowLimit ?? 0),
  );
  validateRuntime({ budgetMs, maxUnitsPerSlice });
  let viewport = normalizeViewport(options.viewport);
  const defaultRowHeight = options.defaultRowHeight ?? DEFAULT_ROW_HEIGHT;
  let layoutColumns = options.columns;
  // Per controller instance. `defaultRowHeight` is captured at construction and
  // has no setter, so a density flip or a theme change builds a new controller
  // and re-learns rather than carrying another theme's metrics — which is the
  // scope that matters, since line height and chrome are font metrics.
  //
  // `layoutColumns`, by contrast, IS reassignable through `setColumns`, so the
  // calibration outlives a column change. That is deliberate and safe for the
  // fitted terms: swapping columns does not change the font, and the wrapped
  // sample ring is bounded, so the fit re-converges on the new content. The
  // floor is the one term that does not decay — it is a running max — so a
  // controller that drops its tallest custom-rendered column keeps an inflated
  // floor until it is rebuilt. Over-estimating there is the safe direction (it
  // cannot reintroduce the first-paint shrink this exists to remove), and
  // resetting on `setColumns` was rejected: `setColumns` compares `column.value`
  // by identity, so a consumer passing inline callbacks would reset the
  // calibration every render and never learn anything at all.
  const calibration = createRowHeightCalibration();
  // Resolved per estimate, never captured at construction: the grid's font can
  // only be measured off a rendered cell, and a controller exists before the
  // first cell does. Reading it once here would pin every grid to `null`.
  const readAverageCharWidthPx = (): number | null =>
    options.getAverageCharWidthPx?.() ?? null;
  const rawEstimate =
    options.estimateRowHeight ??
    ((row: TRow) =>
      estimateDomRowHeight(
        row,
        layoutColumns,
        defaultRowHeight,
        calibration.getParameters(),
        readAverageCharWidthPx(),
      ));
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
  let modelWakeVersion = 0;
  const queuedActions: Array<() => void> = [];
  let active: ActiveReplacement<TRow, TRowId, TColumns> | undefined;
  const stagedMeasurements = new Map<string, StagedMeasurement<TRowId>>();
  // The last height the DOM reported for a DATA row, by identity.
  //
  // A staged measurement is discarded when its row is updated, which is correct
  // — the row's content changed, so the measurement may be stale. What is not
  // correct is falling back to `estimateDomRowHeight` from there: an estimate is
  // for a row we have never seen, and this is a row we have measured. Under
  // streaming the discard fires every tick, so without this the grid republishes
  // measured data rows at the estimator's height sixty times a second and
  // corrects each one a commit later.
  //
  // Data rows only, because the estimate gate this feeds is itself gated on
  // `row.kind === "data"`. Group rows are measured too, but nothing would ever
  // look their entries up, and retaining them would let a grouped grid evict the
  // data entries the fallback depends on. Group rows therefore still revert to
  // the default height on update — out of scope here, not fixed.
  //
  // Retained rather than restored: `hasMeasurement` still goes false, because
  // the measurement genuinely is stale until the DOM re-measures. This only
  // supplies a better number for the interval in between.
  const lastMeasuredHeights = new Map<string, number>();
  const lastMeasuredHeightLimit =
    options.maxRetainedRowHeights ?? DEFAULT_MAX_RETAINED_ROW_HEIGHTS;

  // A controller that streams for hours must not accumulate an entry per row it
  // has ever shown. Eviction is least-recently-measured rather than plain
  // insertion order — re-measuring refreshes an entry — because the rows most
  // worth retaining are the ones the DOM keeps reporting, and a plain insertion
  // order would evict exactly those first. Losing an entry is not a correctness
  // failure: it only returns that row to the estimate it would have used before
  // this map existed.
  const retainMeasuredHeight = (identity: string, height: number): void => {
    lastMeasuredHeights.delete(identity);
    lastMeasuredHeights.set(identity, height);
    while (lastMeasuredHeights.size > lastMeasuredHeightLimit) {
      // Map iteration is insertion order, so the first key is the coldest.
      const coldest = lastMeasuredHeights.keys().next();
      if (coldest.done === true) break;
      lastMeasuredHeights.delete(coldest.value);
    }
  };
  const stagedMeasurementKeys: string[] = [];
  const stagedMeasurementKeyIndexes = new Map<string, number>();
  let stagedMeasurementHead = 0;
  let replacementSliceCount = 0;
  let maxReplacementUnitsPerSlice = 0;
  let scheduledCallbackCount = 0;
  let lastPublishedRangeRows = 0;
  let anchorSearchUnits = 0;
  let replacementStartCount = 0;
  let catchUpUnits = 0;
  let maxCatchUpUnitsPerSlice = 0;
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

  const clearStagedMeasurements = (): void => {
    stagedMeasurements.clear();
    stagedMeasurementKeys.length = 0;
    stagedMeasurementKeyIndexes.clear();
    stagedMeasurementHead = 0;
  };

  const clampScrollTop = (
    root: RowHeightIndex<PretableVisibleRowRef<TRowId>>,
    requestedViewport: RowLayoutViewport,
    requestedScrollTop: number,
  ): number =>
    Math.min(
      Math.max(0, requestedScrollTop),
      Math.max(0, root.getTotalHeight() - requestedViewport.viewportHeight),
    );

  const prepareWindow = (
    snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
    initialRoot: RowHeightIndex<PretableVisibleRowRef<TRowId>>,
    requestedViewport: RowLayoutViewport,
    scrollTop: number,
  ): {
    readonly root: RowHeightIndex<PretableVisibleRowRef<TRowId>>;
    readonly scrollTop: number;
    readonly range: { readonly start: number; readonly end: number };
    readonly window: readonly RowLayoutWindowRow<TRow, TRowId, TColumns>[];
  } => {
    let root = initialRoot;
    const estimated = new Set<string>();
    for (let pass = 0; pass < MAX_ESTIMATE_PLAN_PASSES; pass += 1) {
      const clampedScrollTop = clampScrollTop(
        root,
        requestedViewport,
        scrollTop,
      );
      const plan = planViewport({
        scrollTop: clampedScrollTop,
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
            // A row we have measured falls back to that measurement; only a row
            // we have never seen gets arithmetic.
            //
            // Deliberately NOT clamped to `defaultRowHeight` the way `estimate`
            // clamps its own output. That floor exists to stop arithmetic from
            // guessing a row shorter than the grid's own minimum; a retained
            // height is not a guess, it is what the DOM reported. The option
            // contract already says as much — estimates are clamped to the
            // floor, "actual DOM measurements may still be smaller" — so
            // clamping here would round a real measurement up to a number the
            // row never had.
            estimatedHeight:
              lastMeasuredHeights.get(identity) ?? estimate(row.row),
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
        scrollTop: clampedScrollTop,
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
    lifecycle?: {
      readonly isCurrent: () => boolean;
      readonly commit: () => void;
    },
  ): void => {
    projecting = true;
    try {
      const prepared = prepareWindow(snapshot, root, viewport, scrollTop);
      const publishedViewport = Object.freeze({
        ...viewport,
        scrollTop: prepared.scrollTop,
      });
      if (lifecycle !== undefined) {
        if (!lifecycle.isCurrent()) {
          throw new StaleReplacementPublicationError();
        }
        lifecycle.commit();
      }
      viewport = publishedViewport;
      lastPublishedRangeRows = prepared.window.length;
      state = Object.freeze({
        observedRevision: snapshot.revision,
        snapshot,
        rowHeights: prepared.root,
        viewport,
        scrollTop: prepared.scrollTop,
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

  const applyOperation = (
    root: RowHeightIndex<PretableVisibleRowRef<TRowId>>,
    operation: PretableChangeOperation<TRowId>,
    revision: number,
  ): RowHeightIndex<PretableVisibleRowRef<TRowId>> => {
    let heightOperation: RowHeightOperation<PretableVisibleRowRef<TRowId>>;
    if (operation.kind === "insert") {
      heightOperation = {
        kind: "insert",
        ref: operation.ref,
        index: operation.index,
      };
    } else if (operation.kind === "remove") {
      // A removed row will never be looked up again, so its retained height is
      // dead weight; dropping it here keeps the map proportional to the grid
      // rather than to the grid's history.
      //
      // This is the one side effect in a function that is otherwise pure over a
      // persistent index, and it is NOT rolled back when a speculative
      // candidate root is discarded and replayed. Left as-is deliberately: the
      // worst case is that a row still present loses its retained height and
      // takes an estimate for one frame, which is exactly what eviction already
      // does and is self-healing on the next measurement. It can never hand a
      // height to the wrong row. Rolling it back would mean threading an undo
      // log through the slice machinery to buy back a single frame.
      lastMeasuredHeights.delete(identityOf(operation.ref));
      heightOperation = {
        kind: "remove",
        ref: operation.ref,
        previousIndex: operation.previousIndex,
      };
    } else if (operation.kind === "move") {
      heightOperation = {
        kind: "move",
        ref: operation.ref,
        previousIndex: operation.previousIndex,
        index: operation.index,
      };
    } else {
      heightOperation = {
        kind: "update",
        ref: operation.ref,
        index: operation.index,
      };
      const identity = identityOf(operation.ref);
      const staged = stagedMeasurements.get(identity);
      if (staged !== undefined && staged.capturedRevision < revision) {
        stagedMeasurements.delete(identity);
      }
    }
    return root.apply([heightOperation]);
  };

  const resolveAnchorRef = (
    replacement: ActiveReplacement<TRow, TRowId, TColumns>,
    ref: PretableVisibleRowRef<TRowId>,
  ): PretableVisibleRowRef<TRowId> | undefined => {
    const nearest = replacement.latestTarget.nearestVisibleRef(ref);
    if (
      nearest === undefined ||
      replacement.latestTarget.indexOf(nearest) < 0
    ) {
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
    if (
      replacement.pending[replacement.pendingHead] !== undefined ||
      replacement.appliedRevision !== replacement.capturedRevision ||
      replacement.capturedWakeVersion !== modelWakeVersion ||
      stagedMeasurementHead < stagedMeasurementKeys.length
    ) {
      scheduleReplacement(replacement);
      return;
    }
    const candidate = replacement.candidate;
    const target = replacement.latestTarget;
    const expectedWakeVersion = replacement.capturedWakeVersion;
    const isCurrent = (): boolean =>
      active === replacement &&
      replacement.latestTarget === target &&
      replacement.capturedWakeVersion === expectedWakeVersion &&
      expectedWakeVersion === modelWakeVersion &&
      replacement.pending[replacement.pendingHead] === undefined &&
      replacement.appliedRevision === replacement.capturedRevision &&
      stagedMeasurementHead === stagedMeasurementKeys.length;
    let scrollTop = viewport.scrollTop;
    if (replacement.anchor !== undefined && resolvedAnchor !== undefined) {
      const index = target.indexOf(resolvedAnchor);
      if (!isCurrent()) {
        scheduleReplacement(replacement);
        return;
      }
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
      publishReady(target, candidate, scrollTop, {
        isCurrent,
        commit() {
          active = undefined;
          replacement.candidate = undefined;
          clearStagedMeasurements();
          deferredViewportWithoutAnchor = false;
        },
      });
    } catch (error) {
      if (error instanceof StaleReplacementPublicationError) {
        synchronize();
        if (active === replacement && !disposed) {
          scheduleReplacement(replacement);
        }
        return;
      }
      if (active === replacement) {
        active = undefined;
        replacement.builder.cancel();
        replacement.candidate = undefined;
      }
      clearStagedMeasurements();
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
    ignoreDeadline = false,
  ): void => {
    if (active !== replacement || disposed) return;
    replacement.cancelScheduled = undefined;
    scheduledCallbackCount = Math.max(0, scheduledCallbackCount - 1);
    let replayingCatchUp = false;
    try {
      replacementSliceCount += 1;
      const sliceStartedAt = now();
      let builderUnitsThisSlice = 0;
      if (!replacement.builder.done) {
        const progress = replacement.builder.advance({
          maxUnits: maxUnitsPerSlice,
          deadline: ignoreDeadline
            ? Number.MAX_VALUE
            : sliceStartedAt + budgetMs,
          now,
        });
        builderUnitsThisSlice = progress.unitsThisSlice;
        maxReplacementUnitsPerSlice = Math.max(
          maxReplacementUnitsPerSlice,
          progress.unitsThisSlice,
        );
        if (!progress.done) {
          scheduleReplacement(replacement);
          return;
        }
        replacement.candidate = replacement.builder.finish();
        replacement.appliedRevision = replacement.baseTarget.revision;
      }

      let sliceCatchUpUnits = 0;
      replayingCatchUp = true;
      while (
        sliceCatchUpUnits < maxUnitsPerSlice - builderUnitsThisSlice &&
        (ignoreDeadline || now() - sliceStartedAt < budgetMs)
      ) {
        const batch = replacement.pending[replacement.pendingHead];
        if (batch !== undefined) {
          if (replacement.pendingChangeIndex < batch.changes.length) {
            const change = batch.changes[replacement.pendingChangeIndex]!;
            if (replacement.currentOperations === undefined) {
              if (
                change.previousRevision !== replacement.appliedRevision ||
                change.revision !== replacement.appliedRevision + 1
              ) {
                throw new CatchUpSequenceError(
                  "The queued row-layout change sequence is not contiguous.",
                );
              }
              replacement.currentOperations = change.operations;
              replacement.pendingOperationIndex = 0;
              replacement.pendingOperationCount += change.operations.length;
            } else if (
              replacement.pendingOperationIndex <
              replacement.currentOperations.length
            ) {
              const operation =
                replacement.currentOperations[
                  replacement.pendingOperationIndex
                ]!;
              replacement.candidate = applyOperation(
                replacement.candidate!,
                operation,
                change.revision,
              );
              replacement.pendingOperationIndex += 1;
              replacement.pendingOperationCount -= 1;
            } else {
              replacement.appliedRevision = change.revision;
              replacement.pendingChangeIndex += 1;
              replacement.pendingChangeSetCount -= 1;
              replacement.pendingOperationIndex = 0;
              replacement.currentOperations = undefined;
            }
          } else {
            if (replacement.appliedRevision !== batch.toRevision) {
              throw new CatchUpSequenceError(
                "The queued row-layout change sequence ended at the wrong revision.",
              );
            }
            replacement.pending[replacement.pendingHead] = undefined;
            replacement.pendingHead += 1;
            replacement.pendingChangeIndex = 0;
            if (replacement.pendingHead === replacement.pending.length) {
              replacement.pending.length = 0;
              replacement.pendingHead = 0;
            }
          }
          sliceCatchUpUnits += 1;
          continue;
        }

        if (replacement.appliedRevision !== replacement.capturedRevision) {
          throw new CatchUpSequenceError(
            "The queued row-layout changes do not reach the captured revision.",
          );
        }
        const stagedKey = stagedMeasurementKeys[stagedMeasurementHead];
        if (stagedKey !== undefined) {
          const measurement = stagedMeasurements.get(stagedKey);
          if (
            measurement !== undefined &&
            measurement.appliedToken !== replacement.token
          ) {
            const index = replacement.latestTarget.indexOf(measurement.ref);
            if (active !== replacement || disposed) return;
            stagedMeasurementHead += 1;
            if (index >= 0) {
              replacement.candidate = replacement.candidate!.measure(
                index,
                measurement.ref,
                measurement.height,
              );
            } else {
              replacement.candidate = replacement.candidate!.retainMeasurement(
                measurement.ref,
                measurement.height,
              );
            }
            stagedMeasurements.set(stagedKey, {
              ...measurement,
              appliedToken: replacement.token,
            });
          } else {
            stagedMeasurementHead += 1;
          }
          sliceCatchUpUnits += 1;
          continue;
        }
        break;
      }
      replayingCatchUp = false;
      catchUpUnits += sliceCatchUpUnits;
      maxCatchUpUnitsPerSlice = Math.max(
        maxCatchUpUnitsPerSlice,
        sliceCatchUpUnits,
      );
      if (
        replacement.pending[replacement.pendingHead] !== undefined ||
        stagedMeasurementHead < stagedMeasurementKeys.length
      ) {
        scheduleReplacement(replacement);
        return;
      }
      const remainingUnits =
        maxUnitsPerSlice - builderUnitsThisSlice - sliceCatchUpUnits;
      if (remainingUnits <= 0) {
        scheduleReplacement(replacement);
        return;
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
      } while (
        units < remainingUnits &&
        (ignoreDeadline || now() - sliceStartedAt < budgetMs)
      );
      scheduleReplacement(replacement);
    } catch (error) {
      if (active !== replacement || disposed) return;
      if (replayingCatchUp || error instanceof CatchUpSequenceError) {
        startReplacement(replacement.latestTarget, true);
        return;
      }
      active = undefined;
      replacement.builder.cancel();
      replacement.candidate = undefined;
      clearStagedMeasurements();
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
      clearStagedMeasurements();
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
  ): void => {
    cancelActive();
    replacementStartCount += 1;
    const anchor = deferredViewportWithoutAnchor ? undefined : captureAnchor();
    let builder: RowHeightReplacementBuilder<PretableVisibleRowRef<TRowId>>;
    let targetRevision: number;
    try {
      targetRevision = target.revision;
      builder = state.rowHeights.beginReplacement({
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
      clearStagedMeasurements();
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
      baseTarget: target,
      builder,
      latestTarget: target,
      capturedRevision: targetRevision,
      capturedWakeVersion: modelWakeVersion,
      appliedRevision: targetRevision,
      pending: [],
      pendingHead: 0,
      pendingChangeIndex: 0,
      pendingOperationIndex: 0,
      currentOperations: undefined,
      pendingChangeSetCount: 0,
      pendingOperationCount: 0,
      anchor,
      cancelScheduled: undefined,
      candidate: undefined,
      searchDistance: 1,
      searchPrevious: false,
    };
    stagedMeasurementHead = 0;
    active = replacement;
    state = Object.freeze({
      ...state,
      status: Object.freeze({
        kind: "rebuilding" as const,
        targetRevision,
      }),
    });
    if (shouldNotify) notify();
    if (
      state.observedRevision === null &&
      target.visibleRowCount <= eagerInitialRowLimit
    ) {
      runReplacementSlice(replacement, true);
    } else {
      scheduleReplacement(replacement);
    }
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

  const captureActiveTarget = (
    replacement: ActiveReplacement<TRow, TRowId, TColumns>,
    target: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  ): boolean => {
    try {
      const targetRevision = target.revision;
      if (targetRevision === replacement.capturedRevision) {
        replacement.capturedWakeVersion = modelWakeVersion;
        replacement.latestTarget = target;
        return true;
      }
      const sequence = options.model.changesSince(replacement.capturedRevision);
      if (
        sequence.kind !== "changes" ||
        sequence.fromRevision !== replacement.capturedRevision ||
        sequence.toRevision !== targetRevision
      ) {
        return false;
      }
      const changes = sequence.changes;
      replacement.pending.push({
        toRevision: sequence.toRevision,
        changes,
      });
      replacement.pendingChangeSetCount += changes.length;
      replacement.capturedRevision = targetRevision;
      replacement.capturedWakeVersion = modelWakeVersion;
      replacement.latestTarget = target;
      state = Object.freeze({
        ...state,
        status: Object.freeze({
          kind: "rebuilding" as const,
          targetRevision,
        }),
      });
      notify();
      return true;
    } catch {
      return false;
    }
  };

  const applyChanges = (
    sequence: Extract<PretableChangeSequence<TRowId>, { kind: "changes" }>,
  ): RowHeightIndex<PretableVisibleRowRef<TRowId>> => {
    let root = state.rowHeights;
    for (const change of sequence.changes) {
      for (const operation of change.operations) {
        root = applyOperation(root, operation, change.revision);
      }
    }
    return root;
  };

  const synchronize = (): void => {
    if (disposed) return;
    modelWakeVersion += 1;
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
          if (!captureActiveTarget(active, target)) {
            let replacementTarget = target;
            try {
              replacementTarget = options.model.getState().snapshot;
            } catch {
              // startReplacement contains hostile snapshot/source access.
            }
            startReplacement(replacementTarget, true);
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
    clearStagedMeasurements();
    // Not cleared inside `clearStagedMeasurements`: that helper also runs on
    // every replacement reset, and dropping retained heights there would put
    // the estimator back in charge of rows we have already measured — the exact
    // failure this map exists to prevent. Only disposal ends their usefulness.
    lastMeasuredHeights.clear();
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

  function activateController(): void {
    if (disposed || unsubscribeModel !== undefined) return;
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
      clearStagedMeasurements();
      // No `lastMeasuredHeights.clear()` here on purpose: this path runs only
      // when the model subscription itself fails, before any snapshot exists,
      // and `measure` returns early while `state.snapshot` is null — so the map
      // is provably empty. Adding a clear would be a line no test could ever
      // cover.
      rollbackDeferredViewport();
      queuedActions.length = 0;
      listeners.clear();
      state = Object.freeze({ ...state, status: DISPOSED });
      throw error;
    }
    synchronize();
  }

  const controller: RowLayoutController<TRow, TRowId, TColumns> = {
    getState: () => state,
    activate: activateController,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      try {
        activateController();
      } catch (error) {
        listeners.delete(listener);
        throw error;
      }
      return () => listeners.delete(listener);
    },
    setColumns(nextColumns) {
      if (disposed) {
        throw new RowLayoutControllerError(
          "disposed-controller",
          "A disposed row-layout controller cannot change its columns.",
        );
      }
      if (
        layoutColumns.length === nextColumns.length &&
        layoutColumns.every((column, index) => {
          const next = nextColumns[index];
          return (
            next !== undefined &&
            column.id === next.id &&
            column.wrap === next.wrap &&
            column.widthPx === next.widthPx &&
            column.pinned === next.pinned &&
            column.flex === next.flex &&
            column.minWidthPx === next.minWidthPx &&
            column.maxWidthPx === next.maxWidthPx &&
            column.value === next.value
          );
        })
      ) {
        return;
      }
      if (notifying || projecting || synchronizing) {
        queuedActions.push(() => {
          if (!disposed) controller.setColumns(nextColumns);
        });
        return;
      }
      layoutColumns = nextColumns;
      if (state.snapshot !== null) startReplacement(state.snapshot, true);
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
      // Recorded before the re-entrancy re-queue below: a measurement deferred
      // by re-entrancy is still a measurement the DOM reported, and that gap is
      // exactly the interval this map exists to cover.
      if (ref.kind === "data") {
        retainMeasuredHeight(identityOf(ref), height);
        // Fit against the estimator's own predicted line count, not the number
        // of lines the DOM produced: the correction being learned is a
        // correction to that prediction.
        const observed = state.snapshot.range(index, index + 1)[0];
        if (observed !== undefined && observed.kind === "data") {
          calibration.observe(
            predictRowLineCount(
              observed.row,
              layoutColumns,
              readAverageCharWidthPx(),
            ),
            height,
          );
        }
      }
      if (notifying || projecting || synchronizing) {
        queuedActions.push(() => {
          if (!disposed) controller.measure(ref, height);
        });
        return;
      }
      if (active !== undefined) {
        const identity = identityOf(ref);
        let keyIndex = stagedMeasurementKeyIndexes.get(identity);
        if (keyIndex === undefined) {
          keyIndex = stagedMeasurementKeys.length;
          stagedMeasurementKeys.push(identity);
          stagedMeasurementKeyIndexes.set(identity, keyIndex);
        }
        stagedMeasurementHead = Math.min(stagedMeasurementHead, keyIndex);
        stagedMeasurements.set(identity, {
          ref,
          height,
          capturedRevision: active.capturedRevision,
          appliedToken: undefined,
        });
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
    (() => {
      const retainedSnapshots = new Set<object>();
      if (active !== undefined) {
        retainedSnapshots.add(active.baseTarget);
        retainedSnapshots.add(active.latestTarget);
        if (active.anchor !== undefined) {
          retainedSnapshots.add(active.anchor.oldSnapshot);
        }
      }
      return Object.freeze({
        replacementSliceCount,
        maxReplacementUnitsPerSlice,
        scheduledCallbackCount,
        retainedBuilderCount:
          active !== undefined && active.candidate === undefined ? 1 : 0,
        retainedCandidateRootCount: active?.candidate === undefined ? 0 : 1,
        lastPublishedRangeRows,
        anchorSearchUnits,
        replacementStartCount,
        pendingCatchUpChangeSetCount: active?.pendingChangeSetCount ?? 0,
        pendingCatchUpOperationCount: active?.pendingOperationCount ?? 0,
        retainedCatchUpSnapshotCount: retainedSnapshots.size,
        stagedMeasurementCount: stagedMeasurements.size,
        lastMeasuredHeightCount: lastMeasuredHeights.size,
        catchUpUnits,
        maxCatchUpUnitsPerSlice,
      });
    })(),
  );
  if (options.deferActivation !== true) activateController();
  return controller;
}
