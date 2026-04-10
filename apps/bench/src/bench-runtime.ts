import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import type {
  BenchMetricId,
  BenchRunRequest,
  BenchRunSummary,
} from "@pretable-internal/bench-runner";

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
    scriptName: query.scriptName,
    browserName: "chromium",
    browserVersion,
    seed: dataset.seed,
    viewport: BENCH_VIEWPORT,
    fontStack: BENCH_FONT_STACK,
    deviceScaleFactor: 1,
  };
}

export function publishBenchResult(result: BenchRunSummary): BenchRunSummary {
  window[BENCH_RESULT_KEY] = result;
  return result;
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

export async function measurePretableScrollRun(
  root: HTMLElement,
): Promise<ScrollBenchRunResult> {
  const viewport = root.querySelector<HTMLElement>("[data-pretable-scroll-viewport]");

  if (!viewport || viewport.scrollHeight <= viewport.clientHeight) {
    return {
      status: "partial",
      notes: ["scroll viewport unavailable in current runtime"],
      metrics: {
        dom_nodes_peak: root.querySelectorAll("*").length,
      },
    };
  }

  const longTaskDurations: number[] = [];
  const observer = createLongTaskObserver(longTaskDurations);
  const frameDurations: number[] = [];
  const rowHeightErrors: number[] = [];
  const anchorShifts: number[] = [];
  let domNodesPeak = root.querySelectorAll("*").length;
  let blankGapFrames = 0;
  let previousFrameTimestamp: number | null = null;
  let previousVisibleRows: VisibleRowSample[] = [];
  let previousScrollTop = 0;
  const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
  const steps = 18;
  const scrollTargets = [
    ...Array.from({ length: steps }, (_, index) => ((index + 1) * maxScrollTop) / steps),
    ...Array.from({ length: steps }, (_, index) => maxScrollTop - ((index + 1) * maxScrollTop) / steps),
  ];

  viewport.scrollTop = 0;
  await waitForAnimationFrame();

  for (const scrollTarget of scrollTargets) {
    viewport.scrollTop = scrollTarget;
    const frameTimestamp = await waitForAnimationFrame();

    if (previousFrameTimestamp !== null) {
      frameDurations.push(frameTimestamp - previousFrameTimestamp);
    }

    previousFrameTimestamp = frameTimestamp;
    domNodesPeak = Math.max(domNodesPeak, root.querySelectorAll("*").length);
    const visibleRows = sampleVisibleRows(viewport);

    if (detectBlankGapFrame(viewport)) {
      blankGapFrames += 1;
    }

    rowHeightErrors.push(...visibleRows.map((row) => row.heightError).filter((value) => value > 0));

    const anchorShift = measureAnchorShift({
      previousVisibleRows,
      previousScrollTop,
      nextVisibleRows: visibleRows,
      nextScrollTop: viewport.scrollTop,
    });

    if (anchorShift !== null) {
      anchorShifts.push(anchorShift);
    }

    previousVisibleRows = visibleRows;
    previousScrollTop = viewport.scrollTop;
  }

  observer?.disconnect();

  if (!observer || frameDurations.length === 0) {
    return {
      status: "partial",
      notes: ["scroll observers unavailable in current runtime"],
      metrics: {
        dom_nodes_peak: domNodesPeak,
        blank_gap_frames: blankGapFrames,
      },
    };
  }

  return {
    status: "completed",
    notes: [],
    metrics: {
      scroll_frame_p95_ms: percentile(frameDurations, 0.95),
      blank_gap_frames: blankGapFrames,
      long_tasks_count: longTaskDurations.length,
      long_tasks_ms: longTaskDurations.reduce((total, duration) => total + duration, 0),
      dom_nodes_peak: domNodesPeak,
      row_height_error_p95_px: percentile(rowHeightErrors, 0.95),
      scroll_anchor_shift_px: percentile(anchorShifts, 0.95),
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

export function detectBlankGapFrame(viewport: HTMLElement) {
  const rows = [...viewport.querySelectorAll<HTMLElement>("[data-pretable-row]")];

  if (rows.length === 0) {
    return true;
  }

  const viewportBounds = getViewportContentBounds(viewport);
  const clippedRows = rows
    .map((row) => row.getBoundingClientRect())
    .map((rect) => ({
      top: Math.max(rect.top, viewportBounds.top),
      bottom: Math.min(rect.bottom, viewportBounds.bottom),
    }))
    .filter((rect) => rect.bottom > rect.top)
    .sort((left, right) => left.top - right.top);

  if (clippedRows.length === 0) {
    return true;
  }

  let cursor = viewportBounds.top;

  for (const rowRect of clippedRows) {
    if (rowRect.top > cursor + 1) {
      return true;
    }

    cursor = Math.max(cursor, rowRect.bottom);
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

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * ratio) - 1),
  );

  return sorted[index] ?? 0;
}

interface VisibleRowSample {
  rowIndex: number;
  top: number;
  heightError: number;
}

function sampleVisibleRows(viewport: HTMLElement): VisibleRowSample[] {
  const viewportBounds = getViewportContentBounds(viewport);

  return [...viewport.querySelectorAll<HTMLElement>("[data-pretable-row]")]
    .map((row) => {
      const rect = row.getBoundingClientRect();
      const clippedTop = Math.max(rect.top, viewportBounds.top);
      const clippedBottom = Math.min(rect.bottom, viewportBounds.bottom);

      if (clippedBottom <= clippedTop) {
        return null;
      }

      return {
        rowIndex: Number(row.getAttribute("data-row-index")),
        top: rect.top - viewportBounds.top,
        heightError: Math.abs(row.scrollHeight - rect.height),
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
  const nextMatch = input.nextVisibleRows.find((row) => previousByIndex.has(row.rowIndex));

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
