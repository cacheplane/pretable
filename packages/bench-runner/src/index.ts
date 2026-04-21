import type {
  ScenarioId,
  ScenarioScale,
} from "@pretable-internal/scenario-data";
import {
  benchAdapterFamilies as sharedBenchAdapterFamilies,
  getBenchAdapterFamily as getSharedBenchAdapterFamily,
} from "../../../shared/bench-adapter-families.js";

export type BenchAdapterId =
  | "pretable"
  | "ag-grid"
  | "tanstack"
  | "mui"
  | "glide"
  | "handsontable";

export type BenchAdapterFamily =
  | "candidate"
  | "full-grid"
  | "virtualization-primitive"
  | "unknown";

export type BenchAdapterProfile = "default" | "tuned";

export type BenchBrowserName = "chromium" | "firefox";

export type BenchMetricId =
  | "mount_ms"
  | "first_stable_viewport_ms"
  | "scroll_frame_p95_ms"
  | "blank_gap_frames"
  | "long_tasks_count"
  | "long_tasks_ms"
  | "dom_nodes_peak"
  | "scroll_viewport_nodes_peak"
  | "rendered_rows_peak"
  | "rendered_cells_peak"
  | "heap_delta_mb"
  | "ua_memory_mb"
  | "interaction_latency_ms"
  | "settle_duration_ms"
  | "post_interaction_blank_gap_frames"
  | "post_interaction_anchor_shift_px"
  | "post_interaction_row_height_error_p95_px"
  | "result_row_count"
  | "selected_row_preserved"
  | "focused_row_preserved"
  | "row_height_error_p95_px"
  | "autosize_error_p95_px"
  | "update_latency_p95_ms"
  | "autosize_runtime_ms"
  | "scroll_anchor_shift_px"
  | "scroll_anchor_shift_forward_p95_px"
  | "scroll_anchor_shift_backward_p95_px";

export type BenchScriptName =
  | "initial"
  | "scroll"
  | "sort"
  | "filter-metadata"
  | "filter-text"
  | "updates"
  | "autosize";

export interface BenchViewport {
  width: number;
  height: number;
}

export interface BenchRunRequest {
  adapterId: BenchAdapterId;
  profile: BenchAdapterProfile;
  scenarioId: ScenarioId;
  scale: ScenarioScale;
  scriptName: BenchScriptName;
  browserName: BenchBrowserName;
  browserVersion: string;
  seed: number;
  rowCount: number;
  viewport: BenchViewport;
  fontStack: string;
  deviceScaleFactor: number;
}

export interface BenchErrorPayload {
  name: string;
  message: string;
  stack?: string;
}

export interface UnsupportedBenchRun {
  adapterId: BenchAdapterId;
  scenarioId: ScenarioId;
  profile: BenchAdapterProfile;
  scriptName: BenchScriptName;
  reason: string;
}

export interface BenchRunSummaryBase {
  adapterId: BenchAdapterId;
  profile: BenchAdapterProfile;
  scenarioId: ScenarioId;
  scale: ScenarioScale;
  scriptName: BenchScriptName;
  browserName: BenchBrowserName;
  browserVersion: string;
  timestamp: string;
  seed: number;
  rowCount: number;
  viewport: BenchViewport;
  fontStack: string;
  deviceScaleFactor: number;
  notes: string[];
}

export interface CompletedBenchRunSummary extends BenchRunSummaryBase {
  status: "completed";
  metrics: Partial<Record<BenchMetricId, number>>;
  tracePath: string;
}

export interface PartialBenchRunSummary extends BenchRunSummaryBase {
  status: "partial";
  metrics: Partial<Record<BenchMetricId, number>>;
  tracePath: string;
}

export interface FailedBenchRunSummary extends BenchRunSummaryBase {
  status: "failed";
  error: BenchErrorPayload;
  tracePath: string;
}

export interface UnsupportedBenchRunSummary extends BenchRunSummaryBase {
  status: "unsupported";
  unsupported: UnsupportedBenchRun;
}

export type BenchRunSummary =
  | CompletedBenchRunSummary
  | PartialBenchRunSummary
  | FailedBenchRunSummary
  | UnsupportedBenchRunSummary;

