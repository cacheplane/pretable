import type {
  ScenarioId,
  ScenarioScale,
} from "@pretable-internal/scenario-data";
import {
  benchAdapterFamilies as sharedBenchAdapterFamilies,
  getBenchAdapterFamily as getSharedBenchAdapterFamily,
} from "../../../shared/bench-adapter-families.js";

export type BenchAdapterId = "pretable" | "ag-grid" | "tanstack" | "mui";

export type BenchAdapterFamily =
  "candidate" | "full-grid" | "virtualization-primitive" | "unknown";

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
  | "scroll_anchor_shift_backward_p95_px"
  // Beyond-p95 streaming metrics (see apps/bench/src/bench-runtime.ts'
  // measureBenchUpdatesRun). They surface jank that frame p95 alone misses:
  // unexpected layout shift, the worst single frame, how many frames blew
  // the 60Hz budget, and whether streaming caused the viewport to drift.
  | "streaming_cls"
  | "frame_max_ms"
  | "frame_budget_overruns_count"
  | "long_tasks_max_ms"
  | "scroll_position_drift_px"
  | "visible_row_count_drift"
  /** 1 when the adapter created a NEW grid instance during the run, 0 when the same
   *  instance absorbed the change. §11's replace budget says "no grid reconstruction",
   *  and an instance identity is the only thing that can prove it.
   *
   *  PASSES AT 0, like every other drift/error metric above — but UNLIKE the
   *  `selected_row_preserved` / `focused_row_preserved` pair it is required
   *  alongside, which pass at 1. An evaluator copied from those two (see
   *  scripts/bench-matrix.mjs' `median >= 1` checks) inverts this one silently. */
  | "grid_instance_reconstructed";

export type BenchScriptName =
  | "initial"
  | "scroll"
  | "sort"
  | "filter-metadata"
  | "filter-text"
  | "updates"
  | "autosize"
  | "select-range-extend"
  | "keyboard-nav-row"
  | "select-all"
  | "scroll-with-format"
  | "scroll-with-render"
  | "scroll-with-heavy-render"
  | "group"
  | "group-expand"
  | "group-updates"
  | "group-updates-stable-keys"
  /** One `setRows` of a fresh window over an equal-length resident set — the poll
   *  refresh path. Measured SEPARATELY from `append` (D1-PERF-04): they exercise
   *  different engine work and conflating them hides a regression in either. */
  | "replace"
  /** One `setRows` of resident ++ a new window — the load-more path. */
  | "append";

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
  "streaming_cls",
  "frame_max_ms",
  "frame_budget_overruns_count",
  "long_tasks_max_ms",
  "scroll_position_drift_px",
  "visible_row_count_drift",
  "grid_instance_reconstructed",
];

