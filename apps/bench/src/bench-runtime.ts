import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import type {
  BenchMetricId,
  BenchRunRequest,
  BenchRunSummary,
} from "@pretable-internal/bench-runner";
import type { PretableTelemetry } from "@pretable/react/internal";

import type { BenchQueryState } from "./bench-types";

export const BENCH_RESULT_KEY = "__PRETABLE_BENCH_RESULT__";

const BENCH_FONT_STACK = '"IBM Plex Sans", system-ui, sans-serif';
const BENCH_VIEWPORT = {
  width: 1440,
  height: 900,
};

export function createBenchRequest(
  query: BenchQueryState,
  dataset: ScenarioDataset,
  browserVersion: string,
): BenchRunRequest {
  return {
    adapterId: query.adapterId,
    profile: query.profile,
    scenarioId: query.scenarioId,
    scale: query.scale,
    scriptName: query.scriptName,
    browserName: "chromium",
    browserVersion,
    seed: dataset.seed,
    rowCount: dataset.rowCount,
    viewport: BENCH_VIEWPORT,
    fontStack: BENCH_FONT_STACK,
    deviceScaleFactor: 1,
  };
}

export function publishBenchResult(result: BenchRunSummary): BenchRunSummary {
  window[BENCH_RESULT_KEY] = result;
  return result;
}

export function createPretableTelemetryNotes(
  telemetry: PretableTelemetry | null,
) {
  if (!telemetry) {
    return [];
  }

  return [
    `internal telemetry rendered rows: ${telemetry.renderedRowCount}`,
    `internal telemetry visible rows: ${telemetry.visibleRowCount}`,
    `internal telemetry total rows: ${telemetry.totalRowCount}`,
    `internal telemetry planned height: ${telemetry.totalHeight}`,
    `internal telemetry viewport range: ${telemetry.visibleRowRange.start}-${telemetry.visibleRowRange.end}`,
    `internal telemetry selected row: ${telemetry.selectedRowId ?? "none"}`,
    `internal telemetry focused row: ${telemetry.focusedRowId ?? "none"}`,
  ];
}

export function createBenchInteractionStateFromTelemetry(
  telemetry: PretableTelemetry | null,
  fallbackRowCount: number,
): BenchInteractionState {
  if (!telemetry) {
    return {
      focusedRowId: null,
      resultRowCount: fallbackRowCount,
      selectedRowId: null,
    };
  }

  return {
    focusedRowId: telemetry.focusedRowId,
    resultRowCount: telemetry.rowModelRowCount,
    selectedRowId: telemetry.selectedRowId,
  };
}

export function getMaxInteractionFrames(
  maxSettleFrames: number,
  mode: "sort" | "filter-metadata" | "filter-text",
) {
  const baseline = Math.max(maxSettleFrames + 12, 48);

  return mode === "filter-text" ? Math.max(baseline, 96) : baseline;
}

export function detectBrowserVersion(userAgent: string): string {
  const chromeMatch = userAgent.match(/Chrome\/([\d.]+)/);

  if (chromeMatch) {
    return chromeMatch[1];
  }

  const firefoxMatch = userAgent.match(/Firefox\/([\d.]+)/);

  if (firefoxMatch) {
    return firefoxMatch[1];
  }

  return "local-dev";
}

export interface ScrollBenchRunResult {
  status: "completed" | "partial";
  metrics: Partial<Record<BenchMetricId, number>>;
  notes: string[];
}

export interface InteractionBenchRunResult {
  status: "completed" | "partial";
  metrics: Partial<Record<BenchMetricId, number>>;
  notes: string[];
}

interface BenchInteractionState {
  focusedRowId: string | null;
  resultRowCount: number;
  selectedRowId: string | null;
}

interface ScrollRuntimeProfile {
  viewportSelector: string;
  rowSelector: string;
  cellSelector: string;
  rowIdAttribute?: string;
  rowIndexAttribute: string;
  maxSettleFrames: number;
  measureRowHeightError: (row: HTMLElement, renderedHeight: number) => number;
}

const scrollRuntimeProfiles: Record<
  BenchQueryState["adapterId"],
  ScrollRuntimeProfile
