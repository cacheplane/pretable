import test from "node:test";
import assert from "node:assert/strict";

import {
  createBenchPreviewLaunch,
  createBenchRunsetManifest,
  createBenchMatrixEntries,
  createHypothesisReport,
  parseBenchMatrixArgs,
} from "../bench-matrix.mjs";

test("parseBenchMatrixArgs defaults to the runnable P0a scenario and script matrix", () => {
  assert.deepEqual(parseBenchMatrixArgs([]), {
    adapters: ["pretable", "ag-grid"],
    repeats: 1,
    scale: "dev",
    scenarios: ["S1", "S2"],
    scripts: ["initial", "scroll"],
    passthroughArgs: [],
  });
});

test("parseBenchMatrixArgs accepts explicit adapter, scenario, script, and playwright passthrough args", () => {
  assert.deepEqual(
    parseBenchMatrixArgs([
      "--adapters=ag-grid",
      "--repeats=3",
      "--scale=hypothesis",
      "--scenarios=S2",
      "--scripts=scroll",
      "--project=chromium",
    ]),
    {
      adapters: ["ag-grid"],
      repeats: 3,
      scale: "hypothesis",
      scenarios: ["S2"],
      scripts: ["scroll"],
      passthroughArgs: ["--project=chromium"],
    },
  );
});

test("createBenchMatrixEntries expands scenarios and scripts in stable order", () => {
  assert.deepEqual(
    createBenchMatrixEntries({
      adapters: ["pretable", "ag-grid"],
      repeats: 2,
      scale: "dev",
      scenarios: ["S1", "S2"],
      scripts: ["initial", "scroll"],
      passthroughArgs: [],
    }),
    [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "initial",
      },
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "scroll",
      },
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "initial",
      },
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "scroll",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "initial",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "scroll",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "initial",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "scroll",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "initial",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "scroll",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "initial",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "scroll",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "initial",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "scroll",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "initial",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "scroll",
      },
    ],
  );
});

test("createBenchRunsetManifest records the invoked matrix and produced summary paths", () => {
  assert.deepEqual(
    createBenchRunsetManifest({
      runsetId: "2026-04-10t14-00-00-000z",
      startedAt: "2026-04-10T14:00:00.000Z",
      completedAt: "2026-04-10T14:02:00.000Z",
      entries: [
        {
          adapterId: "pretable",
          scenarioId: "S1",
          scriptName: "initial",
          summaryPath:
            "status/chromium-pretable-default-s1-initial-2026-04-10t14-00-00-000z.summary.json",
        },
      ],
    }),
    {
      runsetId: "2026-04-10t14-00-00-000z",
      startedAt: "2026-04-10T14:00:00.000Z",
      completedAt: "2026-04-10T14:02:00.000Z",
      entries: [
        {
          adapterId: "pretable",
          scenarioId: "S1",
          scriptName: "initial",
          summaryPath:
            "status/chromium-pretable-default-s1-initial-2026-04-10t14-00-00-000z.summary.json",
        },
      ],
    },
  );
});

test("createBenchPreviewLaunch builds explicitly and starts vite preview directly", () => {
  const launch = createBenchPreviewLaunch("/repo/pretable");

  assert.deepEqual(launch.build, {
    command: "pnpm",
    args: ["--filter", "@pretable/app-bench", "build"],
    cwd: "/repo/pretable",
  });
  assert.deepEqual(launch.preview, {
    command: "pnpm",
    args: [
      "exec",
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4173",
      "--strictPort",
    ],
    cwd: "/repo/pretable/apps/bench",
  });
});

test("shared adapter-family source covers benchmark adapters", async () => {
  const { benchAdapterFamilies, getBenchAdapterFamily } =
    await import("../../shared/bench-adapter-families.js");

  assert.equal(getBenchAdapterFamily("pretable"), "candidate");
  assert.equal(getBenchAdapterFamily("ag-grid"), "full-grid");
  assert.equal(getBenchAdapterFamily("tanstack"), "virtualization-primitive");
  assert.equal(benchAdapterFamilies.mui, "full-grid");
});

