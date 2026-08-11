#!/usr/bin/env node
// Asserts the §11 CLIENT budgets against bench artifacts.
//
//   node scripts/check-bench-budgets.mjs [status]
//
// Reads every *.summary.json in the directory, keeps the newest completed replace and
// append run, and reports each against its approved ceiling. Exits 1 on any miss.
//
// The directory is the repo-root `status/`, where apps/bench/tests/bench.spec.ts
// writes: it resolves its output against `process.cwd()`, and playwright runs from
// the repo root.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Design §11, "Client: replace" and "Client: append". Both are PROPOSED ceilings —
 *  the first measurement against them is the run that produced these artifacts.
 *
 *  `null` means the budget states no ceiling for that metric, NOT that any value
 *  passes: §11 asks replace for "no grid reconstruction" and says nothing about its
 *  scroll offset, while append's "zero scroll movement" is a hard 0. The append
 *  clause "heights cache hit for unchanged rows" has no metric id yet and so is
 *  unchecked here — absence from this table is not a pass. */
export const CLIENT_BUDGETS = {
  replace: {
    interaction_latency_ms: 20,
    grid_instance_reconstructed: 0,
    scroll_position_drift_px: null,
  },
  append: {
    interaction_latency_ms: 30,
    grid_instance_reconstructed: 0,
    scroll_position_drift_px: 0,
  },
};

export function checkClientBudgets(summaries) {
  const rows = [];
  for (const summary of newestPerScript(summaries)) {
    const budget = CLIENT_BUDGETS[summary.scriptName];
    const failures = [];
    for (const [metricId, ceiling] of Object.entries(budget)) {
      if (ceiling === null) continue;
      const value = summary.metrics?.[metricId];
      // A metric the run never emitted is a FAILURE, not a skip: a budget checked
      // against an absent number is the same as no budget at all.
      if (value === undefined) {
        failures.push(`${metricId} missing`);
        continue;
      }
      if (value > ceiling) {
        failures.push(`${metricId} ${value} > ${ceiling}`);
      }
    }
    rows.push({
      scriptName: summary.scriptName,
      metrics: summary.metrics,
      failures,
    });
  }
  return { rows, ok: rows.every((row) => row.failures.length === 0) };
}

/**
 * The newest COMPLETED run of each budgeted script, newest last.
 *
 * Artifact stems carry a timestamp, so `status/` accumulates every run ever made
 * rather than overwriting. Judging all of them would make the gate a function of
 * whatever junk is on the developer's disk, and one bad run from an hour ago could
 * never be made to pass. The newest run is the one that describes the code as it
 * stands. `unsupported` and `failed` runs are dropped rather than treated as newest:
 * they carry no metrics, and letting one shadow an older completed run would report
 * a stale pass under a fresh run's name.
 */
function newestPerScript(summaries) {
  const newest = new Map();
  for (const summary of summaries) {
    if (!Object.hasOwn(CLIENT_BUDGETS, summary.scriptName)) continue;
    if (summary.status !== "completed") continue;
    const previous = newest.get(summary.scriptName);
    // Timestamps are ISO-8601 and so sort lexicographically. Skipping only on a
    // STRICTLY older candidate keeps the last occurrence when they tie or are
    // absent, matching directory order.
    if (
      previous &&
      `${previous.timestamp ?? ""}` > `${summary.timestamp ?? ""}`
    ) {
      continue;
    }
    newest.set(summary.scriptName, summary);
  }
  return [...newest.values()];
}

async function run() {
  const dir = process.argv[2] ?? "status";
  const names = await readdir(dir).catch(() => []);
  const summaries = [];
  for (const name of names) {
    if (!name.endsWith(".summary.json")) continue;
    summaries.push(JSON.parse(await readFile(path.join(dir, name), "utf8")));
  }
  const report = checkClientBudgets(summaries);
  if (report.rows.length === 0) {
    console.error(
      `No replace/append summaries found in ${dir}. Run the bench first.`,
    );
    process.exit(1);
  }
  for (const row of report.rows) {
    const verdict =
      row.failures.length === 0 ? "pass" : `FAIL (${row.failures.join("; ")})`;
    console.log(
      `${row.scriptName.padEnd(8)} latency ${String(row.metrics.interaction_latency_ms).padStart(8)} ms  ` +
        `drift ${String(row.metrics.scroll_position_drift_px).padStart(4)} px  ` +
        `rebuilt ${row.metrics.grid_instance_reconstructed}  ${verdict}`,
    );
  }
  if (!report.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run();
}
