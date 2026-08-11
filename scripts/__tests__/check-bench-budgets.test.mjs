import assert from "node:assert/strict";
import test from "node:test";
import {
  CLIENT_BUDGETS,
  CLIENT_BUDGET_RUN,
  checkClientBudgets,
} from "../check-bench-budgets.mjs";

/** Every summary the checker judges must carry the budgeted run identity; spelling it
 *  out in each fixture would bury the field under test. */
const run = (summary) => ({ ...CLIENT_BUDGET_RUN, ...summary });
const row = (report, scriptName) =>
  report.rows.find((candidate) => candidate.scriptName === scriptName);

const passingReplace = run({
  scriptName: "replace",
  status: "completed",
  timestamp: "2026-08-11T15:00:00.000Z",
  metrics: {
    interaction_latency_ms: 12,
    grid_instance_reconstructed: 0,
    scroll_position_drift_px: 0,
  },
});
const passingAppend = run({
  scriptName: "append",
  status: "completed",
  timestamp: "2026-08-11T15:00:00.000Z",
  metrics: {
    interaction_latency_ms: 21,
    grid_instance_reconstructed: 0,
    scroll_position_drift_px: 0,
  },
});

test("passes a run inside every ceiling", () => {
  const report = checkClientBudgets([passingReplace, passingAppend]);
  assert.equal(report.ok, true);
  assert.equal(report.rows.length, 2);
});

test("fails an append that moved the scroll offset, even inside the time budget", () => {
  const report = checkClientBudgets([
    passingReplace,
    run({
      scriptName: "append",
      status: "completed",
      metrics: {
        interaction_latency_ms: 5,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 3,
      },
    }),
  ]);
  assert.equal(report.ok, false);
  assert.match(
    row(report, "append").failures.join(" "),
    /scroll_position_drift_px/,
  );
});

test("fails a replace that rebuilt the grid", () => {
  const report = checkClientBudgets([
    passingAppend,
    run({
      scriptName: "replace",
      status: "completed",
      metrics: {
        interaction_latency_ms: 5,
        grid_instance_reconstructed: 1,
        scroll_position_drift_px: 0,
      },
    }),
  ]);
  assert.equal(report.ok, false);
  assert.match(
    row(report, "replace").failures.join(" "),
    /grid_instance_reconstructed/,
  );
});

test("ignores runs of other scripts entirely", () => {
  const report = checkClientBudgets([
    passingReplace,
    passingAppend,
    run({ scriptName: "scroll", status: "completed", metrics: {} }),
  ]);
  assert.deepEqual(
    report.rows.map((candidate) => candidate.scriptName),
    ["replace", "append"],
  );
  assert.equal(report.ok, true);
});

test("states the approved ceilings so a reviewer can see them without reading code", () => {
  assert.equal(CLIENT_BUDGETS.replace.interaction_latency_ms, 20);
  assert.equal(CLIENT_BUDGETS.append.interaction_latency_ms, 30);
});