test("createHypothesisReport distinguishes directional evidence from missing proof", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t14-00-00-000z",
    generatedAt: "2026-04-10T14:02:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        scenarioId: "S1",
        scriptName: "initial",
        summaryPath:
          "status/chromium-pretable-default-s1-initial-2026-04-10t14-00-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-scroll-2026-04-10t14-01-00-000z.summary.json",
      },
    ],
    runs: [
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S1",
        scriptName: "initial",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-10T14:00:30.000Z",
        seed: 101,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        notes: [],
        status: "completed",
        tracePath:
          "status/traces/chromium-pretable-default-s1-initial.trace.zip",
        metrics: {
          mount_ms: 2.3,
          first_stable_viewport_ms: 2.3,
          dom_nodes_peak: 268,
        },
      },
      {
        adapterId: "ag-grid",
        profile: "default",
        scenarioId: "S2",
        scriptName: "scroll",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-10T14:01:35.000Z",
        seed: 202,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        notes: [],
        status: "completed",
        tracePath: "status/traces/chromium-ag-grid-default-s2-scroll.trace.zip",
        metrics: {
          scroll_frame_p95_ms: 26.2,
          blank_gap_frames: 0,
          long_tasks_count: 0,
          long_tasks_ms: 0,
          dom_nodes_peak: 684,
          row_height_error_p95_px: 0.2,
          scroll_anchor_shift_px: 8,
        },
      },
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S2",
        scriptName: "scroll",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-10T14:01:30.000Z",
        seed: 202,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        notes: [],
        status: "completed",
        tracePath:
          "status/traces/chromium-pretable-default-s2-scroll.trace.zip",
        metrics: {
          scroll_frame_p95_ms: 12.4,
          blank_gap_frames: 0,
          long_tasks_count: 0,
          long_tasks_ms: 0,
          dom_nodes_peak: 512,
        },
      },
    ],
  });

  assert.equal(
    report.hypotheses.find((item) => item.id === "H1")?.status,
    "satisfied",
  );
  assert.match(
    report.hypotheses.find((item) => item.id === "H1")?.summary ?? "",
    /25%|relative/i,
  );
  assert.equal(
    report.hypotheses.find((item) => item.id === "H5")?.status,
    "satisfied",
  );
});

test("createHypothesisReport emits H6 when sort interaction evidence exists", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-14t21-00-00-000z",
    generatedAt: "2026-04-14T21:02:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "sort",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-sort-2026-04-14t21-00-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "sort",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-sort-2026-04-14t21-00-30-000z.summary.json",
      },
    ],
    runs: [
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-14T21:00:30.000Z",
        seed: 202,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "completed",
        notes: ["interaction mode: sort"],
        tracePath: "status/traces/pretable-sort.trace.zip",
        metrics: {
          interaction_latency_ms: 24,
          settle_duration_ms: 18,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 400,
        },
      },
      {
        adapterId: "ag-grid",
        profile: "default",
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-14T21:00:45.000Z",
        seed: 202,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "completed",
        notes: ["interaction mode: sort"],
        tracePath: "status/traces/ag-grid-sort.trace.zip",
        metrics: {
          interaction_latency_ms: 31,
          settle_duration_ms: 22,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 520,
        },
      },
    ],
  });

  const h6 = report.hypotheses.find((hypothesis) => hypothesis.id === "H6");

  assert.ok(h6);
  assert.equal(h6.status, "satisfied");
  assert.match(h6.summary, /sort/i);
});

test("createHypothesisReport does not satisfy H6 when worst-case repeats exceed interaction thresholds", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-14t21-10-00-000z",
    generatedAt: "2026-04-14T21:12:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "sort",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-sort-2026-04-14t21-10-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scenarioId: "S2",
        scriptName: "sort",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-sort-2026-04-14t21-10-10-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 2,
        scenarioId: "S2",
        scriptName: "sort",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-sort-2026-04-14t21-10-20-000z.summary.json",
      },
    ],
    runs: [
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-14T21:10:00.000Z",
        seed: 202,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "completed",
        notes: ["interaction mode: sort"],
        tracePath: "status/traces/pretable-sort-0.trace.zip",
        metrics: {
          interaction_latency_ms: 20,
          settle_duration_ms: 18,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 400,
        },
      },
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-14T21:10:10.000Z",
        seed: 202,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "completed",
        notes: ["interaction mode: sort"],
        tracePath: "status/traces/pretable-sort-1.trace.zip",
        metrics: {
          interaction_latency_ms: 24,
          settle_duration_ms: 20,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 400,
        },
      },
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-14T21:10:20.000Z",
        seed: 202,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "completed",
        notes: ["interaction mode: sort"],
        tracePath: "status/traces/pretable-sort-2.trace.zip",
        metrics: {
          interaction_latency_ms: 120,
          settle_duration_ms: 85,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 64,
          post_interaction_row_height_error_p95_px: 0,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 420,
        },
      },
    ],
  });

  const h6 = report.hypotheses.find((hypothesis) => hypothesis.id === "H6");

  assert.ok(h6);
  assert.equal(h6.status, "failing");
  assert.match(h6.summary, /worst-case|thresholds/i);
});

