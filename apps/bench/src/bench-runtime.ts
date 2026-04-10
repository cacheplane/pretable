import type { ScenarioDataset } from "@pretable-internal/scenario-data";
import type { BenchRunRequest, BenchRunSummary } from "@pretable-internal/bench-runner";

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