export interface BenchHandle {
  runScript(name: BenchScriptName): Promise<void>;
  getMetrics(): Promise<Partial<Record<BenchMetricId, number>>>;
  dispose(): Promise<void>;
}

export interface BenchAdapter {
  id: BenchAdapterId;
  label: string;
  mount(root: HTMLElement, request: BenchRunRequest): Promise<BenchHandle>;
}

export interface DashboardAdapterSummary {
  adapterId: BenchAdapterId;
  adapterFamily: BenchAdapterFamily;
}

export interface DashboardIndex {
  adapters: readonly DashboardAdapterSummary[];
  runs: readonly BenchRunSummary[];
}

export const benchAdapterFamilies: Record<BenchAdapterId, BenchAdapterFamily> =
  sharedBenchAdapterFamilies;

export const benchMetricIds: readonly BenchMetricId[] = [
  "mount_ms",
  "first_stable_viewport_ms",
  "scroll_frame_p95_ms",
  "blank_gap_frames",
  "long_tasks_count",
  "long_tasks_ms",
  "dom_nodes_peak",
  "scroll_viewport_nodes_peak",
  "rendered_rows_peak",
  "rendered_cells_peak",
  "heap_delta_mb",
  "ua_memory_mb",
  "interaction_latency_ms",
  "settle_duration_ms",
  "post_interaction_blank_gap_frames",
  "post_interaction_anchor_shift_px",
  "post_interaction_row_height_error_p95_px",
  "result_row_count",
  "selected_row_preserved",
  "focused_row_preserved",
  "row_height_error_p95_px",
  "autosize_error_p95_px",
  "update_latency_p95_ms",
  "autosize_runtime_ms",
  "scroll_anchor_shift_px",
  "scroll_anchor_shift_forward_p95_px",
  "scroll_anchor_shift_backward_p95_px",
];

export const benchScriptNames: readonly BenchScriptName[] = [
  "initial",
  "scroll",
  "sort",
  "filter-metadata",
  "filter-text",
  "updates",
  "autosize",
];

export function validateSupportedP0aRequest(
  request: BenchRunRequest,
): { ok: true } | { ok: false; reason: string } {
  if (!["pretable", "ag-grid", "tanstack", "mui"].includes(request.adapterId)) {
    return {
      ok: false,
      reason: `Unsupported adapter for P0a: ${request.adapterId}`,
    };
  }

  if (request.profile !== "default") {
    return {
      ok: false,
      reason: `Unsupported profile for P0a: ${request.profile}`,
    };
  }

  if (request.browserName !== "chromium") {
    return {
      ok: false,
      reason: `Unsupported browser for P0a: ${request.browserName}`,
    };
  }

  if (!["S1", "S2", "S3", "S7"].includes(request.scenarioId)) {
    return {
      ok: false,
      reason: `Unsupported scenario for P0a: ${request.scenarioId}`,
    };
  }

  const interactionScripts = ["sort", "filter-metadata", "filter-text"];
  const supportedScripts = ["initial", "scroll", ...interactionScripts];

  if (!supportedScripts.includes(request.scriptName)) {
    return {
      ok: false,
      reason: `Unsupported script for P0a: ${request.scriptName}`,
    };
  }

  if (interactionScripts.includes(request.scriptName)) {
    if (request.adapterId !== "pretable") {
      return {
        ok: false,
        reason: `Unsupported adapter for interaction script ${request.scriptName}: ${request.adapterId}`,
      };
    }

    if (!["S2", "S7"].includes(request.scenarioId)) {
      return {
        ok: false,
        reason: `Unsupported scenario for interaction script ${request.scriptName}: ${request.scenarioId}`,
      };
    }
  }

  return { ok: true };
}

