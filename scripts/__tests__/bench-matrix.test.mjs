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
    adapters: ["pretable", "gridalpha"],
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
      "--adapters=gridalpha",
      "--repeats=3",
      "--scale=hypothesis",
      "--scenarios=S2",
      "--scripts=scroll",
      "--project=chromium",
    ]),
    {
      adapters: ["gridalpha"],
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
      adapters: ["pretable", "gridalpha"],
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
        adapterId: "gridalpha",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "initial",
      },
      {
        adapterId: "gridalpha",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "scroll",
      },
      {
        adapterId: "gridalpha",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "initial",
      },
      {
        adapterId: "gridalpha",
        repeatIndex: 0,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "scroll",
      },
      {
        adapterId: "gridalpha",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "initial",
      },
      {
        adapterId: "gridalpha",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S1",
        scriptName: "scroll",
      },
      {
        adapterId: "gridalpha",
        repeatIndex: 1,
        scale: "dev",
        scenarioId: "S2",
        scriptName: "initial",
      },
      {
        adapterId: "gridalpha",
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
    args: ["exec", "vite", "preview", "--host", "127.0.0.1", "--port", "4173"],
    cwd: "/repo/pretable/apps/bench",
  });
});

test("shared adapter-family source covers benchmark adapters", async () => {
  const { benchAdapterFamilies, getBenchAdapterFamily } =
    await import("../../shared/bench-adapter-families.js");

  assert.equal(getBenchAdapterFamily("pretable"), "candidate");
  assert.equal(getBenchAdapterFamily("gridalpha"), "full-grid");
  assert.equal(getBenchAdapterFamily("gridbeta"), "virtualization-primitive");
  assert.equal(benchAdapterFamilies.gridgamma, "full-grid");
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
        adapterId: "gridalpha",
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
        tracePath: "status/traces/chromium-gridalpha-default-s2-scroll.trace.zip",
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
    report.hypotheses.find((item) => item.id === "H3")?.status,
    "insufficient",
  );
  assert.equal(
    report.hypotheses.find((item) => item.id === "H5")?.status,
    "satisfied",
  );
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
        adapterId: "gridalpha",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridalpha-default-s2-dev-scroll-2026-04-10t15-00-30-000z.summary.json",
      },
      {
        adapterId: "gridalpha",
        repeatIndex: 1,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridalpha-default-s2-dev-scroll-2026-04-10t15-01-30-000z.summary.json",
      },
      {
        adapterId: "gridalpha",
        repeatIndex: 2,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridalpha-default-s2-dev-scroll-2026-04-10t15-02-30-000z.summary.json",
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
        adapterId: "gridalpha",
        timestamp: "2026-04-10T15:00:30.000Z",
        scroll_frame_p95_ms: 27.6,
        row_height_error_p95_px: 42,
        scroll_anchor_shift_px: 128,
      }),
      createScrollRun({
        adapterId: "gridalpha",
        timestamp: "2026-04-10T15:01:30.000Z",
        scroll_frame_p95_ms: 28.4,
        row_height_error_p95_px: 44,
        scroll_anchor_shift_px: 132,
      }),
      createScrollRun({
        adapterId: "gridalpha",
        timestamp: "2026-04-10T15:02:30.000Z",
        scroll_frame_p95_ms: 29.5,
        row_height_error_p95_px: 45,
        scroll_anchor_shift_px: 136,
      }),
    ],
  });

  const h1 = report.hypotheses.find((item) => item.id === "H1");
  const h3 = report.hypotheses.find((item) => item.id === "H3");

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
  assert.equal(h3?.status, "satisfied");
  assert.match(h3?.summary ?? "", /median|repeat/i);
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
        adapterId: "gridalpha",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridalpha-default-s2-dev-scroll-2026-04-10t15-10-30-000z.summary.json",
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
        adapterId: "gridalpha",
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

test("createHypothesisReport exposes worst-case H3 threshold metrics alongside medians", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t15-40-00-000z",
    generatedAt: "2026-04-10T15:43:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-40-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-41-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 2,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-42-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:40:00.000Z",
        row_height_error_p95_px: 0,
        scroll_anchor_shift_backward_p95_px: 0,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:41:00.000Z",
        row_height_error_p95_px: 0,
        scroll_anchor_shift_backward_p95_px: 0,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:42:00.000Z",
        row_height_error_p95_px: 6,
        scroll_anchor_shift_backward_p95_px: 20,
      }),
    ],
  });

  const h3 = report.hypotheses.find((item) => item.id === "H3");

  assert.equal(h3?.status, "failing");
  assert.match(h3?.summary ?? "", /medians/i);
  assert.match(h3?.summary ?? "", /worst-case|repeat/i);
  assert.deepEqual(h3?.evidence[0]?.metricSummary.row_height_error_p95_px, {
    min: 0,
    median: 0,
    max: 6,
  });
  assert.deepEqual(
    h3?.evidence[0]?.metricSummary.scroll_anchor_shift_backward_p95_px,
    {
      min: 0,
      median: 0,
      max: 20,
    },
  );
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
        adapterId: "gridalpha",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridalpha-default-s2-dev-scroll-2026-04-10t15-15-30-000z.summary.json",
      },
      {
        adapterId: "gridbeta",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridbeta-default-s2-dev-scroll-2026-04-10t15-16-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:15:00.000Z",
        scroll_frame_p95_ms: 12.4,
      }),
      createScrollRun({
        adapterId: "gridalpha",
        timestamp: "2026-04-10T15:15:30.000Z",
        scroll_frame_p95_ms: 26.2,
        row_height_error_p95_px: 0.2,
        scroll_anchor_shift_px: 8,
      }),
      createScrollRun({
        adapterId: "gridbeta",
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
  assert.equal(h1?.evidence[1]?.adapterId, "gridalpha");
  assert.equal(h1?.evidence[1]?.adapterFamily, "full-grid");
  assert.equal(h1?.evidence[2]?.adapterId, "gridbeta");
  assert.equal(h1?.evidence[2]?.adapterFamily, "virtualization-primitive");
});

