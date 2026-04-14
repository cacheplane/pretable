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
    `internal telemetry planned height: ${telemetry.totalHeight}`,
    `internal telemetry viewport range: ${telemetry.visibleRowRange.start}-${telemetry.visibleRowRange.end}`,
    `internal telemetry selected row: ${telemetry.selectedRowId ?? "none"}`,
  ];
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

interface ScrollRuntimeProfile {
  viewportSelector: string;
  rowSelector: string;
  cellSelector: string;
  rowIndexAttribute: string;
  maxSettleFrames: number;
  measureRowHeightError: (row: HTMLElement, renderedHeight: number) => number;
}

const scrollRuntimeProfiles: Record<
  BenchQueryState["adapterId"],
  ScrollRuntimeProfile
> = {
  "gridalpha": {
    viewportSelector: ".ag-body-viewport",
    rowSelector: ".ag-row",
    cellSelector: ".ag-cell",
    rowIndexAttribute: "row-index",
    maxSettleFrames: 1,
    measureRowHeightError: measureGridAlphaRowHeightError,
  },
  pretable: {
    viewportSelector: "[data-pretable-scroll-viewport]",
    rowSelector: "[data-pretable-row]",
    cellSelector: "[data-pretable-cell]",
    rowIndexAttribute: "data-row-index",
    maxSettleFrames: 4,
    measureRowHeightError: (row, renderedHeight) =>
      measureWrappedCellRowHeightError(
        row,
        renderedHeight,
        "[data-pretable-cell]",
      ),
  },
  gridbeta: {
    viewportSelector: "[data-gridbeta-scroll-viewport]",
    rowSelector: "[data-gridbeta-row]",
    cellSelector: "[data-gridbeta-cell]",
    rowIndexAttribute: "data-row-index",
    maxSettleFrames: 4,
    measureRowHeightError: (row, renderedHeight) =>
      measureWrappedCellRowHeightError(
        row,
        renderedHeight,
        "[data-gridbeta-cell]",
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
    .filter((element) =>
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

      if (clippedBottom <= clippedTop) {
        return null;
      }

      return {
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
    input.previousVisibleRows.map((row) => [row.rowIndex, row]),
  );
  const nextMatch = input.nextVisibleRows.find((row) =>
    previousByIndex.has(row.rowIndex),
  );

  if (!nextMatch) {
    return null;
  }

  const previousMatch = previousByIndex.get(nextMatch.rowIndex);

  if (!previousMatch) {
    return null;
  }

  const expectedTop =
    previousMatch.top - (input.nextScrollTop - input.previousScrollTop);

  return Math.abs(nextMatch.top - expectedTop);
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

function measureGridAlphaRowHeightError(row: HTMLElement, renderedHeight: number) {
  const expectedHeight = parseFloat(
    row.style.height || getComputedStyle(row).height || "0",
  );

  return Math.abs(expectedHeight - renderedHeight);
}