export function createBenchRunSummary(input: {
  request: BenchRunRequest;
  status: BenchRunSummary["status"];
  timestamp: string;
  tracePath?: string;
  notes?: string[];
  metrics?: Partial<Record<BenchMetricId, number>>;
  reason?: string;
  error?: BenchErrorPayload;
}): BenchRunSummary {
  const base = {
    adapterId: input.request.adapterId,
    profile: input.request.profile,
    scenarioId: input.request.scenarioId,
    scale: input.request.scale,
    scriptName: input.request.scriptName,
    browserName: input.request.browserName,
    browserVersion: input.request.browserVersion,
    timestamp: input.timestamp,
    seed: input.request.seed,
    rowCount: input.request.rowCount,
    viewport: input.request.viewport,
    fontStack: input.request.fontStack,
    deviceScaleFactor: input.request.deviceScaleFactor,
    notes: input.notes ?? [],
  } satisfies BenchRunSummaryBase;

  if (input.status === "unsupported") {
    if (!input.reason) {
      throw new Error("Unsupported runs require a reason");
    }

    return {
      ...base,
      status: "unsupported",
      unsupported: {
        adapterId: input.request.adapterId,
        scenarioId: input.request.scenarioId,
        profile: input.request.profile,
        scriptName: input.request.scriptName,
        reason: input.reason,
      },
    };
  }

  const support = validateSupportedP0aRequest(input.request);

  if (!support.ok) {
    throw new Error(`Unsupported P0a request: ${support.reason}`);
  }

  if (!input.tracePath) {
    throw new Error("Completed, partial, and failed runs require a tracePath");
  }

  if (input.status === "failed") {
    if (!input.error) {
      throw new Error("Failed runs require an error payload");
    }

    return {
      ...base,
      status: "failed",
      tracePath: input.tracePath,
      error: input.error,
    };
  }

  const metrics = compactMetrics(input.metrics ?? {});
  assertRequiredMetrics(input.request.scriptName, input.status, metrics);

  return {
    ...base,
    status: input.status,
    tracePath: input.tracePath,
    metrics,
  };
}

export function createArtifactFileStem(request: BenchRunRequest): string {
  return [
    request.browserName,
    request.adapterId,
    request.profile,
    request.scenarioId.toLowerCase(),
    request.scale,
    request.scriptName,
  ].join("-");
}

export function createRunArtifactFileStem(input: {
  adapterId: BenchAdapterId;
  profile: BenchAdapterProfile;
  scenarioId: ScenarioId;
  scale: ScenarioScale;
  scriptName: BenchScriptName;
  browserName: BenchBrowserName;
  timestamp: string;
}): string {
  return `${createArtifactFileStem({
    adapterId: input.adapterId,
    profile: input.profile,
    scenarioId: input.scenarioId,
    scale: input.scale,
    scriptName: input.scriptName,
    browserName: input.browserName,
    browserVersion: "",
    seed: 0,
    rowCount: 0,
    viewport: { width: 0, height: 0 },
    fontStack: "",
    deviceScaleFactor: 1,
  })}-${sanitizeTimestamp(input.timestamp)}`;
}

export function createDashboardIndex(
  runs: readonly BenchRunSummary[],
): DashboardIndex {
  const latestRunsByStem = new Map<string, BenchRunSummary>();

  for (const run of runs) {
    const stem = createArtifactFileStem({
      adapterId: run.adapterId,
      profile: run.profile,
      scenarioId: run.scenarioId,
      scale: run.scale,
      scriptName: run.scriptName,
      browserName: run.browserName,
      browserVersion: run.browserVersion,
      seed: run.seed,
      rowCount: run.rowCount,
      viewport: run.viewport,
      fontStack: run.fontStack,
      deviceScaleFactor: run.deviceScaleFactor,
    });
    const current = latestRunsByStem.get(stem);

    if (!current || compareBenchRuns(current, run) < 0) {
      latestRunsByStem.set(stem, run);
    }
  }

  return {
    adapters: summarizeDashboardAdapters(latestRunsByStem.values()),
    runs: [...latestRunsByStem.values()].sort(compareBenchRuns),
  };
}

export function getBenchAdapterFamily(
  adapterId: BenchAdapterId,
): BenchAdapterFamily {
  return getSharedBenchAdapterFamily(adapterId);
}