export const benchScriptNames: readonly BenchScriptName[] = [
  "initial",
  "scroll",
  "sort",
  "filter-metadata",
  "filter-text",
  "updates",
  "autosize",
  "select-range-extend",
  "keyboard-nav-row",
  "select-all",
  "scroll-with-format",
  "scroll-with-render",
  "scroll-with-heavy-render",
  "group",
  "group-expand",
  "group-updates",
  "group-updates-stable-keys",
  "replace",
  "append",
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

  if (!["S1", "S2", "S3", "S4", "S5", "S7"].includes(request.scenarioId)) {
    return {
      ok: false,
      reason: `Unsupported scenario for P0a: ${request.scenarioId}`,
    };
  }

  // Every allowlist below is ANNOTATED `readonly BenchScriptName[]` rather than
  // left to infer `string[]`, so a name outside the union — a typo, or a script
  // added to `BenchScriptName` and forgotten here — fails typecheck instead of
  // rejecting the request at runtime with "Unsupported script for P0a".
  //
  // Annotation, not `satisfies`: `satisfies` narrows each array to its own
  // literal union, and `.includes(request.scriptName)` then fails to compile
  // because the argument is the full `BenchScriptName`.
  const interactionScripts: readonly BenchScriptName[] = [
    "sort",
    "filter-metadata",
    "filter-text",
  ];
  // B2 follow-up #5b: sort + filter-metadata + filter-text are supported
  // across all four adapters on S2/S7. Each adapter wires its native
  // sort/filter API in apps/bench/src/{pretable,ag-grid,tanstack,mui}-adapter.tsx
  // (pretable: column-state via useEffect; ag-grid: applyColumnState +
  // setFilterModel; tanstack: setSorting + setColumnFilters; mui:
  // apiRef.setSortModel + setFilterModel). The bench-app dispatch is
  // adapter-agnostic via measureBenchInteractionRun's DOM-default state
  // reader (telemetry override is pretable-only).
  const selectionNavScripts: readonly BenchScriptName[] = [
    "select-range-extend",
    "keyboard-nav-row",
    "select-all",
  ];
  const cellRendererScripts: readonly BenchScriptName[] = [
    "scroll-with-format",
    "scroll-with-render",
    "scroll-with-heavy-render",
  ];
  // Row-grouping family. `group` applies a grouping to an ungrouped grid and
  // `group-expand` toggles one group's expansion on an already-grouped one, so
  // both run through measureBenchInteractionRun; the two streaming variants
  // stream row updates into a grouped grid and run through
  // measureBenchUpdatesRun.
  //
  // `group-updates` and `group-updates-stable-keys` differ in ONE respect: the
  // former's patch generator can pick the grouping level (so rows re-path
  // between groups mid-run and the tree is rebuilt with a different shape each
  // tick), the latter's cannot. That separates "grouping under streaming" from
  // "grouping-key churn under streaming"; see apps/bench/src/bench-runtime.ts'
  // MeasureBenchUpdatesOptions.excludeColumnIds.
  //
  // All four are pretable-only — see the adapter gate below.
  const groupingInteractionScripts: readonly BenchScriptName[] = [
    "group",
    "group-expand",
  ];
  const groupingStreamingScripts: readonly BenchScriptName[] = [
    "group-updates",
    "group-updates-stable-keys",
  ];
  const groupingScripts: readonly BenchScriptName[] = [
    ...groupingInteractionScripts,
    ...groupingStreamingScripts,
  ];
  // Both change the ROW SET rather than display state, which is why they gate
  // together here. Why they are two names rather than one is on BenchScriptName.
  const rowSetChangeScripts: readonly BenchScriptName[] = ["replace", "append"];
  const supportedScripts: readonly BenchScriptName[] = [
    "initial",
    "scroll",
    "updates",
    "autosize",
    ...interactionScripts,
    ...selectionNavScripts,
    ...cellRendererScripts,
    ...groupingScripts,
    ...rowSetChangeScripts,
  ];

  if (!supportedScripts.includes(request.scriptName)) {
    return {
      ok: false,
      reason: `Unsupported script for P0a: ${request.scriptName}`,
    };
  }

  if (request.scriptName === "autosize") {
    if (request.adapterId === "tanstack") {
      return {
        ok: false,
        reason: `Unsupported adapter for autosize script: ${request.adapterId} (TanStack Table is headless; no autosize API)`,
      };
    }

    if (request.scenarioId !== "S2") {
      return {
        ok: false,
        reason: `Unsupported scenario for autosize script: ${request.scenarioId}`,
      };
    }
  }

  if (request.scriptName === "updates") {
    // All four bench adapters wire their idiomatic streaming pattern (see
    // apps/bench/src/{pretable,ag-grid,tanstack,mui}-adapter.tsx). The
    // script remains S5-only — that's the streaming-updates scenario.
    if (request.scenarioId !== "S5") {
      return {
        ok: false,
        reason: `Unsupported scenario for updates script: ${request.scenarioId}`,
      };
    }
  }

  if (interactionScripts.includes(request.scriptName)) {
    if (!["S2", "S7"].includes(request.scenarioId)) {
      return {
        ok: false,
        reason: `Unsupported scenario for interaction script ${request.scriptName}: ${request.scenarioId} (S2/S7 only)`,
      };
    }
  }

  if (selectionNavScripts.includes(request.scriptName)) {
    // Range/all selection are paid-tier features in AG Grid Enterprise and
    // MUI X Pro; TanStack Table doesn't ship native cell selection. Keep
    // these pretable-only.
    if (request.adapterId !== "pretable") {
      return {
        ok: false,
        reason: `Unsupported adapter for ${request.scriptName}: ${request.adapterId} (selection is Community-tier paid in AG Grid + MUI; not available in TanStack)`,
      };
    }

    if (request.scenarioId !== "S2") {
      return {
        ok: false,
        reason: `Unsupported scenario for ${request.scriptName}: ${request.scenarioId} (Slab 1 — S2 only)`,
      };
    }
  }

  if (cellRendererScripts.includes(request.scriptName)) {
    // All four bench adapters wire scriptName-driven cell-renderer
    // branches in apps/bench/src/{pretable,ag-grid,tanstack,mui}-adapter.tsx
    // (Phase 1+2+3 of B2). The script measures scroll p95 with format /
    // renderCell / heavy-render columns mounted; runs through the
    // existing measureBenchScrollRun helper.
    if (request.scenarioId !== "S2") {
      return {
        ok: false,
        reason: `Unsupported scenario for ${request.scriptName}: ${request.scenarioId} (S2 only)`,
      };
    }
  }

  if (groupingScripts.includes(request.scriptName)) {
    // Row grouping is AG Grid Enterprise and MUI X Premium; TanStack Table
    // ships no row-grouping row model of its own. This repo uses only the
    // free tiers, so there is nothing to compare against and these numbers
    // are ABSOLUTE + a regression tripwire, never a competitive claim.
    if (request.adapterId !== "pretable") {
      return {
        ok: false,
        reason: `Unsupported adapter for ${request.scriptName}: ${request.adapterId} (row grouping is AG Grid Enterprise / MUI X Premium and absent from TanStack Table; pretable-only, not a comparative claim)`,
      };
    }
  }

  if (rowSetChangeScripts.includes(request.scriptName)) {
    // `setRows(rows, meta)` with a preserved grid instance is a pretable
    // primitive; the other three adapters have no equivalent path to measure,
    // so these numbers are ABSOLUTE and never a competitive claim.
    if (request.adapterId !== "pretable") {
      return {
        ok: false,
        reason: `Unsupported adapter for ${request.scriptName}: ${request.adapterId} (server-authority setRows is pretable-only, not a comparative claim)`,
      };
    }
  }

  if (groupingInteractionScripts.includes(request.scriptName)) {
    // Same scenarios as the other interaction scripts, so `group` reads
    // against `sort` / `filter-metadata` on identical data.
    if (!["S2", "S7"].includes(request.scenarioId)) {
      return {
        ok: false,
        reason: `Unsupported scenario for grouping interaction script ${request.scriptName}: ${request.scenarioId} (S2/S7 only)`,
      };
    }
  }

  if (groupingStreamingScripts.includes(request.scriptName)) {
    // Mirrors `updates`: S5 is the streaming-updates scenario, and holding
    // the scenario fixed is what makes both grouped variants readable against
    // it and against each other.
    if (request.scenarioId !== "S5") {
      return {
        ok: false,
        reason: `Unsupported scenario for ${request.scriptName} script: ${request.scenarioId} (S5 only)`,
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
      scriptName === "filter-text" ||
      // `group` and `group-expand` run the same measurement shape, so they
      // owe the same metrics — that is what makes them readable side by side.
      scriptName === "group" ||
      scriptName === "group-expand")
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

  if (scriptName === "replace" || scriptName === "append") {
    // No partial credit for these two. D1-PERF-04 asks for a number per path and
    // §11's ceilings stay proposals until one exists, but a `partial` owes only
    // `dom_nodes_peak` — so it records a run that measured nothing while still
    // producing an artifact under a name the ledger reads as a measurement.
    //
    // `replace` is the path that made this necessary. A same-ids replacement over
    // an equal-length resident set moves none of `createVisibleRowSignature`'s
    // three components, so row identity alone cannot see it; the settle detector
    // in apps/bench/src/bench-runtime.ts therefore folds
    // `createVisibleContentSignature` in alongside it, which is what lets replace
    // latch at all. Without that composition it would run out its frame budget
    // and land here as a partial that measured nothing.
    //
    // `measureBenchDataUpdateRun` is what keeps this unreachable: it returns
    // `failed` with the cause attached at every point it can stop short, so the
    // stop is recorded WITH its reason rather than converted into a status this
    // refuses. The throw is the backstop for a caller that has not done that —
    // and it is a throw, not a recorded status, because the alternative is an
    // artifact under a measured script's name that no reader can tell from one.
    if (status === "partial") {
      throw new Error(
        `Partial runs cannot substantiate the ${scriptName} budget: record it as failed with the reason the measurement stopped`,
      );
    }

    for (const metricId of [
      // The interaction set above, in the same order, so the two blocks read
      // against each other.
      "interaction_latency_ms",
      "settle_duration_ms",
      "post_interaction_blank_gap_frames",
      "post_interaction_anchor_shift_px",
      "post_interaction_row_height_error_p95_px",
      "result_row_count",
      "selected_row_preserved",
      "focused_row_preserved",
      // Then the two this family is budgeted on: append's ceiling is worded as
      // "zero scroll movement", which is the viewport's own offset (drift), not
      // the content movement anchor shift measures; and replace's is worded as
      // "no grid reconstruction".
      "scroll_position_drift_px",
      "grid_instance_reconstructed",
    ] satisfies readonly BenchMetricId[]) {
      if (metrics[metricId] === undefined) {
        throw new Error(`Missing required metric: ${metricId}`);
      }
    }
  }

  // Both grouped streaming scripts run through measureBenchUpdatesRun, which
  // always emits the streaming set. (`updates` itself has no entry here — a
  // pre-existing gap left alone so this change cannot shift an existing
  // script's result.)
  if (
    status === "completed" &&
    (scriptName === "group-updates" ||
      scriptName === "group-updates-stable-keys")
  ) {
    for (const metricId of [
      "scroll_frame_p95_ms",
      "long_tasks_count",
      "long_tasks_ms",
      "streaming_cls",
      "frame_max_ms",
      "frame_budget_overruns_count",
      "long_tasks_max_ms",
      "scroll_position_drift_px",
      "visible_row_count_drift",
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
