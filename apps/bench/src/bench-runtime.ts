import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import type {
  BenchErrorPayload,
  BenchMetricId,
  BenchRunRequest,
  BenchRunSummary,
} from "@pretable-internal/bench-runner";
import type { PretableTelemetry } from "@pretable/react";

import type { BenchQueryState } from "./bench-types";
import type { RowModelBenchSummary } from "./bench-types";
import type { RowModelDiagnosticsController } from "./row-model-diagnostics";
import {
  createDeterministicUpdatePlan,
  ROW_MODEL_BATCH_INTERVAL_MS,
  type DeterministicUpdatePlan,
} from "./update-plan";

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

  // Note keys must keep the "internal telemetry " prefix: scripts/bench-matrix.mjs
  // uses it (DIAGNOSTIC_NOTE_KEY_PREFIX) to exclude these from the policy-drift
  // signal. "loaded rows" — not "total rows" — because loadedRowCount counts the
  // records the grid holds, which under server-side processing is a window over a
  // larger matching population; a label saying "total" would mis-describe it.
  // Archived runsets under status/milestones/ keep the old key verbatim; nothing
  // compares live runs against them, so the rename costs no comparability.
  return [
    `internal telemetry rendered rows: ${telemetry.renderedRowCount}`,
    `internal telemetry visible rows: ${telemetry.visibleRowCount}`,
    `internal telemetry loaded rows: ${telemetry.loadedRowCount}`,
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

export type BenchInteractionMode =
  "sort" | "filter-metadata" | "filter-text" | "group" | "group-expand";

export function getMaxInteractionFrames(
  maxSettleFrames: number,
  mode: BenchInteractionMode,
) {
  const baseline = Math.max(maxSettleFrames + 12, 48);

  // Wrapped-text filtering and row grouping both re-derive the whole visible
  // model and then re-measure wrapped rows, so they need the wider budget.
  return mode === "filter-text" || mode === "group" || mode === "group-expand"
    ? Math.max(baseline, 96)
    : baseline;
}

/**
 * Outcome for the `initial` script, which has no measurement function of its own:
 * it times the mount and reports what the surface looks like afterwards.
 *
 * A mount that painted no rows is not a mount worth timing. Nothing downstream
 * could tell the difference before this: `initial` reported `completed` and
 * published `mount_ms` and `first_stable_viewport_ms` for an empty shell, which
 * is how a surface that had stopped rendering entirely kept producing green
 * mount numbers.
 *
 * The timings stay on the failed outcome rather than being stripped, because
 * `assertRequiredMetrics` demands them for `initial` at every status — so the
 * status and `rendered_rows_peak` are what have to carry the truth here, and the
 * note says it in words.
 */
export function createInitialRunOutcome(input: {
  renderedRowCount: number;
  mountMs: number;
  domNodesPeak: number;
}): {
  status: "completed" | "partial";
  notes: string[];
  metrics: Partial<Record<BenchMetricId, number>>;
} {
  const metrics = {
    mount_ms: input.mountMs,
    first_stable_viewport_ms: input.mountMs,
    dom_nodes_peak: input.domNodesPeak,
    rendered_rows_peak: input.renderedRowCount,
  } satisfies Partial<Record<BenchMetricId, number>>;

  if (input.renderedRowCount > 0) {
    return { status: "completed", notes: [], metrics };
  }

  return {
    status: "partial",
    notes: [
      `mount rendered ${input.renderedRowCount} rows: the timings below measure a grid that never painted a row`,
    ],
    metrics,
  };
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

/**
 * What `measureBenchDataUpdateRun` hands back. No `partial`: bench-runner refuses to
 * record one for `replace`/`append` (a partial there owes only `dom_nodes_peak`, so it
 * would file a run that measured nothing under a name the ledger reads as a
 * measurement), and every way this measurement can stop short is a stop with a known
 * cause. Carrying that cause out as an error is what lets the caller file a failed run
 * that says why instead of one that says only that the status was wrong.
 */
export type DataUpdateBenchRunResult =
  | {
      status: "completed";
      metrics: Partial<Record<BenchMetricId, number>>;
      notes: string[];
    }
  | {
      status: "failed";
      metrics: Partial<Record<BenchMetricId, number>>;
      notes: string[];
      error: BenchErrorPayload;
    };

interface BenchInteractionState {
  focusedRowId: string | null;
  resultRowCount: number;
  selectedRowId: string | null;
}

export interface ScrollRuntimeProfile {
  viewportSelector: string;
  rowSelector: string;
  cellSelector: string;
  rowIdAttribute?: string;
  /**
   * Attribute carrying a body cell's column id. Read only by
   * `createVisibleContentSignature`; when a profile omits it that signature falls
   * back to each row's first cell, which is a weaker probe but never a wrong one.
   */
  cellColumnIdAttribute?: string;
  rowIndexAttribute: string;
  maxSettleFrames: number;
  measureRowHeightError: (row: HTMLElement, renderedHeight: number) => number;
}

/**
 * How the harness finds each adapter's scrolling DOM.
 *
 * Exported so `__tests__/comparator-dom-contract.test.tsx` can hold every entry
 * against the adapter it describes by MOUNTING it. Two of these selector sets
 * belong to third-party libraries, and a selector a library has deleted does
 * not fail loudly here — `measureBenchScroll` returns `status: "partial"`
 * having scrolled nothing, which reads as an implausibly cheap comparator
 * rather than a broken harness. That is exactly what AG Grid 36 did to
 * `.ag-body-viewport` (#306).
 */
export const scrollRuntimeProfiles: Record<
  BenchQueryState["adapterId"],
  ScrollRuntimeProfile
> = {
  "ag-grid": {
    // AG Grid 36 replaced the old multi-container body DOM (9+ nested
    // containers, scroller = `.ag-body-viewport`) with a single scrolling
    // container, `.ag-grid-viewport` — the element carrying `overflow: auto`
    // in the shipped theme CSS. `.ag-body-viewport` no longer exists in 36,
    // and a stale selector here does NOT fail loudly: `measureBenchScroll`
    // reports `status: "partial"` with zero scroll work done, which reads as
    // an implausibly cheap AG Grid rather than a broken harness. Keep this in
    // sync with the `.ag-grid-viewport` rule in app.css, which is what
    // disables scroll anchoring for this adapter.
    viewportSelector: ".ag-grid-viewport",
    rowSelector: ".ag-row",
    cellSelector: ".ag-cell",
    rowIdAttribute: "row-id",
    rowIndexAttribute: "row-index",
    maxSettleFrames: 1,
    // Unified with the other adapters: row.height vs max(cell.scrollHeight)
    // + padding + border. AG Grid's wrapped + virtualized rows can clip
    // content (cell.scrollHeight ≫ row.height) — that's a user-visible
    // behavior, not a measurement artifact.
    measureRowHeightError: (row, renderedHeight) =>
      measureWrappedCellRowHeightError(row, renderedHeight, ".ag-cell"),
  },
  pretable: {
    viewportSelector: "[data-pretable-scroll-viewport]",
    // Group rows are marked `data-pretable-group-row`, NOT `data-pretable-row`
    // (see packages/react/src/group-row.tsx), so a data-row-only selector
    // treats every group header as a hole: `detectBlankGapFrame` reports a
    // blank gap, `sampleVisibleRows` drops it from the settle signature, and
    // `rendered_rows_peak` undercounts. Both kinds carry
    // `data-pretable-row-id` / `-index` and `data-pretable-cell` children, so
    // the union works everywhere the profile is read.
    //
    // This is a no-op for every ungrouped run: with no group rows in the DOM
    // the union matches exactly the same node list as before.
    rowSelector: "[data-pretable-row], [data-pretable-group-row]",
    cellSelector: "[data-pretable-cell]",
    rowIdAttribute: "data-pretable-row-id",
    cellColumnIdAttribute: "data-pretable-column-id",
    rowIndexAttribute: "data-pretable-row-index",
    maxSettleFrames: 3,
    measureRowHeightError: (row, renderedHeight) =>
      measureWrappedCellRowHeightError(
        row,
        renderedHeight,
        "[data-pretable-cell]",
      ),
  },
  tanstack: {
    viewportSelector: "[data-pretable-bench-tanstack-viewport]",
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

  // The viewport element attaches before the row model projects its first
  // window, so content height trails it by more frames than the poll above
  // allows. Waiting for the window here is the same wait `measureBenchUpdatesRun`
  // already performs; without it a mount slower than the poll budget is recorded
  // as an unscrollable surface, which is what the incremental row model made
  // routine rather than occasional.
  if (viewport) {
    await waitForRenderedRowBaseline(root, profile.rowSelector);
  }

  const viewportPolicyNotes = viewport
    ? detectViewportPolicyNotes(viewport)
    : [];

  if (!viewport || viewport.scrollHeight <= viewport.clientHeight) {
    return {
      status: "partial",
      notes: [
        ...viewportPolicyNotes,
        // Two unrelated failures used to share one sentence: no viewport element
        // at all, and an element whose content never grew past the fold. They
        // call for opposite investigations, so they say different things.
        viewport
          ? `scroll viewport for ${adapterId} never became scrollable: ${viewport.scrollHeight}px of content in a ${viewport.clientHeight}px viewport`
          : `scroll viewport unavailable for ${adapterId} in current runtime`,
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

interface RowSetMeasurementPlan {
  focusedRowId: string | null;
  resultRowCount: number;
  selectedRowId: string | null;
}

interface RowSetSample {
  signature: string;
  state: BenchInteractionState;
  visibleRows: VisibleRowSample[];
}

/**
 * What "the surface is not moving" means, in one place, so the gate that decides when
 * to OPEN the window and the detector that decides when the update has SETTLED cannot
 * disagree. Selection and focus are in it because the row-set scripts apply both during
 * setup: a gate blind to them can call the surface still one frame before the selection
 * lands, and the window then opens onto it.
 */
function createStabilityKey(sample: RowSetSample) {
  return [
    sample.signature,
    sample.state.resultRowCount,
    sample.state.selectedRowId,
    sample.state.focusedRowId,
  ].join("§");
}

interface RowSetMeasurementOptions {
  root: HTMLElement;
  adapterId: BenchQueryState["adapterId"];
  /** Carried by every outcome, e.g. `interaction mode: sort`. */
  label: string;
  maxFrames: number;
  /**
   * Frames of an unchanging surface required BEFORE the window opens, judged by the
   * SAME predicate the settle detector uses on the way out (`createStabilityKey`). A
   * surface still in motion when the baseline is taken latches its own tail motion as
   * the trigger's first painted frame and reports the one-frame floor — the
   * artificially perfect answer. 0 keeps the caller's own sequencing.
   */
  quietFrames: number;
  plan: RowSetMeasurementPlan;
  createSignature: (input: {
    profile: ScrollRuntimeProfile;
    resultRowCount: number;
    viewport: HTMLElement;
    visibleRows: VisibleRowSample[];
  }) => string;
  readInteractionStateOverride: (() => BenchInteractionState) | undefined;
  trigger: () => void;
}

type RowSetMeasurement =
  | {
      status: "partial";
      notes: string[];
      metrics: Partial<Record<BenchMetricId, number>>;
      /**
       * Why the loop produced no measurement, as a sentence. The notes carry the label
       * and the viewport policy but not this — and the frame-budget exit below has no
       * note of its own at all, so a caller that must report the stop has nothing to
       * report without it.
       */
      reason: string;
    }
  | {
      status: "completed";
      notes: string[];
      metrics: Partial<Record<BenchMetricId, number>>;
      baselineRenderedRowIds: string[];
      finalState: BenchInteractionState;
      finalRenderedRowIds: string[];
      scrollTopBefore: number;
      viewport: HTMLElement;
    };

/**
 * The frame loop both row-set measurements run: open a window on a quiet surface, fire
 * the trigger, latch the first frame whose signature moved, then wait for the signature
 * to hold still for a settle window.
 *
 * Parametrized rather than copied. The two callers differ in four details — the
 * signature they watch, the note they label, the frame budget, and the metrics they add
 * — and a second copy of the settle rule is a second place every future fix to it has to
 * land.
 *
 * Both `interaction_latency_ms` and `settle_duration_ms` are differences between rAF
 * timestamps, so both are integer multiples of the display's frame interval: latency
 * cannot resolve below one frame and settle cannot report less than
 * `maxSettleFrames - 1` frames. The frame-count notes below exist so a reader can tell
 * a measurement from that floor.
 */
async function measureRowSetChange(
  options: RowSetMeasurementOptions,
): Promise<RowSetMeasurement> {
  const {
    adapterId,
    createSignature,
    label,
    maxFrames,
    plan,
    quietFrames,
    readInteractionStateOverride,
    root,
    trigger,
  } = options;
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
        label,
        `viewport unavailable for ${adapterId} in current runtime`,
      ],
      metrics: {
        dom_nodes_peak: root.querySelectorAll("*").length,
      },
      reason: `viewport unavailable for ${adapterId} in current runtime`,
    };
  }

  const sample = (): RowSetSample => {
    const state = readBenchInteractionState(root, readInteractionStateOverride);
    const visibleRows = sampleVisibleRows(viewport, profile);

    return {
      signature: createSignature({
        profile,
        resultRowCount: state.resultRowCount,
        viewport,
        visibleRows,
      }),
      state,
      visibleRows,
    };
  };

  const baseline = await waitForQuietSurface({
    maxFrames,
    quietFrames,
    sample,
  });
  const baselineSignature = baseline.signature;
  const baselineState = baseline.state;
  const baselineVisibleRows = baseline.visibleRows;
  const baselineRenderedRowIds = readRenderedRowIds(viewport, profile);
  const scrollTopBefore = viewport.scrollTop;
  const startTimestamp = await waitForAnimationFrame();

  performance.mark("pretable.interaction.start");
  trigger();

  let domNodesPeak = root.querySelectorAll("*").length;
  let renderedRowsPeak = root.querySelectorAll(profile.rowSelector).length;
  let renderedCellsPeak = root.querySelectorAll(profile.cellSelector).length;
  let firstChangedAt: number | null = null;
  let firstChangedFrame = 0;
  let settledAt: number | null = null;
  let settledFrame = 0;
  let blankGapFrames = 0;
  const rowHeightErrors: number[] = [];
  const anchorShifts: number[] = [];
  const frameTimestamps: number[] = [startTimestamp];
  let previousVisibleRows = baselineVisibleRows;
  let previousScrollTop = viewport.scrollTop;
  let previousStabilityKey = createStabilityKey(baseline);
  let stableFrames = 0;

  for (let frame = 1; frame <= maxFrames; frame += 1) {
    const timestamp = await waitForAnimationFrame();
    const currentSample = sample();
    const { signature, state, visibleRows } = currentSample;
    const stabilityKey = createStabilityKey(currentSample);

    frameTimestamps.push(timestamp);
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
        state.resultRowCount !== baselineState.resultRowCount);

    if (isFirstChangedFrame) {
      firstChangedAt = timestamp;
      firstChangedFrame = frame;
      performance.mark("pretable.interaction.firstFrame");
    }

    // The trigger's own frame is neither a blank-gap sample nor an anchor-shift
    // sample: the surface is mid-change by definition, and counting it would charge
    // the update for the movement it was asked to make.
    if (firstChangedAt !== null && !isFirstChangedFrame) {
      if (detectBlankGapFrame(viewport, profile.rowSelector)) {
        blankGapFrames += 1;
      }

      rowHeightErrors.push(
        ...visibleRows
          .map((row) => row.heightError)
          .filter((value) => value > 0),
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

      if (stabilityKey === previousStabilityKey) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }
    }

    previousVisibleRows = visibleRows;
    previousScrollTop = viewport.scrollTop;
    previousStabilityKey = stabilityKey;

    if (
      firstChangedAt !== null &&
      !isFirstChangedFrame &&
      stableFrames >= Math.max(0, profile.maxSettleFrames - 1)
    ) {
      settledAt = timestamp;
      settledFrame = frame;
      performance.mark("pretable.interaction.settled");
      break;
    }
  }

  if (firstChangedAt === null || settledAt === null) {
    return {
      status: "partial",
      notes: [...viewportPolicyNotes, label],
      metrics: {
        dom_nodes_peak: domNodesPeak,
        rendered_rows_peak: renderedRowsPeak,
        rendered_cells_peak: renderedCellsPeak,
      },
      // Which of the two exits this was decides where to look: nothing moved at all
      // means the trigger or the signature, still moving at the end means the budget.
      reason:
        firstChangedAt === null
          ? `no frame changed the watched signature within ${maxFrames} frames after the trigger`
          : `the surface never held still for ${Math.max(0, profile.maxSettleFrames - 1)} frames within ${maxFrames} frames after the trigger`,
    };
  }

  const finalState = readBenchInteractionState(
    root,
    readInteractionStateOverride,
  );

  return {
    status: "completed",
    notes: [
      ...viewportPolicyNotes,
      label,
      // Both timings below are frame counts times this interval. Published so a
      // reader cannot mistake the one-frame floor for a resolved measurement.
      `frame interval median ms: ${percentile(
        diffFrameTimestamps(frameTimestamps),
        0.5,
      ).toFixed(2)}`,
      `frames to first change: ${firstChangedFrame}`,
      `frames to settle: ${settledFrame - firstChangedFrame} (floor ${Math.max(
        0,
        profile.maxSettleFrames - 1,
      )})`,
    ],
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
        finalState.selectedRowId === plan.selectedRowId ? 1 : 0,
      focused_row_preserved:
        finalState.focusedRowId === plan.focusedRowId ? 1 : 0,
      dom_nodes_peak: domNodesPeak,
      rendered_rows_peak: renderedRowsPeak,
      rendered_cells_peak: renderedCellsPeak,
    },
    baselineRenderedRowIds,
    finalState,
    finalRenderedRowIds: readRenderedRowIds(viewport, profile),
    scrollTopBefore,
    viewport,
  };
}

/**
 * Ids of every row in the DOM, including rows rendered into the overscan below the
 * fold. Wider than `sampleVisibleRows` on purpose: an append is measured from a
 * viewport parked at the tail of the resident set, so its new rows land just past the
 * viewport edge — counting only what intersects the viewport rect would report that
 * nothing rendered.
 */
function readRenderedRowIds(
  viewport: HTMLElement,
  profile: ScrollRuntimeProfile,
): string[] {
  return [...viewport.querySelectorAll<HTMLElement>(profile.rowSelector)].map(
    (row) =>
      row.getAttribute(profile.rowIdAttribute ?? "") ??
      getRowIdentityFallback(
        row,
        profile.cellSelector,
        Number(row.getAttribute(profile.rowIndexAttribute)),
      ),
  );
}

/**
 * Spins until the surface holds still for `quietFrames` consecutive frames and returns
 * the sample that becomes the measurement's baseline. With `quietFrames` at 0 it
 * samples once and returns immediately.
 *
 * Runs out its budget rather than throwing when the surface never stops: the
 * measurement that follows will find nothing it can attribute to the trigger and
 * report `partial`, which is the honest outcome and one bench-runner refuses to record
 * for the row-set scripts.
 */
async function waitForQuietSurface(input: {
  maxFrames: number;
  quietFrames: number;
  sample: () => RowSetSample;
}): Promise<RowSetSample> {
  let current = input.sample();

  if (input.quietFrames <= 0) {
    return current;
  }

  let previousKey = createStabilityKey(current);
  let stableFrames = 0;

  for (let frame = 0; frame < input.maxFrames; frame += 1) {
    await waitForAnimationFrame();
    current = input.sample();

    const key = createStabilityKey(current);

    if (key === previousKey) {
      stableFrames += 1;

      if (stableFrames >= input.quietFrames) {
        return current;
      }
    } else {
      previousKey = key;
      stableFrames = 0;
    }
  }

  return current;
}

export async function measureBenchInteractionRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
  mode: BenchInteractionMode,
  interactionPlan: {
    focusedRowId: string | null;
    resultRowCount: number;
    selectedRowId: string | null;
  },
  readInteractionStateOverride: (() => BenchInteractionState) | undefined,
  trigger: () => void,
): Promise<InteractionBenchRunResult> {
  const measurement = await measureRowSetChange({
    adapterId,
    createSignature: ({ resultRowCount, visibleRows }) =>
      createVisibleRowSignature(visibleRows, resultRowCount),
    label: `interaction mode: ${mode}`,
    maxFrames: getMaxInteractionFrames(
      scrollRuntimeProfiles[adapterId].maxSettleFrames,
      mode,
    ),
    plan: interactionPlan,
    // These scripts change display state on an already-settled grid, and the caller
    // sequences the settling itself.
    quietFrames: 0,
    readInteractionStateOverride,
    root,
    trigger,
  });

  if (measurement.status === "partial") {
    return {
      status: "partial",
      // `measureRowSetChange` carries the cause beside the notes rather than in
      // them. Dropping it here files a partial that records only that something
      // stopped, never which of the two exits it was.
      notes: [...measurement.notes, measurement.reason],
      metrics: measurement.metrics,
    };
  }

  // The settle detector only needs SOME change, and every script on this path
  // moves focus and selection alongside the row set. So an interaction that
  // never applied — a filter model the grid ignored, a sort that did not take —
  // still latches a frame off the focus jump, still settles, and still reports a
  // latency for work that did not happen. `measureBenchDataUpdateRun` already
  // refuses exactly this; the comparative filter series had been recording it,
  // at identical latency to a clean run and detectable only by row count.
  if (
    measurement.finalState.resultRowCount !== interactionPlan.resultRowCount
  ) {
    return {
      status: "partial",
      notes: [
        ...measurement.notes,
        `result row count settled at ${measurement.finalState.resultRowCount}, not the ${interactionPlan.resultRowCount} rows the plan handed the surface`,
      ],
      // Peaks and the row count survive because they are what identifies the
      // run; the timings do not, because they measured something other than the
      // script this run is filed under. Status alone would keep them out of the
      // budgets and the comparison tables, but a reader listing metrics per run
      // would quote them as if it had.
      metrics: {
        result_row_count: measurement.metrics.result_row_count,
        dom_nodes_peak: measurement.metrics.dom_nodes_peak,
        rendered_rows_peak: measurement.metrics.rendered_rows_peak,
        rendered_cells_peak: measurement.metrics.rendered_cells_peak,
      },
    };
  }

  return {
    status: "completed",
    notes: measurement.notes,
    metrics: measurement.metrics,
  };
}

/**
 * Replace/append measurement. Reuses the `pretable.interaction.*` marks so
 * `scripts/analyze-cdp.mjs --window=interaction` slices these runs exactly as it slices
 * a sort or filter — the trigger-to-first-frame window, not the whole trace, which is
 * dominated by initial-mount work that does not count against the budget.
 *
 * The signature carries a content digest the interaction signature does not:
 * `createVisibleRowSignature` is result row count + row id + row top, and a replacement
 * of the SAME ids over an equal-length resident set moves none of the three. Without
 * the probe column's rendered text every replace run would run out its frame budget and
 * abort.
 *
 * Every abort below is `failed` with the cause attached rather than `partial`: these two
 * scripts have no partial credit (see `DataUpdateBenchRunResult`), and a caller handed a
 * bare `partial` can only file a run whose recorded error is that the status was wrong.
 */
export async function measureBenchDataUpdateRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
  mode: "replace" | "append",
  plan: {
    focusedRowId: string | null;
    probeColumnId: string;
    resultRowCount: number;
    selectedRowId: string | null;
  },
  readInteractionStateOverride: (() => BenchInteractionState) | undefined,
  readGridInstanceId: () => string | null,
  trigger: () => void,
): Promise<DataUpdateBenchRunResult> {
  const label = `data update mode: ${mode}`;
  // Read before anything else: `grid_instance_reconstructed` is the metric §11's
  // replace budget rests on, and a probe that cannot see the id would otherwise
  // compare two identical misses and report 0 — a PASS produced by a broken reader.
  const gridInstanceBefore = readGridInstanceId();

  if (gridInstanceBefore === null) {
    return failedDataUpdateRun({
      label,
      metrics: { dom_nodes_peak: root.querySelectorAll("*").length },
      notes: [label],
      reason:
        "grid instance id unavailable before the update: the reconstruction probe has no baseline",
    });
  }

  const profile = scrollRuntimeProfiles[adapterId];
  // Built once per run: the signature below runs on every frame inside the measurement
  // loop, and rebuilding the selector there would put the harness's own string work on
  // the same order as the work being measured.
  const contentCellSelector = createContentCellSelector(
    profile,
    plan.probeColumnId,
  );
  const measurement = await measureRowSetChange({
    adapterId,
    createSignature: ({ resultRowCount, viewport, visibleRows }) =>
      `${createVisibleRowSignature(visibleRows, resultRowCount)}#${createVisibleContentSignature(
        viewport,
        profile.rowSelector,
        contentCellSelector,
      )}`,
    label,
    // Six settle windows: generous enough that a slow machine reports a real number
    // rather than a `partial`, bounded enough that a hung run still ends.
    maxFrames: Math.max(profile.maxSettleFrames * 6, 60),
    plan,
    // Controlled focus scrolls the probe row into view and selection lands a frame
    // later, so the surface is still in flight when the caller hands over. Three
    // unchanging frames is the same stability the settle detector demands on the way
    // out, judged by the same key.
    quietFrames: 3,
    readInteractionStateOverride,
    root,
    trigger,
  });

  if (measurement.status === "partial") {
    return failedDataUpdateRun({
      label,
      metrics: measurement.metrics,
      notes: measurement.notes,
      reason: measurement.reason,
    });
  }

  const gridInstanceAfter = readGridInstanceId();

  if (gridInstanceAfter === null) {
    return failedDataUpdateRun({
      label,
      metrics: measurement.metrics,
      notes: measurement.notes,
      reason:
        "grid instance id unavailable after the update: reconstruction is undecided",
    });
  }

  // The change detector only needs SOME change, so an update that landed half its rows
  // would still latch a frame and report a good latency. For append the row count is
  // the only change signal there is, which makes this check nearly free and the run
  // meaningless without it.
  if (measurement.finalState.resultRowCount !== plan.resultRowCount) {
    return failedDataUpdateRun({
      label,
      metrics: measurement.metrics,
      notes: measurement.notes,
      reason: `result row count settled at ${measurement.finalState.resultRowCount}, not the ${plan.resultRowCount} rows the plan handed the surface`,
    });
  }

  const baselineRowIds = new Set(measurement.baselineRenderedRowIds);
  const arrivedRowCount = measurement.finalRenderedRowIds.filter(
    (rowId) => !baselineRowIds.has(rowId),
  ).length;

  return {
    status: "completed",
    notes: [
      ...measurement.notes,
      // Whether the update put anything on screen. An append measured from a viewport
      // parked away from the seam renders none of its new rows, and then blank-gap
      // frames, anchor shift and row-height error are all computed over rows the
      // update never touched — zero by construction rather than by quality.
      `rendered rows before the update: ${measurement.baselineRenderedRowIds.length}`,
      `rendered rows after the update: ${measurement.finalRenderedRowIds.length}`,
      `rows newly rendered by the update: ${arrivedRowCount}`,
    ],
    metrics: {
      ...measurement.metrics,
      // The append budget's "zero scroll movement" clause, as a raw number: the
      // viewport's own offset before vs after. Anchor shift measures CONTENT movement
      // and is a different claim.
      scroll_position_drift_px: Math.abs(
        measurement.viewport.scrollTop - measurement.scrollTopBefore,
      ),
      // 0 = the same engine absorbed the change, which is what §11's replace budget
      // requires. Inverted relative to the two preservation metrics above, which pass
      // at 1 — see the polarity test in __tests__/bench-runtime.test.ts.
      grid_instance_reconstructed:
        gridInstanceAfter === gridInstanceBefore ? 0 : 1,
    },
  };
}