test("createHypothesisReport marks single-sample H3 claims as single-sample evidence", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t15-17-00-000z",
    generatedAt: "2026-04-10T15:18:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-17-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:17:00.000Z",
        scroll_frame_p95_ms: 12.4,
        row_height_error_p95_px: 0,
        scroll_anchor_shift_backward_p95_px: 0,
      }),
    ],
  });

  const h3 = report.hypotheses.find((item) => item.id === "H3");

  assert.equal(h3?.status, "satisfied");
  assert.match(h3?.summary ?? "", /single[- ]sample|single run|current sample/i);
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
        adapterId: "gridalpha",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridalpha-default-s2-dev-scroll-2026-04-10t15-20-30-000z.summary.json",
      },
      {
        adapterId: "gridbeta",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridbeta-default-s2-dev-scroll-2026-04-10t15-21-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:20:00.000Z",
        scroll_frame_p95_ms: 12.4,
      }),
      createScrollRun({
        adapterId: "gridalpha",
        timestamp: "2026-04-10T15:20:30.000Z",
        scroll_frame_p95_ms: 26.2,
      }),
      createScrollRun({
        adapterId: "gridbeta",
        timestamp: "2026-04-10T15:21:00.000Z",
        scroll_frame_p95_ms: 20.1,
      }),
    ],
  });

  assert.deepEqual(report.adapters, [
    { adapterId: "pretable", adapterFamily: "candidate" },
    { adapterId: "gridalpha", adapterFamily: "full-grid" },
    {
      adapterId: "gridbeta",
      adapterFamily: "virtualization-primitive",
    },
  ]);
  assert.deepEqual(report.matrix, {
    adapters: ["pretable", "gridalpha", "gridbeta"],
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
        adapterId: "gridalpha",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridalpha-default-s2-dev-scroll-2026-04-10t15-25-30-000z.summary.json",
      },
      {
        adapterId: "gridbeta",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-gridbeta-default-s2-dev-scroll-2026-04-10t15-26-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:25:00.000Z",
        scroll_frame_p95_ms: 12.4,
      }),
      createScrollRun({
        adapterId: "gridalpha",
        timestamp: "2026-04-10T15:25:30.000Z",
        scroll_frame_p95_ms: 26.2,
      }),
      createScrollRun({
        adapterId: "gridbeta",
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
      adapterIds: ["pretable", "gridalpha", "gridbeta"],
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

test("createHypothesisReport downgrades H3 when policy notes vary across repeats", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t15-45-00-000z",
    generatedAt: "2026-04-10T15:48:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-45-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 1,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-46-00-000z.summary.json",
      },
      {
        adapterId: "pretable",
        repeatIndex: 2,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t15-47-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:45:00.000Z",
        scroll_frame_p95_ms: 13.1,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:46:00.000Z",
        scroll_frame_p95_ms: 13.2,
      }),
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T15:47:00.000Z",
        scroll_frame_p95_ms: 13.3,
        notes: [
          "contain: none",
          "content visibility: auto",
          "contain intrinsic size: none",
          "scroll anchoring: none",
          "overscroll behavior: contain",
        ],
      }),
    ],
  });

  const h3 = report.hypotheses.find((item) => item.id === "H3");

  assert.equal(h3?.status, "directional");
  assert.match(h3?.summary ?? "", /policy|drift|reproduc/i);
  assert.deepEqual(h3?.evidence[0]?.policyNotes.varying, {
    "content visibility": ["auto", "visible"],
  });
});

test("createHypothesisReport treats backward anchor instability as an H3 failure when direction-specific metrics are present", () => {
  const report = createHypothesisReport({
    runsetId: "2026-04-10t16-00-00-000z",
    generatedAt: "2026-04-10T16:01:00.000Z",
    entries: [
      {
        adapterId: "pretable",
        repeatIndex: 0,
        scenarioId: "S2",
        scriptName: "scroll",
        summaryPath:
          "status/chromium-pretable-default-s2-dev-scroll-2026-04-10t16-00-00-000z.summary.json",
      },
    ],
    runs: [
      createScrollRun({
        adapterId: "pretable",
        timestamp: "2026-04-10T16:00:00.000Z",
        scroll_anchor_shift_px: undefined,
        scroll_anchor_shift_backward_p95_px: 32,
        scroll_anchor_shift_forward_p95_px: 0,
      }),
    ],
  });

  const h3 = report.hypotheses.find((item) => item.id === "H3");

  assert.equal(h3?.status, "failing");
  assert.equal(
    h3?.evidence[0]?.metrics.scroll_anchor_shift_backward_p95_px,
    32,
  );
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