> = {
  "ag-grid": {
    viewportSelector: ".ag-body-viewport",
    rowSelector: ".ag-row",
    cellSelector: ".ag-cell",
    rowIdAttribute: "row-id",
    rowIndexAttribute: "row-index",
    maxSettleFrames: 1,
    measureRowHeightError: measureAgGridRowHeightError,
  },
  pretable: {
    viewportSelector: "[data-pretable-scroll-viewport]",
    rowSelector: "[data-pretable-row]",
    cellSelector: "[data-pretable-cell]",
    rowIdAttribute: "data-row-id",
    rowIndexAttribute: "data-row-index",
    maxSettleFrames: 3,
    measureRowHeightError: (row, renderedHeight) =>
      measureWrappedCellRowHeightError(
        row,
        renderedHeight,
        "[data-pretable-cell]",
      ),
  },
  tanstack: {
    viewportSelector: "[data-tanstack-scroll-viewport]",
    rowSelector: "[data-tanstack-row]",
    cellSelector: "[data-tanstack-cell]",
    rowIdAttribute: "data-row-id",
    rowIndexAttribute: "data-row-index",
    maxSettleFrames: 4,
    measureRowHeightError: (row, renderedHeight) =>
      measureWrappedCellRowHeightError(
        row,
        renderedHeight,
        "[data-tanstack-cell]",
      ),
  },
  mui: {
    viewportSelector: ".MuiDataGrid-virtualScroller",
    rowSelector: ".MuiDataGrid-row",
    cellSelector: ".MuiDataGrid-cell",
    rowIdAttribute: "data-id",
    rowIndexAttribute: "data-rowindex",
    maxSettleFrames: 4,
    measureRowHeightError: (row, renderedHeight) =>
      measureWrappedCellRowHeightError(
        row,
        renderedHeight,
        ".MuiDataGrid-cell",
      ),
  },
};

