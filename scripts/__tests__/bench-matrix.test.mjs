import test from "node:test";
import assert from "node:assert/strict";

import {
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
          summaryPath: "status/chromium-pretable-default-s1-initial-2026-04-10t14-00-00-000z.summary.json",
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
        tracePath: "status/traces/chromium-pretable-default-s1-initial.trace.zip",
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
        tracePath: "status/traces/chromium-pretable-default-s2-scroll.trace.zip",
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

  assert.equal(report.hypotheses.find((item) => item.id === "H1")?.status, "satisfied");
  assert.match(
    report.hypotheses.find((item) => item.id === "H1")?.summary ?? "",
    /25%|relative/i,
  );
  assert.equal(report.hypotheses.find((item) => item.id === "H3")?.status, "insufficient");
  assert.equal(report.hypotheses.find((item) => item.id === "H5")?.status, "satisfied");
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
  assert.equal(h1?.evidence[0]?.sampleCount, 3);
  assert.equal(h1?.evidence[0]?.metrics.scroll_frame_p95_ms, 13.1);
  assert.equal(h1?.evidence[1]?.sampleCount, 3);
  assert.equal(h1?.evidence[1]?.metrics.scroll_frame_p95_ms, 28.4);
});

function createScrollRun({
  adapterId,
  timestamp,
  scroll_frame_p95_ms,
  row_height_error_p95_px = 0,
  scroll_anchor_shift_px = 0,
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
    notes: [],
    status: "completed",
    tracePath: `status/traces/chromium-${adapterId}-default-s2-scroll.trace.zip`,
    metrics: {
      scroll_frame_p95_ms,
      blank_gap_frames: 0,
      long_tasks_count: 0,
      long_tasks_ms: 0,
      dom_nodes_peak: adapterId === "pretable" ? 1823 : 657,
      row_height_error_p95_px,
      scroll_anchor_shift_px,
    },
  };
}