/**
 * One aborted row-set run, recorded twice: as the artifact's last note, where a reader
 * of the run sees it in sequence after the label and whatever the loop got through, and
 * as the error `message`, which is the only field a `failed` summary keeps besides the
 * notes — `FailedBenchRunSummary` has no `metrics`, so anything the loop measured before
 * it stopped survives only as prose.
 */
function failedDataUpdateRun(input: {
  label: string;
  metrics: Partial<Record<BenchMetricId, number>>;
  notes: string[];
  reason: string;
}): DataUpdateBenchRunResult {
  return {
    status: "failed",
    notes: [...input.notes, input.reason],
    metrics: input.metrics,
    error: {
      name: "BenchDataUpdateAbort",
      message: `${input.label}: ${input.reason}`,
    },
  };
}

export interface UpdatesBenchRunResult {
  status: "completed" | "partial";
  metrics: Partial<Record<BenchMetricId, number>> & {
    row_model_commit_p95_ms?: number;
    rebuild_slice_max_ms?: number;
  };
  notes: string[];
  rowModel?: RowModelBenchSummary;
}

/**
 * Caller-supplied function that applies a batch of update patches to the
 * adapter's grid. Each adapter wires this to its idiomatic streaming
 * pattern (Pretable: stream-adapter batcher → applyTransaction;
 * AG Grid: gridApi.applyTransaction directly; MUI: setRows state merge;
 * TanStack: setData merge).
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
  /** Shared seed for the permanent deterministic row/column schedule. */
  seed?: number;
  /** Uses the grouped plan, including the catch-up rebuild phase. */
  grouped?: boolean;
  /** Private diagnostics controller installed only for row-model gate runs. */
  diagnostics?: RowModelDiagnosticsController | null;
  /** Test seam; production runs always create the canonical plan. */
  plan?: DeterministicUpdatePlan;
  /**
   * Column ids the patch generator may not write. Defaults to `[]`, which is
   * the historical behaviour — `updates` and `group-updates` both pick
   * uniformly from every column and must keep doing so.
   *
   * Used only by `group-updates-stable-keys`, to hold group membership fixed
   * while rows stream. See `benchUpdatesExcludedColumnIds` in
   * apps/bench/src/interaction-plan.ts for why, and for the sampling caveat.
   */
  excludeColumnIds?: readonly string[];
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

  const BATCH_INTERVAL_MS = ROW_MODEL_BATCH_INTERVAL_MS;
  const FRAME_BUDGET_MS = 16;
  const updateRatePerSec = options.updateRatePerSec ?? 1000;
  // Vary batch size to hit the rate at a fixed 50ms tick. RAF/timer
  // behavior stays consistent across rates so frame metrics stay
  // comparable; only the per-batch work shifts.
  const UPDATES_PER_TICK = Math.max(
    1,
    Math.round((updateRatePerSec * BATCH_INTERVAL_MS) / 1000),
  );
  // Filtering the deterministic plan's input columns retains its seeded row and
  // column schedule while giving the stable-key grouping benchmark the same
  // exclusion semantics as the newer comparator harness.
  const excluded = new Set(options.excludeColumnIds ?? []);
  const planColumns = dataset.columns.filter(
    (column) => !excluded.has(column.id),
  );

  if (planColumns.length === 0) {
    return {
      status: "partial",
      notes: [
        ...viewportPolicyNotes,
        "updates patch generator has no columns left to write after exclusions",
      ],
      metrics: {},
    };
  }

  const plan =
    options.plan ??
    createDeterministicUpdatePlan({
      dataset: { rows: dataset.rows, columns: planColumns } as never,
      grouped: options.grouped ?? false,
      seed: options.seed ?? 505,
      patchRatePerSec: updateRatePerSec,
    });
  if (
    options.diagnostics !== null &&
    options.diagnostics !== undefined &&
    (updateRatePerSec !== 1_000 || UPDATES_PER_TICK !== 50)
  ) {
    throw new RangeError(
      "The permanent row-model workload requires 1,000 patches/sec in 50-patch ticks.",
    );
  }

  let totalUpdates = 0;
  const frameDurations: number[] = [];
  let previousFrameTimestamp: number | null = null;

  // Snapshot the viewport's pre-streaming pose so we can detect drift.
  // scrollTop drift signals an unwanted scroll caused by row mutations;
  // visible-row-count drift signals the surface had to re-virtualize.
  const visibleRowCountBefore = await waitForRenderedRowBaseline(
    root,
    profile.rowSelector,
  );
  const scrollTopBefore = viewport.scrollTop;
  // Initial mount/layout is setup, not part of the streaming interaction.
  const longTaskDurations: number[] = [];
  const observer = createLongTaskObserver(longTaskDurations);
  const layoutShiftValues: number[] = [];
  const layoutShiftObserver = createLayoutShiftObserver(layoutShiftValues);

  const rafHandle = { running: true, id: 0 };
  let interactionProbeActive = false;
  let interactionProbeOffset = 0;
  const tickRaf = () => {
    if (!rafHandle.running) return;
    rafHandle.id = requestAnimationFrame((ts) => {
      if (previousFrameTimestamp !== null) {
        frameDurations.push(ts - previousFrameTimestamp);
      }

      previousFrameTimestamp = ts;
      const rebuilding =
        options.diagnostics?.model.getState().status.kind === "rebuilding";
      if (rebuilding) {
        interactionProbeActive = true;
        interactionProbeOffset = interactionProbeOffset === 0 ? 1 : 0;
        viewport.scrollTop = scrollTopBefore + interactionProbeOffset;
        viewport.dispatchEvent(new Event("scroll"));
        options.diagnostics?.recordInteractionSample({
          scrollTop: viewport.scrollTop,
          activeElement:
            document.activeElement instanceof HTMLElement
              ? document.activeElement.tagName
              : null,
        });
      } else if (interactionProbeActive) {
        interactionProbeActive = false;
        interactionProbeOffset = 0;
        viewport.scrollTop = scrollTopBefore;
        viewport.dispatchEvent(new Event("scroll"));
      }
      tickRaf();
    });
  };

  // Window markers for scripts/analyze-cdp.mjs --window=streaming. Without
  // them a streaming trace can only be read whole, and the whole is dominated
  // by initial mount — which is not what this script measures. Two
  // performance.mark calls across a 3 s run; the metrics themselves are
  // computed from frameDurations and are untouched by them.
  performance.mark("pretable.streaming.start");

  tickRaf();

  try {
    await new Promise<void>((resolve, reject) => {
      let tickIndex = 0;
      const pendingApplies: Promise<void>[] = [];
      let rebuildTransition: ReturnType<
        RowModelDiagnosticsController["startQueryCandidate"]
      > = null;

      const interval = setInterval(() => {
        try {
          const tick = plan.ticks[tickIndex];
          if (tick === undefined) {
            clearInterval(interval);
            void Promise.all(pendingApplies)
              .then(async () => {
                await rebuildTransition?.finished;
                resolve();
              })
              .catch(reject);
            return;
          }
          const patches = tick.patches.map((patch) => ({
            id: patch.id,
            [patch.columnId]: patch.value,
          }));

          const applyResult = apply(patches);
          if (applyResult && typeof applyResult.then === "function") {
            // The caller can return a Promise (e.g., flush before resolve);
            // we don't await within the interval to keep the cadence honest,
            // but we do swallow rejections so they surface via the outer
            // try/catch above.
            const pending = applyResult.catch((err) => {
              clearInterval(interval);
              reject(err);
            });
            pendingApplies.push(pending);
          }
          totalUpdates += tick.patches.length;
          if (
            plan.rebuild !== null &&
            tick.index === plan.rebuild.startAfterTick
          ) {
            rebuildTransition =
              options.diagnostics?.startQueryCandidate() ?? null;
          }
          tickIndex += 1;
        } catch (err) {
          clearInterval(interval);
          reject(err);
        }
      }, BATCH_INTERVAL_MS);
    });
  } finally {
    rafHandle.running = false;
    cancelAnimationFrame(rafHandle.id);
    if (interactionProbeActive) viewport.scrollTop = scrollTopBefore;
    observer?.disconnect();
    layoutShiftObserver?.disconnect();
    performance.mark("pretable.streaming.end");
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
      `duration ms: ${plan.ticks.length * BATCH_INTERVAL_MS}`,
      `seed: ${plan.seed}`,
      `update plan checksum: ${plan.scheduleChecksum}`,
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
      ...(options.diagnostics
        ? {
            row_model_commit_p95_ms: percentile(
              options.diagnostics.read().commitDurationsMs,
              0.95,
            ),
            rebuild_slice_max_ms: Math.max(
              0,
              ...options.diagnostics.read().work.schedulerSliceDurations,
            ),
          }
        : {}),
    },
    ...(options.diagnostics
      ? { rowModel: options.diagnostics.createRunSummary() }
      : {}),
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