export async function measureBenchScrollRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
): Promise<ScrollBenchRunResult> {
  const profile = scrollRuntimeProfiles[adapterId];
  const viewport = await waitForScrollViewport(root, profile.viewportSelector);
  const viewportPolicyNotes = viewport
    ? detectViewportPolicyNotes(viewport)
    : [];

  if (!viewport || viewport.scrollHeight <= viewport.clientHeight) {
    return {
      status: "partial",
      notes: [
        ...viewportPolicyNotes,
        `scroll viewport unavailable for ${adapterId} in current runtime`,
      ],
      metrics: {
        dom_nodes_peak: root.querySelectorAll("*").length,
        scroll_viewport_nodes_peak: viewport
          ? countViewportSubtreeNodes(viewport)
          : 0,
        rendered_rows_peak: root.querySelectorAll(profile.rowSelector).length,
        rendered_cells_peak: root.querySelectorAll(profile.cellSelector).length,
      },
    };
  }

  const longTaskDurations: number[] = [];
  const observer = createLongTaskObserver(longTaskDurations);
  const notes = viewportPolicyNotes;
  const frameDurations: number[] = [];
  const rowHeightErrors: number[] = [];
  const anchorShifts: number[] = [];
  const forwardAnchorShifts: number[] = [];
  const backwardAnchorShifts: number[] = [];
  let domNodesPeak = root.querySelectorAll("*").length;
  let scrollViewportNodesPeak = countViewportSubtreeNodes(viewport);
  let renderedRowsPeak = root.querySelectorAll(profile.rowSelector).length;
  let renderedCellsPeak = root.querySelectorAll(profile.cellSelector).length;
  let blankGapFrames = 0;
  let previousFrameTimestamp: number | null = null;
  let previousVisibleRows: VisibleRowSample[] = [];
  let previousScrollTop = 0;
  const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
  const steps = 18;
  const scrollTargets = [
    ...Array.from(
      { length: steps },
      (_, index) => ((index + 1) * maxScrollTop) / steps,
    ),
    ...Array.from(
      { length: steps },
      (_, index) => maxScrollTop - ((index + 1) * maxScrollTop) / steps,
    ),
  ];

  viewport.scrollTop = 0;
  let initialFrameTimestamp: number | null = previousFrameTimestamp;

  for await (const sample of waitForSettledScrollSample(viewport, profile)) {
    if (initialFrameTimestamp !== null) {
      frameDurations.push(sample.timestamp - initialFrameTimestamp);
    }

    initialFrameTimestamp = sample.timestamp;
  }

  previousFrameTimestamp = initialFrameTimestamp;

  for (const scrollTarget of scrollTargets) {
    viewport.scrollTop = scrollTarget;
    let settledSample = null;

    for await (const sample of waitForSettledScrollSample(viewport, profile)) {
      if (previousFrameTimestamp !== null) {
        frameDurations.push(sample.timestamp - previousFrameTimestamp);
      }

      previousFrameTimestamp = sample.timestamp;
      settledSample = sample;
    }

    const visibleRows =
      settledSample?.visibleRows ?? sampleVisibleRows(viewport, profile);
    const hasBlankGap =
      settledSample?.hasBlankGap ??
      detectBlankGapFrame(viewport, profile.rowSelector);
    domNodesPeak = Math.max(domNodesPeak, root.querySelectorAll("*").length);
    scrollViewportNodesPeak = Math.max(
      scrollViewportNodesPeak,
      countViewportSubtreeNodes(viewport),
    );
    renderedRowsPeak = Math.max(
      renderedRowsPeak,
      root.querySelectorAll(profile.rowSelector).length,
    );
    renderedCellsPeak = Math.max(
      renderedCellsPeak,
      root.querySelectorAll(profile.cellSelector).length,
    );

    if (hasBlankGap) {
      blankGapFrames += 1;
    }

    rowHeightErrors.push(
      ...visibleRows.map((row) => row.heightError).filter((value) => value > 0),
    );

    const anchorShift = measureAnchorShift({
      previousVisibleRows,
      previousScrollTop,
      nextVisibleRows: visibleRows,
      nextScrollTop: viewport.scrollTop,
    });

    if (anchorShift !== null) {
      anchorShifts.push(anchorShift);

      if (viewport.scrollTop > previousScrollTop) {
        forwardAnchorShifts.push(anchorShift);
      } else if (viewport.scrollTop < previousScrollTop) {
        backwardAnchorShifts.push(anchorShift);
      }
    }

    previousVisibleRows = visibleRows;
    previousScrollTop = viewport.scrollTop;
  }

  observer?.disconnect();

  if (!observer || frameDurations.length === 0) {
    return {
      status: "partial",
      notes,
      metrics: {
        dom_nodes_peak: domNodesPeak,
        scroll_viewport_nodes_peak: scrollViewportNodesPeak,
        rendered_rows_peak: renderedRowsPeak,
        rendered_cells_peak: renderedCellsPeak,
        blank_gap_frames: blankGapFrames,
      },
    };
  }

  return {
    status: "completed",
    notes,
    metrics: {
      scroll_frame_p95_ms: percentile(frameDurations, 0.95),
      blank_gap_frames: blankGapFrames,
      long_tasks_count: longTaskDurations.length,
      long_tasks_ms: longTaskDurations.reduce(
        (total, duration) => total + duration,
        0,
      ),
      dom_nodes_peak: domNodesPeak,
      scroll_viewport_nodes_peak: scrollViewportNodesPeak,
      rendered_rows_peak: renderedRowsPeak,
      rendered_cells_peak: renderedCellsPeak,
      row_height_error_p95_px: percentile(rowHeightErrors, 0.95),
      scroll_anchor_shift_px: percentile(anchorShifts, 0.95),
      scroll_anchor_shift_forward_p95_px: percentile(forwardAnchorShifts, 0.95),
      scroll_anchor_shift_backward_p95_px: percentile(
        backwardAnchorShifts,
        0.95,
      ),
    },
  };
}

export function measurePretableScrollRun(
  root: HTMLElement,
): Promise<ScrollBenchRunResult> {
  return measureBenchScrollRun(root, "pretable");
}