function compactMetrics(
  metrics: Partial<Record<BenchMetricId, number>>,
): Partial<Record<BenchMetricId, number>> {
  for (const [metricId, value] of Object.entries(metrics)) {
    if (value !== undefined && !Number.isFinite(value)) {
      throw new Error(`Metric must be finite: ${metricId}`);
    }
  }

  return Object.fromEntries(
    Object.entries(metrics).filter(([, value]) => value !== undefined),
  ) as Partial<Record<BenchMetricId, number>>;
}

function assertRequiredMetrics(
  scriptName: BenchScriptName,
  status: "completed" | "partial",
  metrics: Partial<Record<BenchMetricId, number>>,
) {
  const requiredMetricIds =
    scriptName === "initial"
      ? ([
          "mount_ms",
          "first_stable_viewport_ms",
          "dom_nodes_peak",
        ] satisfies readonly BenchMetricId[])
      : (["dom_nodes_peak"] satisfies readonly BenchMetricId[]);

  for (const metricId of requiredMetricIds) {
    if (metrics[metricId] === undefined) {
      throw new Error(`Missing required metric: ${metricId}`);
    }
  }

  if (status === "completed" && scriptName === "scroll") {
    for (const metricId of [
      "scroll_frame_p95_ms",
      "long_tasks_count",
      "long_tasks_ms",
    ] satisfies readonly BenchMetricId[]) {
      if (metrics[metricId] === undefined) {
        throw new Error(`Missing required metric: ${metricId}`);
      }
    }
  }

  if (
    status === "completed" &&
    (scriptName === "sort" ||
      scriptName === "filter-metadata" ||
      scriptName === "filter-text")
  ) {
    for (const metricId of [
      "interaction_latency_ms",
      "settle_duration_ms",
      "post_interaction_blank_gap_frames",
      "post_interaction_anchor_shift_px",
      "post_interaction_row_height_error_p95_px",
      "result_row_count",
      "selected_row_preserved",
      "focused_row_preserved",
    ] satisfies readonly BenchMetricId[]) {
      if (metrics[metricId] === undefined) {
        throw new Error(`Missing required metric: ${metricId}`);
      }
    }
  }
}

function compareBenchRuns(
  left: BenchRunSummary,
  right: BenchRunSummary,
): number {
  const timestampDiff = left.timestamp.localeCompare(right.timestamp);

  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  const stemDiff = createArtifactFileStem({
    adapterId: left.adapterId,
    profile: left.profile,
    scenarioId: left.scenarioId,
    scale: left.scale,
    scriptName: left.scriptName,
    browserName: left.browserName,
    browserVersion: left.browserVersion,
    seed: left.seed,
    rowCount: left.rowCount,
    viewport: left.viewport,
    fontStack: left.fontStack,
    deviceScaleFactor: left.deviceScaleFactor,
  }).localeCompare(
    createArtifactFileStem({
      adapterId: right.adapterId,
      profile: right.profile,
      scenarioId: right.scenarioId,
      scale: right.scale,
      scriptName: right.scriptName,
      browserName: right.browserName,
      browserVersion: right.browserVersion,
      seed: right.seed,
      rowCount: right.rowCount,
      viewport: right.viewport,
      fontStack: right.fontStack,
      deviceScaleFactor: right.deviceScaleFactor,
    }),
  );

  if (stemDiff !== 0) {
    return stemDiff;
  }

  return statusRank(left.status) - statusRank(right.status);
}

function summarizeDashboardAdapters(
  runs: Iterable<BenchRunSummary>,
): readonly DashboardAdapterSummary[] {
  return [...new Set([...runs].map((run) => run.adapterId))]
    .sort((left, right) => left.localeCompare(right))
    .map((adapterId) => ({
      adapterId,
      adapterFamily: getBenchAdapterFamily(adapterId),
    }));
}

function sanitizeTimestamp(timestamp: string): string {
  return timestamp.toLowerCase().replaceAll(/[:.]/g, "-");
}

function statusRank(status: BenchRunSummary["status"]): number {
  switch (status) {
    case "completed":
      return 0;
    case "partial":
      return 1;
    case "failed":
      return 2;
    case "unsupported":
      return 3;
  }
}