/** Waits for the initial virtual window instead of sampling a transient zero. */
export async function waitForRenderedRowBaseline(
  root: HTMLElement,
  rowSelector: string,
  maxFrames = 120,
): Promise<number> {
  let previous = -1;
  let stableFrames = 0;
  for (let frame = 0; frame < maxFrames; frame += 1) {
    await waitForAnimationFrame();
    const count = root.querySelectorAll(rowSelector).length;
    if (count > 0 && count === previous) {
      stableFrames += 1;
      if (stableFrames >= 2) return count;
    } else {
      stableFrames = 0;
    }
    previous = count;
  }
  return Math.max(0, previous);
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

/**
 * Polls for the adapter's scroll viewport element.
 *
 * The budget matches `waitForRenderedRowBaseline`'s rather than the 12 frames it
 * used to allow. Twelve was tuned when the surface mounted synchronously; an
 * incrementally-built row model attaches its viewport later than that, and the
 * caller reports a missing viewport as a measurement failure rather than
 * retrying — so a budget shorter than the mount turns a slow mount into a
 * recorded absence.
 */
async function waitForScrollViewport(
  root: HTMLElement,
  selector: string,
  maxFrames = 120,
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

function percentile(values: readonly number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );

  return sorted[index] ?? 0;
}

/** Gaps between consecutive rAF timestamps — the quantum both interaction timings are
 *  reported in. */
function diffFrameTimestamps(timestamps: number[]) {
  return timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index]);
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