export async function measureBenchInteractionRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
  mode: "sort" | "filter-metadata" | "filter-text",
  interactionPlan: {
    focusedRowId: string | null;
    resultRowCount: number;
    selectedRowId: string | null;
  },
  readInteractionStateOverride: (() => BenchInteractionState) | undefined,
  trigger: () => void,
): Promise<InteractionBenchRunResult> {
  const profile = scrollRuntimeProfiles[adapterId];
  const viewport = await waitForScrollViewport(root, profile.viewportSelector);
  const viewportPolicyNotes = viewport
    ? detectViewportPolicyNotes(viewport)
    : [];

  if (!viewport) {
    return {
      status: "partial",
      notes: [
        ...viewportPolicyNotes,
        `interaction mode: ${mode}`,
        `interaction viewport unavailable for ${adapterId} in current runtime`,
      ],
      metrics: {
        dom_nodes_peak: root.querySelectorAll("*").length,
      },
    };
  }

  const baselineState = readBenchInteractionState(
    root,
    readInteractionStateOverride,
  );
  const baselineVisibleRows = sampleVisibleRows(viewport, profile);
  const baselineSignature = createVisibleRowSignature(
    baselineVisibleRows,
    baselineState.resultRowCount,
  );
  const startTimestamp = await waitForAnimationFrame();

  trigger();

  let domNodesPeak = root.querySelectorAll("*").length;
  let renderedRowsPeak = root.querySelectorAll(profile.rowSelector).length;
  let renderedCellsPeak = root.querySelectorAll(profile.cellSelector).length;
  let firstChangedAt: number | null = null;
  let settledAt: number | null = null;
  let blankGapFrames = 0;
  const rowHeightErrors: number[] = [];
  const anchorShifts: number[] = [];
  let previousVisibleRows = baselineVisibleRows;
  let previousScrollTop = viewport.scrollTop;
  let previousSignature = baselineSignature;
  let previousState = baselineState;
  let stableFrames = 0;
  const maxInteractionFrames = getMaxInteractionFrames(
    profile.maxSettleFrames,
    mode,
  );

  for (let frame = 0; frame < maxInteractionFrames; frame += 1) {
    const timestamp = await waitForAnimationFrame();
    const visibleRows = sampleVisibleRows(viewport, profile);
    const interactionState = readBenchInteractionState(
      root,
      readInteractionStateOverride,
    );
    const signature = createVisibleRowSignature(
      visibleRows,
      interactionState.resultRowCount,
    );
    const hasBlankGap = detectBlankGapFrame(viewport, profile.rowSelector);

    domNodesPeak = Math.max(domNodesPeak, root.querySelectorAll("*").length);
    renderedRowsPeak = Math.max(
      renderedRowsPeak,
      root.querySelectorAll(profile.rowSelector).length,
    );
    renderedCellsPeak = Math.max(
      renderedCellsPeak,
      root.querySelectorAll(profile.cellSelector).length,
    );

    const isFirstChangedFrame =
      firstChangedAt === null &&
      (signature !== baselineSignature ||
        interactionState.resultRowCount !== baselineState.resultRowCount);

    if (isFirstChangedFrame) {
      firstChangedAt = timestamp;
    }

    if (firstChangedAt === null) {
      previousVisibleRows = visibleRows;
      previousScrollTop = viewport.scrollTop;
      previousSignature = signature;
      previousState = interactionState;
      continue;
    }

    if (isFirstChangedFrame) {
      previousVisibleRows = visibleRows;
      previousScrollTop = viewport.scrollTop;
      previousSignature = signature;
      previousState = interactionState;
      stableFrames = 0;
      continue;
    }

    if (hasBlankGap) {
      blankGapFrames += 1;
    }

    rowHeightErrors.push(
      ...visibleRows.map((row) => row.heightError).filter((value) => value > 0),
    );

    const anchorShift = measureAnchorShift({
      previousVisibleRows,
      previousScrollTop,
      nextVisibleRows: visibleRows,
      nextScrollTop: viewport.scrollTop,
    });

    if (anchorShift !== null) {
      anchorShifts.push(anchorShift);
    }

    if (
      signature === previousSignature &&
      interactionState.resultRowCount === previousState.resultRowCount &&
      interactionState.selectedRowId === previousState.selectedRowId &&
      interactionState.focusedRowId === previousState.focusedRowId
    ) {
      stableFrames += 1;
    } else {
      stableFrames = 0;
    }

    previousVisibleRows = visibleRows;
    previousScrollTop = viewport.scrollTop;
    previousSignature = signature;
    previousState = interactionState;

    if (stableFrames >= Math.max(0, profile.maxSettleFrames - 1)) {
      settledAt = timestamp;
      break;
    }
  }

  if (firstChangedAt === null || settledAt === null) {
    return {
      status: "partial",
      notes: [...viewportPolicyNotes, `interaction mode: ${mode}`],
      metrics: {
        dom_nodes_peak: domNodesPeak,
        rendered_rows_peak: renderedRowsPeak,
        rendered_cells_peak: renderedCellsPeak,
      },
    };
  }

  const finalState = readBenchInteractionState(
    root,
    readInteractionStateOverride,
  );

  return {
    status: "completed",
    notes: [...viewportPolicyNotes, `interaction mode: ${mode}`],
    metrics: {
      interaction_latency_ms: firstChangedAt - startTimestamp,
      settle_duration_ms: settledAt - firstChangedAt,
      post_interaction_blank_gap_frames: blankGapFrames,
      post_interaction_anchor_shift_px: percentile(anchorShifts, 0.95),
      post_interaction_row_height_error_p95_px: percentile(
        rowHeightErrors,
        0.95,
      ),
      result_row_count: finalState.resultRowCount,
      selected_row_preserved:
        finalState.selectedRowId === interactionPlan.selectedRowId ? 1 : 0,
      focused_row_preserved:
        finalState.focusedRowId === interactionPlan.focusedRowId ? 1 : 0,
      dom_nodes_peak: domNodesPeak,
      rendered_rows_peak: renderedRowsPeak,
      rendered_cells_peak: renderedCellsPeak,
    },
  };
}

