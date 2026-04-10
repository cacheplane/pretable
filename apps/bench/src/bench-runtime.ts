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
  let domNodesPeak = root.querySelectorAll("*").length;
  let blankGapFrames = 0;
  let previousFrameTimestamp: number | null = null;
  const maxScrollTop = viewport.scrollHeight - viewport.clientHeight;
  const steps = 18;

  viewport.scrollTop = 0;
  await waitForAnimationFrame();

  for (let step = 1; step <= steps; step += 1) {
    viewport.scrollTop = (maxScrollTop * step) / steps;
    const frameTimestamp = await waitForAnimationFrame();

    if (previousFrameTimestamp !== null) {
      frameDurations.push(frameTimestamp - previousFrameTimestamp);
    }

    previousFrameTimestamp = frameTimestamp;
    domNodesPeak = Math.max(domNodesPeak, root.querySelectorAll("*").length);

    if (detectBlankGapFrame(viewport)) {
      blankGapFrames += 1;
    }
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

  const viewportRect = viewport.getBoundingClientRect();
  const clippedRows = rows
    .map((row) => row.getBoundingClientRect())
    .map((rect) => ({
      top: Math.max(rect.top, viewportRect.top),
      bottom: Math.min(rect.bottom, viewportRect.bottom),
    }))
    .filter((rect) => rect.bottom > rect.top)
    .sort((left, right) => left.top - right.top);

  if (clippedRows.length === 0) {
    return true;
  }

  let cursor = viewportRect.top;

  for (const rowRect of clippedRows) {
    if (rowRect.top > cursor + 1) {
      return true;
    }

    cursor = Math.max(cursor, rowRect.bottom);
  }

  return cursor < viewportRect.bottom - 1;
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