/**
 * Selector for the one cell per row whose text the data-update measurement watches.
 * Interpolated unescaped: scenario column ids are generated as `col_<index>` by
 * @pretable-internal/scenario-data, so they hold nothing an attribute selector would
 * need quoted.
 */
function createContentCellSelector(
  profile: ScrollRuntimeProfile,
  columnId: string,
) {
  if (profile.cellColumnIdAttribute === undefined) {
    return profile.cellSelector;
  }

  return `${profile.cellSelector}[${profile.cellColumnIdAttribute}="${columnId}"]`;
}

/**
 * The rendered text of the probe column across every row currently in the viewport.
 *
 * Scoped to one column on purpose: it runs once per frame inside the measurement
 * loop, and digesting every cell would put the harness's own DOM reads on the same
 * order as the work being measured.
 */
function createVisibleContentSignature(
  viewport: HTMLElement,
  rowSelector: string,
  cellSelector: string,
) {
  return [...viewport.querySelectorAll<HTMLElement>(rowSelector)]
    .map(
      (row) => row.querySelector<HTMLElement>(cellSelector)?.textContent ?? "",
    )
    .join("|");
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

/**
 * Ids come from a pre-incremented sequence, so the first real one is 1 and any other
 * shape — attribute absent, empty, 0, non-numeric — means no instance was ever
 * recorded. Those have to read as null rather than as an id: `measureBenchDataUpdateRun`
 * compares the read before the update against the read after, so a placeholder that
 * survives as a value would compare equal to itself and score
 * `grid_instance_reconstructed: 0`, the value §11's replace budget treats as proof that
 * no reconstruction happened.
 */
export function readBenchGridInstanceId(
  root: ParentNode | null,
): string | null {
  const published = (
    root?.querySelector("[data-bench-grid-instance-id]") as HTMLElement | null
  )?.dataset.benchGridInstanceId;

  return published !== undefined && /^[1-9][0-9]*$/.test(published)
    ? published
    : null;
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

export interface KeySequenceBenchRunResult {
  // No "failed": this measurement has no abort path that carries a reason, and a status
  // it can never return would let it be assigned where a reason is required.
  status: "completed" | "partial";
  notes: string[];
  metrics: {
    interaction_latency_ms?: number;
    settle_duration_ms?: number;
    dom_nodes_peak?: number;
    rendered_rows_peak?: number;
    rendered_cells_peak?: number;
  };
}

interface KeySequenceOptions {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  count: number;
  /** Minimum frames between keystrokes to ensure each one renders. Default 1. */
  framesBetween?: number;
}

export async function measureBenchKeySequenceRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
  scriptName: "select-range-extend" | "keyboard-nav-row" | "select-all",
  options: KeySequenceOptions,
): Promise<KeySequenceBenchRunResult> {
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
        `script: ${scriptName}`,
        `viewport unavailable for ${adapterId} in current runtime`,
      ],
      metrics: {
        dom_nodes_peak: root.querySelectorAll("*").length,
      },
    };
  }

  // Allow the grid to settle and ensure focus is on a body cell. One frame is
  // not settling: the viewport attaches before the row model projects its first
  // window, so a single frame leaves the body empty and the run fails below for
  // want of a cell that is about to exist. This is the same wait `scroll` and
  // `initial` take (#334); all three selection scripts aborted the comparative
  // runset at zero rendered rows without it.
  await waitForRenderedRowBaseline(root, profile.rowSelector);
  const firstCell =
    viewport.querySelector<HTMLElement>(
      `${profile.cellSelector}[tabindex="0"]`,
    ) ?? viewport.querySelector<HTMLElement>(profile.cellSelector);

  if (!firstCell) {
    return {
      status: "partial",
      notes: [
        ...viewportPolicyNotes,
        `script: ${scriptName}`,
        `no body cell available for keyboard focus`,
      ],
      metrics: {
        dom_nodes_peak: root.querySelectorAll("*").length,
      },
    };
  }

  firstCell.focus();
  await waitForAnimationFrame();

  let domNodesPeak = root.querySelectorAll("*").length;
  let renderedRowsPeak = root.querySelectorAll(profile.rowSelector).length;
  let renderedCellsPeak = root.querySelectorAll(profile.cellSelector).length;
  const latencies: number[] = [];
  const framesBetween = options.framesBetween ?? 1;

  for (let i = 0; i < options.count; i += 1) {
    const start = performance.now();
    const target = (document.activeElement as HTMLElement) ?? firstCell;
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: options.key,
        shiftKey: options.shiftKey ?? false,
        ctrlKey: options.ctrlKey ?? false,
        metaKey: options.metaKey ?? false,
      }),
    );

    // Wait for at least one paint to capture the frame the dispatch produced.
    for (let f = 0; f < framesBetween; f += 1) {
      await waitForAnimationFrame();
    }
    latencies.push(performance.now() - start);

    domNodesPeak = Math.max(domNodesPeak, root.querySelectorAll("*").length);
    renderedRowsPeak = Math.max(
      renderedRowsPeak,
      root.querySelectorAll(profile.rowSelector).length,
    );
    renderedCellsPeak = Math.max(
      renderedCellsPeak,
      root.querySelectorAll(profile.cellSelector).length,
    );
  }

  // Settle: wait a few frames to ensure no late commits.
  const settleStart = performance.now();
  for (let f = 0; f < 5; f += 1) {
    await waitForAnimationFrame();
  }
  const settleDuration = performance.now() - settleStart;

  return {
    status: "completed",
    notes: [
      ...viewportPolicyNotes,
      `script: ${scriptName}`,
      `events: ${options.count}`,
    ],
    metrics: {
      interaction_latency_ms:
        options.count === 1 ? latencies[0] : percentile(latencies, 0.95),
      settle_duration_ms: settleDuration,
      dom_nodes_peak: domNodesPeak,
      rendered_rows_peak: renderedRowsPeak,
      rendered_cells_peak: renderedCellsPeak,
    },
  };
}

