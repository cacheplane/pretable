import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_BUDGETS, checkClientBudgets } from "../check-bench-budgets.mjs";

test("passes a run inside every ceiling", () => {
  const report = checkClientBudgets([
    {
      scriptName: "replace",
      status: "completed",
      metrics: {
        interaction_latency_ms: 12,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    },
    {
      scriptName: "append",
      status: "completed",
      metrics: {
        interaction_latency_ms: 21,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    },
  ]);
  assert.equal(report.ok, true);
  assert.equal(report.rows.length, 2);
});

test("fails an append that moved the scroll offset, even inside the time budget", () => {
  const report = checkClientBudgets([
    {
      scriptName: "append",
      status: "completed",
      metrics: {
        interaction_latency_ms: 5,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 3,
      },
    },
  ]);
  assert.equal(report.ok, false);
  assert.match(report.rows[0].failures.join(" "), /scroll_position_drift_px/);
});

test("fails a replace that rebuilt the grid", () => {
  const report = checkClientBudgets([
    {
      scriptName: "replace",
      status: "completed",
      metrics: {
        interaction_latency_ms: 5,
        grid_instance_reconstructed: 1,
        scroll_position_drift_px: 0,
      },
    },
  ]);
  assert.equal(report.ok, false);
  assert.match(
    report.rows[0].failures.join(" "),
    /grid_instance_reconstructed/,
  );
});

test("ignores runs of other scripts entirely", () => {
  const report = checkClientBudgets([
    { scriptName: "scroll", status: "completed", metrics: {} },
  ]);
  assert.equal(report.rows.length, 0);
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
    {
      scriptName: "replace",
      status: "completed",
      timestamp: "2026-08-11T15:00:00.000Z",
      metrics: {
        interaction_latency_ms: 900,
        grid_instance_reconstructed: 1,
        scroll_position_drift_px: 0,
      },
    },
    {
      scriptName: "replace",
      status: "completed",
      timestamp: "2026-08-11T15:42:49.105Z",
      metrics: {
        interaction_latency_ms: 8.9,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    },
  ]);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].metrics.interaction_latency_ms, 8.9);
  assert.equal(report.ok, true);
});

test("reads the newest run by timestamp, not by position in the directory listing", () => {
  const report = checkClientBudgets([
    {
      scriptName: "append",
      status: "completed",
      timestamp: "2026-08-11T15:43:09.119Z",
      metrics: {
        interaction_latency_ms: 8.9,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    },
    {
      scriptName: "append",
      status: "completed",
      timestamp: "2026-08-11T14:29:51.164Z",
      metrics: {
        interaction_latency_ms: 900,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    },
  ]);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].metrics.interaction_latency_ms, 8.9);
});

test("an unsupported newest run does not let an older completed run stand in for it", () => {
  // `unsupported` means the combo was never measured. Falling back to the last run
  // that did produce numbers would report a stale pass under a fresh run's name.
  const report = checkClientBudgets([
    {
      scriptName: "replace",
      status: "completed",
      timestamp: "2026-08-11T15:00:00.000Z",
      metrics: {
        interaction_latency_ms: 8.9,
        grid_instance_reconstructed: 0,
        scroll_position_drift_px: 0,
      },
    },
    {
      scriptName: "replace",
      status: "unsupported",
      timestamp: "2026-08-11T15:47:54.271Z",
    },
  ]);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].metrics.interaction_latency_ms, 8.9);
});