test("createHypothesisReport aggregates repeated runs by median instead of trusting the latest sample", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t15-00-00-000z",
    generatedAt: "2026-04-10T15:03:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-00-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-01-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 2,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-02-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-scroll-2026-04-10t15-00-30-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 1,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-scroll-2026-04-10t15-01-30-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 2,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-scroll-2026-04-10t15-02-30-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:00:00.000Z",
        scroll_frame_p95_ms: 12.4,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:01:00.000Z",
        scroll_frame_p95_ms: 40.2,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:02:00.000Z",
        scroll_frame_p95_ms: 13.1,
      }),
      createScrollRun({
        adapterId: "ag-grid",
        timestamp: "2026-04-10T15:00:30.000Z",
        scroll_frame_p95_ms: 27.6,
        row_height_error_p95_px: 42,
        scroll_anchor_shift_px: 128,
      }),
      createScrollRun({
        adapterId: "ag-grid",
        timestamp: "2026-04-10T15:01:30.000Z",
        scroll_frame_p95_ms: 28.4,
        row_height_error_p95_px: 44,
        scroll_anchor_shift_px: 132,
      }),
      createScrollRun({
        adapterId: "ag-grid",
        timestamp: "2026-04-10T15:02:30.000Z",
        scroll_frame_p95_ms: 29.5,
        row_height_error_p95_px: 45,
        scroll_anchor_shift_px: 136,
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");

  assert.equal(h1?.status, "satisfied");
  assert.match(h1?.summary ?? "", /median|repeat/i);
  assert.equal(h1?.evidence[0]?.sampleCount, 3);
  assert.equal(h1?.evidence[0]?.metrics.scroll_frame_p95_ms, 13.1);
  assert.deepEqual(h1?.evidence[0]?.metricSummary.scroll_frame_p95_ms, {
    min: 12.4,
    median: 13.1,
    max: 40.2,
  });
  assert.deepEqual(h1?.evidence[0]?.policyNotes.common, [
    "contain: none",
    "content visibility: visible",
    "contain intrinsic size: none",
    "scroll anchoring: none",
    "overscroll behavior: contain",
  ]);
  assert.deepEqual(h1?.evidence[0]?.policyNotes.varying, {});
  assert.equal(h1?.evidence[1]?.sampleCount, 3);
  assert.equal(h1?.evidence[1]?.metrics.scroll_frame_p95_ms, 28.4);
});

test("createHypothesisReport exposes worst-case H1 threshold metrics alongside medians", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t15-10-00-000z",
    generatedAt: "2026-04-10T15:13:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-10-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-11-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 2,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-12-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-scroll-2026-04-10t15-10-30-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:10:00.000Z",
        scroll_frame_p95_ms: 12.8,
        blank_gap_frames: 0,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:11:00.000Z",
        scroll_frame_p95_ms: 13.1,
        blank_gap_frames: 0,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:12:00.000Z",
        scroll_frame_p95_ms: 13.4,
        blank_gap_frames: 1,
      }),
      createScrollRun({
        adapterId: "ag-grid",
        timestamp: "2026-04-10T15:10:30.000Z",
        scroll_frame_p95_ms: 28.4,
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");

  assert.equal(h1?.status, "failing");
  assert.match(h1?.summary ?? "", /medians/i);
  assert.match(h1?.summary ?? "", /worst-case|repeat/i);
  assert.equal(h1?.evidence[0]?.metrics.blank_gap_frames, 0);
  assert.deepEqual(h1?.evidence[0]?.metricSummary.blank_gap_frames, {
    min: 0,
    median: 0,
    max: 1,
  });
});