export interface UpdatesBenchRunResult {
  status: "completed" | "partial";
  metrics: Partial<Record<BenchMetricId, number>>;
  notes: string[];
}

/**
 * Caller-supplied function that applies a batch of update patches to the
 * adapter's grid. Each adapter wires this to its idiomatic streaming
 * pattern (Pretable: stream-adapter batcher → applyTransaction; AG Grid:
 * gridApi.applyTransaction directly; MUI: apiRef.updateRows directly;
 * TanStack: setRows merge).
 */
export type ApplyBenchUpdates = (
  patches: Record<string, unknown>[],
) => void | Promise<void>;

export interface MeasureBenchUpdatesOptions {
  /**
   * Patches per second to apply via the caller-supplied `apply` callback.
   * Defaults to 1000 — the existing S5 default. The bench varies batch
   * size to hit the rate at a fixed 50 ms tick, keeping RAF/timer
   * behavior consistent across rates.
   */
  updateRatePerSec?: number;
}

export async function measureBenchUpdatesRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
  apply: ApplyBenchUpdates,
  dataset: {
    rows: readonly Record<string, unknown>[];
    columns: readonly { id: string }[];
  },
  options: MeasureBenchUpdatesOptions = {},
): Promise<UpdatesBenchRunResult> {
  const profile = scrollRuntimeProfiles[adapterId];
  const viewport = await waitForScrollViewport(root, profile.viewportSelector);
  const viewportPolicyNotes = viewport
    ? detectViewportPolicyNotes(viewport)
    : [];

  if (!viewport) {
    return {
      status: "partial",
      notes: [...viewportPolicyNotes, "updates viewport unavailable"],
      metrics: {},
    };
  }

  const BATCH_INTERVAL_MS = 50;
  const DURATION_MS = 3_000;
  const FRAME_BUDGET_MS = 16;
  const updateRatePerSec = options.updateRatePerSec ?? 1000;
  // Vary batch size to hit the rate at a fixed 50ms tick. RAF/timer
  // behavior stays consistent across rates so frame metrics stay
  // comparable; only the per-batch work shifts.
  const UPDATES_PER_TICK = Math.max(
    1,
    Math.round((updateRatePerSec * BATCH_INTERVAL_MS) / 1000),
  );
  const columnIds = dataset.columns.map((c) => c.id);

  let totalUpdates = 0;
  const longTaskDurations: number[] = [];
  const observer = createLongTaskObserver(longTaskDurations);
  const layoutShiftValues: number[] = [];
  const layoutShiftObserver = createLayoutShiftObserver(layoutShiftValues);
  const frameDurations: number[] = [];
  let previousFrameTimestamp: number | null = null;

  // Snapshot the viewport's pre-streaming pose so we can detect drift.
  // scrollTop drift signals an unwanted scroll caused by row mutations;
  // visible-row-count drift signals the surface had to re-virtualize.
  const scrollTopBefore = viewport.scrollTop;
  const visibleRowCountBefore = root.querySelectorAll(
    profile.rowSelector,
  ).length;

  const rafHandle = { running: true, id: 0 };
  const tickRaf = () => {
    if (!rafHandle.running) return;
    rafHandle.id = requestAnimationFrame((ts) => {
      if (previousFrameTimestamp !== null) {
        frameDurations.push(ts - previousFrameTimestamp);
      }

      previousFrameTimestamp = ts;
      tickRaf();
    });
  };

  tickRaf();

  try {
    await new Promise<void>((resolve, reject) => {
      let elapsed = 0;

      const interval = setInterval(() => {
        try {
          elapsed += BATCH_INTERVAL_MS;

          const patches: Record<string, unknown>[] = [];

          for (let i = 0; i < UPDATES_PER_TICK; i += 1) {
            const rowIndex = Math.floor(Math.random() * dataset.rows.length);
            const row = dataset.rows[rowIndex];
            const colIndex = Math.floor(Math.random() * columnIds.length);
            const columnId = columnIds[colIndex];
            const id = String((row as Record<string, unknown>).id ?? rowIndex);

            patches.push({ id, [columnId]: `upd-${totalUpdates + i}` });
          }

          const applyResult = apply(patches);
          if (applyResult && typeof applyResult.then === "function") {
            // The caller can return a Promise (e.g., flush before resolve);
            // we don't await within the interval to keep the cadence honest,
            // but we do swallow rejections so they surface via the outer
            // try/catch above.
            applyResult.catch((err) => {
              clearInterval(interval);
              reject(err);
            });
          }
          totalUpdates += UPDATES_PER_TICK;

          if (elapsed >= DURATION_MS) {
            clearInterval(interval);
            resolve();
          }
        } catch (err) {
          clearInterval(interval);
          reject(err);
        }
      }, BATCH_INTERVAL_MS);
    });
  } finally {
    rafHandle.running = false;
    cancelAnimationFrame(rafHandle.id);
    observer?.disconnect();
    layoutShiftObserver?.disconnect();
  }

  const domNodesPeak = root.querySelectorAll("*").length;
  const renderedRowsPeak = root.querySelectorAll(profile.rowSelector).length;
  const renderedCellsPeak = root.querySelectorAll(profile.cellSelector).length;

  // Beyond-p95 metrics. They surface jank that frame p95 alone misses.
  const streamingCls = layoutShiftValues.reduce((sum, v) => sum + v, 0);
  const frameMaxMs =
    frameDurations.length > 0 ? Math.max(...frameDurations) : 0;
  const frameBudgetOverruns = frameDurations.reduce(
    (count, d) => (d > FRAME_BUDGET_MS ? count + 1 : count),
    0,
  );
  const longTasksMaxMs =
    longTaskDurations.length > 0 ? Math.max(...longTaskDurations) : 0;
  const scrollPositionDriftPx = Math.abs(viewport.scrollTop - scrollTopBefore);
  const visibleRowCountDrift = Math.abs(
    renderedRowsPeak - visibleRowCountBefore,
  );

  return {
    status: "completed",
    notes: [
      ...viewportPolicyNotes,
      `updates total: ${totalUpdates}`,
      `update rate per sec: ${updateRatePerSec}`,
      `updates per tick: ${UPDATES_PER_TICK}`,
      `batch interval ms: ${BATCH_INTERVAL_MS}`,
      `duration ms: ${DURATION_MS}`,
      `frame budget threshold ms: ${FRAME_BUDGET_MS}`,
      `total frames sampled: ${frameDurations.length}`,
    ],
    metrics: {
      scroll_frame_p95_ms: percentile(frameDurations, 0.95),
      long_tasks_count: longTaskDurations.length,
      long_tasks_ms: longTaskDurations.reduce((t, d) => t + d, 0),
      dom_nodes_peak: domNodesPeak,
      rendered_rows_peak: renderedRowsPeak,
      rendered_cells_peak: renderedCellsPeak,
      streaming_cls: streamingCls,
      frame_max_ms: frameMaxMs,
      frame_budget_overruns_count: frameBudgetOverruns,
      long_tasks_max_ms: longTasksMaxMs,
      scroll_position_drift_px: scrollPositionDriftPx,
      visible_row_count_drift: visibleRowCountDrift,
    },
  };
}

