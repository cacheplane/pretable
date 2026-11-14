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
    calibration: calibrationFixture(),
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
        calibration: calibrationFixture(),
      }),
    /missing/i,
  );
  assert.throws(
    () =>
      validateRowModelGateSummaries(
        passingSummaries().map((summary, index) =>
          index === 3 ? { ...summary, browserVersion: "different" } : summary,
        ),
        { seed: 91_337, startedAt, calibration: calibrationFixture() },
      ),
    /comparable/i,
  );
  assert.throws(
    () =>
      validateRowModelGateSummaries(
        passingSummaries().map((summary, index) =>
          index === 0 ? { ...summary, status: "partial" } : summary,
        ),
        { seed: 91_337, startedAt, calibration: calibrationFixture() },
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
        { seed: 91_337, startedAt, calibration: calibrationFixture() },
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
        { seed: 91_337, startedAt, calibration: calibrationFixture() },
      ),
    /adapter/i,
  );
});

test("enforces commit and grouped frame/rebuild gates", () => {
  const mutations = [
    ["row_model_commit_p95_ms", 8.01],
    ["scroll_frame_p95_ms", 17.01],
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
          calibration: calibrationFixture(),
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
        calibration: calibrationFixture(),
      }),
    /responsive|checksum|patch/i,
  );
});

function calibrationFixture(interval = 1000 / 60, overrides = {}) {
  return {
    timestamp: "2026-08-11T18:00:10.000Z",
    browserName: "chromium",
    browserVersion: "140.0.0",
    profile: "default",
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    intervalsMs: Array.from(
      { length: 120 },
      (_, i) => interval + (i % 2 ? 0.05 : -0.05),
    ),
    ...overrides,
  };
}

function validateWithCadence(calibration, interval = 16.7) {
  const summaries = passingSummaries();
  for (const summary of summaries)
    summary.metrics.scroll_frame_p95_ms = interval;
  return validateRowModelGateSummaries(summaries, {
    seed: 91_337,
    startedAt,
    calibration,
  });
}

test("uses independent 60/120 Hz calibration plus quantization allowance", () => {
  for (const interval of [1000 / 60, 1000 / 120]) {
    const calibration = calibrationFixture(interval);
    const report = validateWithCadence(calibration, interval + 0.2);
    assert.equal(report.frameCadence.budgetMs, interval + 0.25);
    assert.deepEqual(report.frameCadence.calibration, calibration);
    assert.throws(
      () => validateWithCadence(calibration, interval * 2),
      /scroll_frame_p95_ms/,
    );
  }
});

test("requires eligible independent calibration evidence", () => {
  for (const calibration of [
    undefined,
    calibrationFixture(1000 / 30),
    calibrationFixture(3),
    calibrationFixture(16.7, { intervalsMs: Array(120) }),
    calibrationFixture(16.7, { intervalsMs: Array(119).fill(16.7) }),
    ...[NaN, Infinity, 0, -1].map((value) =>
      calibrationFixture(16.7, {
        intervalsMs: [value, ...Array(119).fill(16.7)],
      }),
    ),
    calibrationFixture(16.7, {
      intervalsMs: Array.from({ length: 120 }, (_, i) => (i % 2 ? 16 : 17)),
    }),
  ])
    assert.throws(() => validateWithCadence(calibration, 12), /calibration/i);
});

test("rejects stale, future, and mismatched calibration provenance", () => {
  for (const overrides of [
    { timestamp: "2026-08-11T17:59:59.000Z" },
    { timestamp: "2026-08-11T18:02:00.000Z" },
    { timestamp: "invalid" },
    { browserVersion: "different" },
    { browserVersion: "" },
    { browserName: "firefox" },
    { profile: "cpu-throttled" },
    { viewport: { width: 1280, height: 720 } },
    { deviceScaleFactor: 2 },
  ])
    assert.throws(
      () => validateWithCadence(calibrationFixture(16.7, overrides), 12),
      /calibration/i,
    );
});

test("rejects all nonfinite processing and frame metrics", () => {
  for (const metric of [
    "row_model_commit_p95_ms",
    "rebuild_slice_max_ms",
    "scroll_frame_p95_ms",
  ]) {
    for (const value of [NaN, Infinity, -Infinity]) {
      const summaries = passingSummaries();
      summaries[1].metrics[metric] = value;
      assert.throws(
        () =>
          validateRowModelGateSummaries(summaries, {
            seed: 91_337,
            startedAt,
            calibration: calibrationFixture(),
          }),
        new RegExp(metric),
      );
    }
  }
});

test("isolated dropped calibration frames do not change the median budget", () => {
  const calibration = calibrationFixture();
  calibration.intervalsMs[0] = 1000 / 30;
  assert.ok(validateWithCadence(calibration).frameCadence.budgetMs < 17);
});

test("preserves independent responsive rebuild and deterministic checksum checks", () => {
  const mutations = [
    (rowModel) => {
      rowModel.finalChecksum = "incorrect";
    },
    (rowModel) => {
      rowModel.acceptedPatchCount = 2999;
    },
    (rowModel) => {
      rowModel.rebuild.responsive = false;
    },
    (rowModel) => {
      rowModel.rebuild.streamCommitsObserved = 0;
    },
    (rowModel) => {
      rowModel.rebuild.sourceRowCountAfter = 1;
    },
    (rowModel) => {
      rowModel.rebuild.groupCountAfter = 1;
    },
  ];
  for (const mutate of mutations) {
    const summaries = passingSummaries();
    mutate(summaries[1].rowModel);
    assert.throws(
      () =>
        validateRowModelGateSummaries(summaries, {
          seed: 91_337,
          startedAt,
          calibration: calibrationFixture(),
        }),
      /checksum|patch|responsive|row count|group count/i,
    );
  }
});