export interface AutosizeBenchRunResult {
  // See KeySequenceBenchRunResult: "failed" was never returned here either.
  status: "completed" | "partial";
  notes: string[];
  metrics: { interaction_latency_ms?: number; dom_nodes_peak?: number };
}

/**
 * Measures the latency of a single autosize-all-columns event.
 *
 * The metric is "call-to-paint": we await the adapter's autosize callback
 * (which may be async on MUI X DataGrid v7+ — `autosizeColumns` returns a
 * Promise on some versions; AG Grid v33 is synchronous but defers layout
 * to the next pass; pretable is synchronous) and then await one
 * `requestAnimationFrame` so the timing captures the post-call paint.
 */
export async function measureBenchAutosizeRun(
  root: HTMLElement,
  adapterId: BenchQueryState["adapterId"],
  autosize: (() => Promise<void> | void) | null,
): Promise<AutosizeBenchRunResult> {
  if (!autosize) {
    return {
      status: "partial",
      notes: [
        `script: autosize`,
        `no autosize callback registered for ${adapterId}`,
      ],
      metrics: { dom_nodes_peak: root.querySelectorAll("*").length },
    };
  }
  const profile = scrollRuntimeProfiles[adapterId];
  const viewport = await waitForScrollViewport(root, profile.viewportSelector);
  if (!viewport) {
    return {
      status: "partial",
      notes: [
        `script: autosize`,
        `viewport unavailable for ${adapterId} in current runtime`,
      ],
      metrics: { dom_nodes_peak: root.querySelectorAll("*").length },
    };
  }
  // Autosize measures the cost of fitting columns to their content, so the
  // content has to be on screen first. One frame after mount it is not, and the
  // run would time a fit over an empty body.
  await waitForRenderedRowBaseline(root, profile.rowSelector);
  const start = performance.now();
  await autosize();
  await waitForAnimationFrame();
  const elapsed = performance.now() - start;
  return {
    status: "completed",
    notes: [`script: autosize`],
    metrics: {
      interaction_latency_ms: elapsed,
      dom_nodes_peak: root.querySelectorAll("*").length,
    },
  };
}