function createLongTaskObserver(longTaskDurations: number[]) {
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    return null;
  }

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTaskDurations.push(entry.duration);
    }
  });

  observer.observe({
    type: "longtask",
  });

  return observer;
}

/**
 * Observes layout-shift entries during the run and accumulates the
 * shift value of those that weren't user-initiated. This is the same
 * computation Chrome's CLS web-vital does, scoped to the streaming
 * window. Returns null on browsers that don't expose layout-shift.
 */
function createLayoutShiftObserver(layoutShiftValues: number[]) {
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("layout-shift")
  ) {
    return null;
  }

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      // The layout-shift entry exposes value (the shift score) and
      // hadRecentInput (whether the shift happened within 500ms of a
      // user gesture, which would justify the shift). We only care
      // about unexpected shifts that happen during streaming.
      const shiftEntry = entry as PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      };
      if (!shiftEntry.hadRecentInput) {
        layoutShiftValues.push(shiftEntry.value);
      }
    }
  });

  observer.observe({
    type: "layout-shift",
    buffered: false,
  });

  return observer;
}

export function detectBlankGapFrame(
  viewport: HTMLElement,
  rowSelector = "[data-pretable-row]",
) {
  const rows = [...viewport.querySelectorAll<HTMLElement>(rowSelector)];

  if (rows.length === 0) {
    return true;
  }

  const viewportBounds = getViewportContentBounds(viewport);
  const stickyOverlays = [...viewport.querySelectorAll<HTMLElement>("*")]
    .filter(
      (element) =>
        !element.matches(rowSelector) && element.closest(rowSelector) === null,
    )
    .filter((element) => getComputedStyle(element).position === "sticky");
  const clippedRects = [...rows, ...stickyOverlays]
    .map((element) => element.getBoundingClientRect())
    .map((rect) => ({
      top: Math.max(rect.top, viewportBounds.top),
      bottom: Math.min(rect.bottom, viewportBounds.bottom),
    }))
    .filter((rect) => rect.bottom > rect.top)
    .sort((left, right) => left.top - right.top);

  if (clippedRects.length === 0) {
    return true;
  }

  let cursor = viewportBounds.top;

  for (const rect of clippedRects) {
    if (rect.top > cursor + 1) {
      return true;
    }

    cursor = Math.max(cursor, rect.bottom);
  }

  return cursor < viewportBounds.bottom - 1;
}