test("createHypothesisReport prefers the best full-grid comparator for H1 while keeping primitive comparators as context", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t15-15-00-000z",
    generatedAt: "2026-04-10T15:18:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-15-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-scroll-2026-04-10t15-15-30-000z.summary.json",
      },
      {
        adapterId: "tanstack",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-tanstack-default-s2-dev-scroll-2026-04-10t15-16-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:15:00.000Z",
        scroll_frame_p95_ms: 12.4,
      }),
      createScrollRun({
        adapterId: "ag-grid",
        timestamp: "2026-04-10T15:15:30.000Z",
        scroll_frame_p95_ms: 26.2,
        row_height_error_p95_px: 0.2,
        scroll_anchor_shift_px: 8,
      }),
      createScrollRun({
        adapterId: "tanstack",
        timestamp: "2026-04-10T15:16:00.000Z",
        scroll_frame_p95_ms: 20.1,
        scroll_anchor_shift_px: 96,
        scroll_anchor_shift_forward_p95_px: 96,
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");

  assert.equal(h1?.status, "satisfied");
  assert.match(h1?.summary ?? "", /full-grid/i);
  assert.equal(h1?.evidence[0]?.adapterId, "pretable");
  assert.equal(h1?.evidence[0]?.adapterFamily, "candidate");
  assert.equal(h1?.evidence[1]?.adapterId, "ag-grid");
  assert.equal(h1?.evidence[1]?.adapterFamily, "full-grid");
  assert.equal(h1?.evidence[2]?.adapterId, "tanstack");
  assert.equal(h1?.evidence[2]?.adapterFamily, "virtualization-primitive");
});

test("createHypothesisReport surfaces top-level adapter families and matrix scope", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t15-20-00-000z",
    generatedAt: "2026-04-10T15:21:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-20-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-scroll-2026-04-10t15-20-30-000z.summary.json",
      },
      {
        adapterId: "tanstack",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-tanstack-default-s2-dev-scroll-2026-04-10t15-21-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:20:00.000Z",
        scroll_frame_p95_ms: 12.4,
      }),
      createScrollRun({
        adapterId: "ag-grid",
        timestamp: "2026-04-10T15:20:30.000Z",
        scroll_frame_p95_ms: 26.2,
      }),
      createScrollRun({
        adapterId: "tanstack",
        timestamp: "2026-04-10T15:21:00.000Z",
        scroll_frame_p95_ms: 20.1,
      }),
    ],
  });

  assert.deepEqual(report.adapters, [
    { adapterId: "pretable", adapterFamily: "candidate" },
    { adapterId: "ag-grid", adapterFamily: "full-grid" },
    {
      adapterId: "tanstack",
      adapterFamily: "virtualization-primitive",
    },
  ]);
  assert.deepEqual(report.matrix, {
    adapters: ["pretable", "ag-grid", "tanstack"],
    scenarios: ["S2"],
    scripts: ["scroll"],
    repeats: 1,
  });
});

test("createHypothesisReport surfaces per-slice policy context across compared runs", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t15-25-00-000z",
    generatedAt: "2026-04-10T15:26:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-25-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-scroll-2026-04-10t15-25-30-000z.summary.json",
      },
      {
        adapterId: "tanstack",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-tanstack-default-s2-dev-scroll-2026-04-10t15-26-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:25:00.000Z",
        scroll_frame_p95_ms: 12.4,
      }),
      createScrollRun({
        adapterId: "ag-grid",
        timestamp: "2026-04-10T15:25:30.000Z",
        scroll_frame_p95_ms: 26.2,
      }),
      createScrollRun({
        adapterId: "tanstack",
        timestamp: "2026-04-10T15:26:00.000Z",
        scroll_frame_p95_ms: 20.1,
        notes: [
          "contain: layout",
          "content visibility: visible",
          "contain intrinsic size: none",
          "scroll anchoring: none",
          "overscroll behavior: contain",
        ],
      }),
    ],
  });

  assert.deepEqual(report.slices, [
    {
      scenarioId: "S2",
      scriptName: "scroll",
      adapterIds: ["pretable", "ag-grid", "tanstack"],
      policyNotes: {
        common: [
          "content visibility: visible",
          "contain intrinsic size: none",
          "scroll anchoring: none",
          "overscroll behavior: contain",
        ],
        union: [
          "contain: none",
          "content visibility: visible",
          "contain intrinsic size: none",
          "scroll anchoring: none",
          "overscroll behavior: contain",
          "contain: layout",
        ],
        varying: {
          contain: ["layout", "none"],
        },
      },
    },
  ]);
});

