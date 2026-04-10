import test from "node:test";
import assert from "node:assert/strict";

import {
  createBenchRunsetManifest,
  createBenchMatrixEntries,
  parseBenchMatrixArgs,
} from "../bench-matrix.mjs";

test("parseBenchMatrixArgs defaults to the runnable P0a scenario and script matrix", () => {
  assert.deepEqual(parseBenchMatrixArgs([]), {
    scenarios: ["S1", "S2"],
    scripts: ["initial", "scroll"],
    passthroughArgs: [],
  });
});

test("parseBenchMatrixArgs accepts explicit scenario, script, and playwright passthrough args", () => {
  assert.deepEqual(
    parseBenchMatrixArgs([
      "--scenarios=S2",
      "--scripts=scroll",
      "--project=chromium",
    ]),
    {
      scenarios: ["S2"],
      scripts: ["scroll"],
      passthroughArgs: ["--project=chromium"],
    },
  );
});

test("createBenchMatrixEntries expands scenarios and scripts in stable order", () => {
  assert.deepEqual(
    createBenchMatrixEntries({
      scenarios: ["S1", "S2"],
      scripts: ["initial", "scroll"],
      passthroughArgs: [],
    }),
    [
      { scenarioId: "S1", scriptName: "initial" },
      { scenarioId: "S1", scriptName: "scroll" },
      { scenarioId: "S2", scriptName: "initial" },
      { scenarioId: "S2", scriptName: "scroll" },
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
          scenarioId: "S1",
          scriptName: "initial",
          summaryPath:
            "status/chromium-pretable-default-s1-initial-2026-04-10t14-00-00-000z.summary.json",
        },
      ],
    },
  );
});