function waitForAnimationFrame() {
  return new Promise<number>((resolve) => {
    requestAnimationFrame((timestamp) => {
      resolve(timestamp);
    });
  });
}

function detectScrollAnchoringNote(viewport: HTMLElement) {
  return detectViewportStyleNote(
    viewport,
    "scroll anchoring",
    "overflowAnchor",
  );
}

function detectOverscrollBehaviorNote(viewport: HTMLElement) {
  return detectViewportStyleNote(
    viewport,
    "overscroll behavior",
    "overscrollBehavior",
  );
}

function detectContainmentNote(viewport: HTMLElement) {
  return detectViewportStyleNote(viewport, "contain", "contain");
}

function detectContentVisibilityNote(viewport: HTMLElement) {
  return detectViewportStyleNote(
    viewport,
    "content visibility",
    "contentVisibility",
  );
}

function detectContainIntrinsicSizeNote(viewport: HTMLElement) {
  return detectViewportStyleNote(
    viewport,
    "contain intrinsic size",
    "containIntrinsicSize",
  );
}

function detectViewportPolicyNotes(viewport: HTMLElement) {
  return [
    detectContainmentNote(viewport),
    detectContentVisibilityNote(viewport),
    detectContainIntrinsicSizeNote(viewport),
    detectScrollAnchoringNote(viewport),
    detectOverscrollBehaviorNote(viewport),
  ];
}

function detectViewportStyleNote(
  viewport: HTMLElement,
  label: string,
  property:
    | "contain"
    | "containIntrinsicSize"
    | "contentVisibility"
    | "overflowAnchor"
    | "overscrollBehavior",
) {
  if (typeof getComputedStyle !== "function") {
    return `${label}: unknown`;
  }

  return `${label}: ${getComputedStyle(viewport)[property] || "unknown"}`;
}

function countViewportSubtreeNodes(viewport: HTMLElement) {
  return viewport.querySelectorAll("*").length + 1;
}

async function waitForScrollViewport(
  root: HTMLElement,
  selector: string,
  maxFrames = 12,
) {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const viewport = root.querySelector<HTMLElement>(selector);

    if (viewport) {
      return viewport;
    }

    await waitForAnimationFrame();
  }

  return null;
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );

  return sorted[index] ?? 0;
}

async function* waitForSettledScrollSample(
  viewport: HTMLElement,
  profile: ScrollRuntimeProfile,
) {
  let latestSample = null;

  for (let frame = 0; frame < profile.maxSettleFrames; frame += 1) {
    const timestamp = await waitForAnimationFrame();
    const visibleRows = sampleVisibleRows(viewport, profile);
    const hasBlankGap = detectBlankGapFrame(viewport, profile.rowSelector);

    latestSample = {
      hasBlankGap,
      timestamp,
      visibleRows,
    };
    yield latestSample;

    if (!hasBlankGap) {
      return;
    }
  }

  if (latestSample === null) {
    return;
  }
}