test("createHypothesisReport records policy-note drift across repeated runs", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t15-30-00-000z",
    generatedAt: "2026-04-10T15:33:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-30-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-31-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 2,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-32-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:30:00.000Z",
        scroll_frame_p95_ms: 13.1,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:31:00.000Z",
        scroll_frame_p95_ms: 13.4,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:32:00.000Z",
        scroll_frame_p95_ms: 13.3,
        notes: [
          "contain: layout",
          "content visibility: visible",
          "contain intrinsic size: none",
          "scroll anchoring: none",
          "overscroll behavior: contain",
        ],
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");

  assert.equal(h1?.status, "directional");
  assert.match(h1?.summary ?? "", /policy|drift|reproduc/i);
  assert.deepEqual(h1?.evidence[0]?.policyNotes.common, [
    "content visibility: visible",
    "contain intrinsic size: none",
    "scroll anchoring: none",
    "overscroll behavior: contain",
  ]);
  assert.deepEqual(h1?.evidence[0]?.policyNotes.varying, {
    contain: ["layout", "none"],
  });
});

test("createHypothesisReport includes unsupported entries without erroring", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-16t10-00-00-000z",
    generatedAt: "2026-04-16T10:02:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "sort",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-sort-2026-04-16t10-00-00-000z.summary.json",
      },
      {
        adapterId: "ag-grid",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "sort",
        summaryPath:
          "status/chromium-ag-grid-default-s2-dev-sort-2026-04-16t10-00-00-000z.summary.json",
      },
    ],
    runs: [
      {
        adapterId: "pretable",
        profile: "default",
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-16T10:00:30.000Z",
        seed: 202,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "completed",
        notes: ["interaction mode: sort"],
        tracePath: "status/traces/pretable-sort.trace.zip",
        metrics: {
          interaction_latency_ms: 24,
          settle_duration_ms: 18,
          post_interaction_blank_gap_frames: 0,
          post_interaction_anchor_shift_px: 0,
          post_interaction_row_height_error_p95_px: 0,
          result_row_count: 750,
          selected_row_preserved: 1,
          focused_row_preserved: 1,
          dom_nodes_peak: 400,
        },
      },
      {
        adapterId: "ag-grid",
        profile: "default",
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
        browserName: "chromium",
        browserVersion: "123.0",
        timestamp: "2026-04-16T10:00:45.000Z",
        seed: 202,
        rowCount: 750,
        viewport: { width: 1440, height: 900 },
        fontStack: '"IBM Plex Sans", system-ui, sans-serif',
        deviceScaleFactor: 1,
        status: "unsupported",
        notes: [],
        unsupported: {
          adapterId: "ag-grid",
          scenarioId: "S2",
          profile: "default",
          scriptName: "sort",
          reason: "Unsupported adapter for interaction script sort: ag-grid",
        },
      },
    ],
  });

  const h6 = report.hypotheses.find((hypothesis) => hypothesis.id === "H6");

  assert.ok(h6);
  assert.equal(h6.status, "satisfied");
});

function createScrollRun({
  adapterId,
  timestamp,
  notes = [
    "contain: none",
    "content visibility: visible",
    "contain intrinsic size: none",
    "scroll anchoring: none",
    "overscroll behavior: contain",
  ],
  scroll_frame_p95_ms,
  blank_gap_frames = 0,
  long_tasks_count = 0,
  row_height_error_p95_px = 0,
  scroll_anchor_shift_px = 0,
  scroll_anchor_shift_forward_p95_px = 0,
  scroll_anchor_shift_backward_p95_px = 0,
}) {
  return {
    adapterId,
    profile: "default",
    scenarioId: "S2",
    scriptName: "scroll",
    browserName: "chromium",
    browserVersion: "123.0",
    timestamp,
    seed: 202,
    viewport: { width: 1440, height: 900 },
    fontStack: '"IBM Plex Sans", system-ui, sans-serif',
    deviceScaleFactor: 1,
    notes,
    status: "completed",
    tracePath: `status/traces/chromium-${adapterId}-default-s2-scroll.trace.zip`,
    metrics: {
      scroll_frame_p95_ms,
      blank_gap_frames,
      long_tasks_count,
      long_tasks_ms: 0,
      dom_nodes_peak: adapterId === "pretable" ? 1823 : 657,
      row_height_error_p95_px,
      ...(scroll_anchor_shift_px === undefined
        ? {}
        : { scroll_anchor_shift_px }),
      scroll_anchor_shift_forward_p95_px,
      scroll_anchor_shift_backward_p95_px,
    },
  };
}
