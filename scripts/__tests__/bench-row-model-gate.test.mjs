import assert from "node:assert/strict";
import test from "node:test";

import {
  createRowModelGateEntries,
  validateRowModelGateSummaries,
} from "../bench-row-model-gate.mjs";

const startedAt = "2026-08-11T18:00:00.000Z";

function fixture(scale, scriptName, overrides = {}) {
  const grouped = scriptName === "updates-grouped";
  return {
    adapterId: "pretable",
    profile: "default",
    scenarioId: "S5",
    scale,
    scriptName,
    browserName: "chromium",
    browserVersion: "140.0.0",
    timestamp: "2026-08-11T18:01:00.000Z",
    seed: 91_337,
    rowCount: scale === "target" ? 20_000 : 100_000,
    viewport: { width: 1440, height: 900 },
    fontStack: '"IBM Plex Sans", system-ui, sans-serif',
    deviceScaleFactor: 1,
    status: "completed",
    tracePath: `status/traces/${scale}-${scriptName}.trace.zip`,
    notes: [],
    metrics: {
      row_model_commit_p95_ms: 4,
      scroll_frame_p95_ms: grouped ? 12 : 14,
      long_tasks_count: 0,
      scroll_position_drift_px: 0,
      visible_row_count_drift: 0,
      rebuild_slice_max_ms: grouped ? 6 : 0,
    },
    rowModel: {
      diagnostics: true,
      updatePlanChecksum: `schedule-${scale}-91337`,
      acceptedPatchCount: 3_000,
      checksumAcceptedPatchCount: 3_000,
      finalChecksum: `final-${scale}-${scriptName}`,
      expectedFinalChecksum: `final-${scale}-${scriptName}`,
      rebuild: grouped
        ? {
            completed: true,
            responsive: true,
            durationMs: 70,
            streamCommitsObserved: 1,
            interactionSamplesObserved: 1,
            sourceRowCountBefore: scale === "target" ? 20_000 : 100_000,
            sourceRowCountAfter: scale === "target" ? 20_000 : 100_000,
            groupCountBefore: 4,
            groupCountAfter: 4,
            expectedGroupCountAfter: 4,
          }
        : null,
    },
    ...overrides,
  };
}

function passingSummaries() {
  return [
    fixture("target", "updates"),
    fixture("target", "updates-grouped"),
    fixture("local-max", "updates"),
    fixture("local-max", "updates-grouped"),
  ];
}

test("creates the permanent flat/grouped target/local-max jobs in serial order", () => {
  assert.deepEqual(createRowModelGateEntries({ seed: 91_337 }), [
    {
      adapterId: "pretable",
      scenarioId: "S5",
      scale: "target",
      scriptName: "updates",
      seed: 91_337,
      diagnostics: "row-model",
      updateRatePerSec: 1_000,
    },
    {
      adapterId: "pretable",
      scenarioId: "S5",
      scale: "target",
      scriptName: "updates-grouped",
      seed: 91_337,
      diagnostics: "row-model",
      updateRatePerSec: 1_000,
    },
    {
      adapterId: "pretable",
      scenarioId: "S5",
      scale: "local-max",
      scriptName: "updates",
      seed: 91_337,
      diagnostics: "row-model",
      updateRatePerSec: 1_000,
    },
    {
      adapterId: "pretable",
      scenarioId: "S5",
      scale: "local-max",
      scriptName: "updates-grouped",
      seed: 91_337,
      diagnostics: "row-model",
      updateRatePerSec: 1_000,
    },
  ]);
});

test("accepts a complete comparable four-run milestone without making a performance claim", () => {
  const report = validateRowModelGateSummaries(passingSummaries(), {
    seed: 91_337,
    startedAt,
  });

  assert.equal(report.status, "ready-for-performance-gate");
  assert.equal(report.runs.length, 4);
  assert.match(report.summary, /deterministic harness/i);
});

test("rejects missing, mismatched, incomplete, and stale summaries", () => {
  assert.throws(
    () =>
      validateRowModelGateSummaries(passingSummaries().slice(0, 3), {
        seed: 91_337,
        startedAt,
      }),
    /missing/i,
  );
  assert.throws(
    () =>
      validateRowModelGateSummaries(
        passingSummaries().map((summary, index) =>
          index === 3 ? { ...summary, browserVersion: "different" } : summary,
        ),
        { seed: 91_337, startedAt },
      ),
    /comparable/i,
  );
  assert.throws(
    () =>
      validateRowModelGateSummaries(
        passingSummaries().map((summary, index) =>
          index === 0 ? { ...summary, status: "partial" } : summary,
        ),
        { seed: 91_337, startedAt },
      ),
    /completed/i,
  );
  assert.throws(
    () =>
      validateRowModelGateSummaries(
        passingSummaries().map((summary, index) =>
          index === 0
            ? { ...summary, timestamp: "2026-08-11T17:59:59.000Z" }
            : summary,
        ),
        { seed: 91_337, startedAt },
      ),
    /stale/i,
  );
});

test("rejects a uniformly wrong permanent-job identity", () => {
  assert.throws(
    () =>
      validateRowModelGateSummaries(
        passingSummaries().map((summary) => ({
          ...summary,
          adapterId: "not-pretable",
        })),
        { seed: 91_337, startedAt },
      ),
    /adapter/i,
  );
});

test("enforces commit and grouped frame/rebuild gates", () => {
  const mutations = [
    ["row_model_commit_p95_ms", 8.01],
    ["scroll_frame_p95_ms", 16.01],
    ["long_tasks_count", 1],
    ["scroll_position_drift_px", 1],
    ["visible_row_count_drift", 1],
    ["rebuild_slice_max_ms", 8.01],
  ];

  for (const [metric, value] of mutations) {
    const summaries = passingSummaries();
    summaries[1] = {
      ...summaries[1],
      metrics: { ...summaries[1].metrics, [metric]: value },
    };
    assert.throws(
      () =>
        validateRowModelGateSummaries(summaries, {
          seed: 91_337,
          startedAt,
        }),
      new RegExp(String(metric)),
    );
  }
});

test("requires a completed responsive rebuild and a checksum containing every catch-up patch", () => {
  const summaries = passingSummaries();
  summaries[1] = {
    ...summaries[1],
    rowModel: {
      ...summaries[1].rowModel,
      checksumAcceptedPatchCount: 2_950,
      finalChecksum: "missing-catch-up",
      rebuild: {
        ...summaries[1].rowModel.rebuild,
        responsive: false,
        streamCommitsObserved: 0,
      },
    },
  };

  assert.throws(
    () =>
      validateRowModelGateSummaries(summaries, {
        seed: 91_337,
        startedAt,
      }),
    /responsive|checksum|patch/i,
  );
});