test("judges only the newest run of each script", () => {
  // Artifact stems carry a timestamp, so status/ accumulates every run ever made. A
  // gate that judged all of them could never pass once one bad run sat on disk.
  const report = checkClientBudgets([
    passingAppend,
    run({
      scriptName: "replace",
      status: "completed",
      timestamp: "2026-08-11T15:00:00.000Z",
      metrics: {
        interaction_latency_ms: 900,
        grid_instance_reconstructed: 1,
        scroll_position_drift_px: 0,
      },
    }),
    run({
      scriptName: "replace",
      status: "completed",
      timestamp: "2026-08-11T15:42:49.105Z",
      metrics: {
        interaction_latency_ms: 8.9,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    }),
  ]);
  assert.equal(row(report, "replace").metrics.interaction_latency_ms, 8.9);
  assert.equal(report.ok, true);
});

test("reads the newest run by timestamp, not by position in the directory listing", () => {
  const report = checkClientBudgets([
    passingReplace,
    run({
      scriptName: "append",
      status: "completed",
      timestamp: "2026-08-11T15:43:09.119Z",
      metrics: {
        interaction_latency_ms: 8.9,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    }),
    run({
      scriptName: "append",
      status: "completed",
      timestamp: "2026-08-11T14:29:51.164Z",
      metrics: {
        interaction_latency_ms: 900,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    }),
  ]);
  assert.equal(row(report, "append").metrics.interaction_latency_ms, 8.9);
  assert.equal(report.ok, true);
});

test("fails an unsupported newest run instead of letting an older completed run stand in", () => {
  // Falling back to the last run that did produce numbers reports a stale pass under
  // a fresh run's name, and the run that did not measure vanishes from the report.
  const report = checkClientBudgets([
    passingAppend,
    run({
      scriptName: "replace",
      status: "completed",
      timestamp: "2026-08-11T15:00:00.000Z",
      metrics: {
        interaction_latency_ms: 8.9,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    }),
    run({
      scriptName: "replace",
      status: "unsupported",
      timestamp: "2026-08-11T15:47:54.271Z",
    }),
  ]);
  assert.equal(report.ok, false);
  assert.match(
    row(report, "replace").failures.join(" "),
    /newest run is unsupported/,
  );
});

test("fails a failed newest run rather than reporting the last run that worked", () => {
  // apps/bench/src/bench-app.tsx catches the runner's throw and publishes
  // status: "failed", and bench.spec.ts writes that summary to status/ before it
  // asserts the run completed — so a broken run leaves a fresh artifact on disk.
  const report = checkClientBudgets([
    passingAppend,
    run({
      scriptName: "replace",
      status: "completed",
      timestamp: "2026-08-11T16:05:09.094Z",
      metrics: {
        interaction_latency_ms: 8.3,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    }),
    run({
      scriptName: "replace",
      status: "failed",
      timestamp: "2026-08-11T23:59:00.000Z",
    }),
  ]);
  assert.equal(report.ok, false);
  assert.match(
    row(report, "replace").failures.join(" "),
    /newest run is failed/,
  );
});

test("fails when a budgeted script has no run at all", () => {
  // Half a measurement is not a verdict: §11 states two client ceilings, and a gate
  // that goes green having checked one of them is the absent-metric hole one level up.
  const report = checkClientBudgets([passingReplace]);
  assert.equal(report.ok, false);
  assert.equal(row(report, "replace").failures.length, 0);
  assert.match(row(report, "append").failures.join(" "), /no .* run on disk/);
});

test("fails an empty directory rather than reporting nothing", () => {
  const report = checkClientBudgets([]);
  assert.equal(report.ok, false);
  assert.equal(report.rows.length, 2);
});

test("judges only the combo the ceilings were measured against", () => {
  // A newer run of another adapter, profile, scenario or scale must not win the slot:
  // the ceiling means nothing apart from the combo that produced it.
  for (const field of Object.keys(CLIENT_BUDGET_RUN)) {
    const report = checkClientBudgets([
      passingAppend,
      passingReplace,
      run({
        scriptName: "replace",
        status: "completed",
        timestamp: "2026-08-11T23:59:00.000Z",
        [field]: "other",
        metrics: {
          interaction_latency_ms: 19,
          grid_instance_reconstructed: 0,
          scroll_position_drift_px: 0,
        },
      }),
    ]);
    assert.equal(
      row(report, "replace").metrics.interaction_latency_ms,
      12,
      `a foreign ${field} displaced the budgeted run`,
    );
  }
});

test("fails a metric that is present but not a finite number", () => {
  // JSON.stringify writes NaN as null, and both `null > 20` and `NaN > 20` are false,
  // so an absence-only guard lets a broken number clear every ceiling.
  for (const value of [null, Number.NaN, Number.POSITIVE_INFINITY, "8.3"]) {
    const report = checkClientBudgets([
      passingAppend,
      run({
        scriptName: "replace",
        status: "completed",
        metrics: {
          interaction_latency_ms: value,
          grid_instance_reconstructed: 0,
          scroll_position_drift_px: 0,
        },
      }),
    ]);
    assert.equal(report.ok, false, `${String(value)} cleared the ceiling`);
    assert.match(
      row(report, "replace").failures.join(" "),
      /interaction_latency_ms/,
    );
  }
});

test("fails a completed run that emitted no metrics object", () => {
  const report = checkClientBudgets([
    passingAppend,
    run({ scriptName: "replace", status: "completed" }),
  ]);
  assert.equal(report.ok, false);
  assert.match(
    row(report, "replace").failures.join(" "),
    /interaction_latency_ms missing/,
  );
});
