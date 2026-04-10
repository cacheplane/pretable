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
    adapters: ["pretable", "gridalpha"],
    scenarios: ["S1", "S2"],
    scripts: ["initial", "scroll"],
    passthroughArgs: [],
  });
});

test("parseBenchMatrixArgs accepts explicit adapter, scenario, script, and playwright passthrough args", () => {
  assert.deepEqual(
    parseBenchMatrixArgs([
      "--adapters=gridalpha",
      "--scenarios=S2",
      "--scripts=scroll",
      "--project=chromium",
    ]),
    {
      adapters: ["gridalpha"],
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
      scenarios: ["S1", "S2"],
      scripts: ["initial", "scroll"],
      passthroughArgs: [],
    }),
    [
      { adapterId: "pretable", scenarioId: "S1", scriptName: "initial" },
      { adapterId: "pretable", scenarioId: "S1", scriptName: "scroll" },
      { adapterId: "pretable", scenarioId: "S2", scriptName: "initial" },
      { adapterId: "pretable", scenarioId: "S2", scriptName: "scroll" },
      { adapterId: "gridalpha", scenarioId: "S1", scriptName: "initial" },
      { adapterId: "gridalpha", scenarioId: "S1", scriptName: "scroll" },
      { adapterId: "gridalpha", scenarioId: "S2", scriptName: "initial" },
      { adapterId: "gridalpha", scenarioId: "S2", scriptName: "scroll" },
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