interface VisibleRowSample {
  rowId: string;
  rowIndex: number;
  top: number;
  heightError: number;
}

function sampleVisibleRows(
  viewport: HTMLElement,
  profile: ScrollRuntimeProfile,
): VisibleRowSample[] {
  const viewportBounds = getViewportContentBounds(viewport);

  return [...viewport.querySelectorAll<HTMLElement>(profile.rowSelector)]
    .map((row) => {
      const rect = row.getBoundingClientRect();
      const clippedTop = Math.max(rect.top, viewportBounds.top);
      const clippedBottom = Math.min(rect.bottom, viewportBounds.bottom);
      const rowIndex = Number(row.getAttribute(profile.rowIndexAttribute));

      if (clippedBottom <= clippedTop) {
        return null;
      }

      return {
        rowId:
          row.getAttribute(profile.rowIdAttribute ?? "") ??
          getRowIdentityFallback(row, profile.cellSelector, rowIndex),
        rowIndex: Number(row.getAttribute(profile.rowIndexAttribute)),
        top: rect.top - viewportBounds.top,
        heightError: profile.measureRowHeightError(row, rect.height),
      } satisfies VisibleRowSample;
    })
    .filter((row): row is VisibleRowSample => row !== null);
}

function measureAnchorShift(input: {
  previousVisibleRows: VisibleRowSample[];
  previousScrollTop: number;
  nextVisibleRows: VisibleRowSample[];
  nextScrollTop: number;
}) {
  const previousByIndex = new Map(
    input.previousVisibleRows.map((row) => [row.rowId, row]),
  );
  const nextMatch = input.nextVisibleRows.find((row) =>
    previousByIndex.has(row.rowId),
  );

  if (!nextMatch) {
    return null;
  }

  const previousMatch = previousByIndex.get(nextMatch.rowId);

  if (!previousMatch) {
    return null;
  }

  const expectedTop =
    previousMatch.top - (input.nextScrollTop - input.previousScrollTop);

  return Math.abs(nextMatch.top - expectedTop);
}

function createVisibleRowSignature(
  rows: VisibleRowSample[],
  resultRowCount: number,
) {
  return `${resultRowCount}:${rows
    .map((row) => `${row.rowId}@${Math.round(row.top)}`)
    .join("|")}`;
}

function getRowIdentityFallback(
  row: HTMLElement,
  cellSelector: string,
  rowIndex: number,
) {
  const firstCell = row.querySelector<HTMLElement>(cellSelector);

  return firstCell?.textContent?.trim() || `row-${rowIndex}`;
}

function readBenchInteractionState(
  root: HTMLElement,
  readInteractionStateOverride?: () => BenchInteractionState,
) {
  if (readInteractionStateOverride) {
    return readInteractionStateOverride();
  }

  const adapter = root.querySelector<HTMLElement>("[data-benchmark-adapter]");

  return {
    focusedRowId: adapter?.dataset.benchFocusedRowId ?? null,
    resultRowCount: Number(adapter?.dataset.benchResultRowCount ?? "0"),
    selectedRowId: adapter?.dataset.benchSelectedRowId ?? null,
  };
}

function getViewportContentBounds(viewport: HTMLElement) {
  const rect = viewport.getBoundingClientRect();
  const top = rect.top + viewport.clientTop;
  const bottom = top + viewport.clientHeight;

  return {
    top,
    bottom,
  };
}

function measureWrappedCellRowHeightError(
  row: HTMLElement,
  renderedHeight: number,
  cellSelector: string,
) {
  const style = getComputedStyle(row);
  const verticalPadding =
    parseFloat(style.paddingTop || "0") +
    parseFloat(style.paddingBottom || "0");
  const borderHeight = parseFloat(style.borderBottomWidth || "0");
  const contentHeight = Math.max(
    0,
    ...[...row.querySelectorAll<HTMLElement>(cellSelector)]
      .map((cell) => cell.scrollHeight)
      .filter(Number.isFinite),
  );
  const expectedHeight = contentHeight + verticalPadding + borderHeight;

  return Math.abs(expectedHeight - renderedHeight);
}

function measureAgGridRowHeightError(row: HTMLElement, renderedHeight: number) {
  const expectedHeight = parseFloat(
    row.style.height || getComputedStyle(row).height || "0",
  );

  return Math.abs(expectedHeight - renderedHeight);
}
