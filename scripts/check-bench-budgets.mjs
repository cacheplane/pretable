#!/usr/bin/env node
// Asserts the §11 CLIENT budgets against bench artifacts.
//
//   node scripts/check-bench-budgets.mjs [status]
//
// Reads every *.summary.json in the directory, picks the newest run of each budgeted
// script, and reports it against its approved ceiling. Exits 1 on any miss.
//
// The directory is the repo-root `status/`, where apps/bench/tests/bench.spec.ts
// writes: it resolves its output against `process.cwd()`, and playwright runs from
// the repo root.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The run identity the §11 ceilings were measured against, and the only one this
 * gate judges.
 *
 * A ceiling means nothing apart from the combo that produced it: `wrapped` changes
 * the row-height work, a different scenario changes the column shapes, and a
 * comparator adapter is not what §11 budgets at all. Without this filter the newest
 * run of ANY combo wins the slot — a newer ag-grid/S5/smoke/wrapped replace would be
 * measured against pretable's ceiling and reported as pretable's verdict.
 *
 * `scale` is pinned even though the two scripts do scale-independent work — the
 * window is a fixed 200 rows and the cap a fixed 1 000 regardless of dataset size.
 * It is pinned because the smaller scales cannot express the scripts at all:
 * `createBenchDataUpdatePlan` needs 1 200 rows, so a `smoke` run reports
 * `unsupported`, and an unsupported newest run is a failure below. Scoping it out
 * of the gate is the honest treatment of a combo that was never measurable.
 */
export const CLIENT_BUDGET_RUN = {
  adapterId: "pretable",
  profile: "default",
  scenarioId: "S1",
  scale: "dev",
};

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

export function describeBudgetRun() {
  const { adapterId, profile, scenarioId, scale } = CLIENT_BUDGET_RUN;
  return `${adapterId}/${profile}/${scenarioId}/${scale}`;
}

export function checkClientBudgets(summaries) {
  const newest = newestBudgetedRun(summaries);
  const rows = [];
  // Iterating the budget table, not the summaries, is what makes an ABSENT script a
  // failure: a gate for two ceilings that goes green having checked one has the same
  // hole as a metric checked against an absent number. It also fixes the row order,
  // which is otherwise whatever `readdir` returned.
  for (const [scriptName, budget] of Object.entries(CLIENT_BUDGETS)) {
    const summary = newest.get(scriptName);
    if (!summary) {
      rows.push({
        scriptName,
        status: undefined,
        metrics: {},
        failures: [`no ${describeBudgetRun()} run on disk`],
      });
      continue;
    }
    const failures = [];
    // The newest run is judged whatever its status. An `unsupported` or `failed`
    // newest run carries no metrics, and dropping it in favour of the last run that
    // did produce numbers reports a stale pass under a fresh run's name — the run
    // that blew up disappears from the report entirely.
    if (summary.status !== "completed") {
      failures.push(`newest run is ${summary.status ?? "status-less"}`);
    }
    for (const [metricId, ceiling] of Object.entries(budget)) {
      if (ceiling === null) continue;
      const value = summary.metrics?.[metricId];
      // Finiteness, not presence. Every metric is a subtraction somewhere upstream,
      // `JSON.stringify` writes NaN as `null`, and both `null > 20` and `NaN > 20`
      // are false — so an absence guard alone lets a broken number clear every
      // ceiling. A metric the run never emitted is a FAILURE, not a skip: a budget
      // checked against an absent number is the same as no budget at all.
      if (!Number.isFinite(value)) {
        failures.push(
          `${metricId} ${value === undefined ? "missing" : String(value)}`,
        );
        continue;
      }
      if (value > ceiling) {
        failures.push(`${metricId} ${value} > ${ceiling}`);
      }
    }
    rows.push({
      scriptName,
      status: summary.status,
      metrics: summary.metrics ?? {},
      failures,
    });
  }
  return { rows, ok: rows.every((row) => row.failures.length === 0) };
}

/**
 * The newest run of each budgeted script WITHIN `CLIENT_BUDGET_RUN`, by script name.
 *
 * Artifact stems carry a timestamp, so `status/` accumulates every run ever made
 * rather than overwriting. Judging all of them would make the gate a function of
 * whatever junk is on the developer's disk, and one bad run from an hour ago could
 * never be made to pass. The newest run is the one that describes the code as it
 * stands — including when it did not complete, which the caller turns into a
 * failure rather than a silent fallback to an older run.
 */
function newestBudgetedRun(summaries) {
  const newest = new Map();
  for (const summary of summaries) {
    if (!Object.hasOwn(CLIENT_BUDGETS, summary.scriptName)) continue;
    if (
      Object.entries(CLIENT_BUDGET_RUN).some(
        ([field, value]) => summary[field] !== value,
      )
    ) {
      continue;
    }
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
  return newest;
}

function formatMetric(value, width) {
  const text = Number.isFinite(value)
    ? value.toFixed(2)
    : value === undefined
      ? "-"
      : String(value);
  return text.padStart(width);
}

async function run() {
  const dir = process.argv[2] ?? "status";
  const names = await readdir(dir).catch(() => []);
  const summaries = [];
  for (const name of names) {
    if (!name.endsWith(".summary.json")) continue;
    const file = path.join(dir, name);
    const text = await readFile(file, "utf8");
    try {
      summaries.push(JSON.parse(text));
    } catch (err) {
      // A run killed mid-write leaves a truncated artifact. Naming it beats a bare
      // SyntaxError stack, which says nothing about which of 50 files to delete.
      console.error(`Cannot parse ${file}: ${err.message}`);
      process.exit(1);
    }
  }
  const report = checkClientBudgets(summaries);
  const absent = report.rows.filter((row) => row.status === undefined);
  if (absent.length > 0) {
    console.error(
      `No ${describeBudgetRun()} ${absent.map((row) => row.scriptName).join("/")} summary in ${dir}. Run the bench first:\n` +
        absent
          .map(
            (row) => `  PRETABLE_BENCH_SCRIPT=${row.scriptName} pnpm bench:e2e`,
          )
          .join("\n"),
    );
  }
  for (const row of report.rows) {
    const verdict =
      row.failures.length === 0 ? "pass" : `FAIL (${row.failures.join("; ")})`;
    if (row.status === undefined) {
      console.log(`${row.scriptName.padEnd(8)} ${verdict}`);
      continue;
    }
    console.log(
      `${row.scriptName.padEnd(8)} latency ${formatMetric(row.metrics.interaction_latency_ms, 8)} ms  ` +
        `drift ${formatMetric(row.metrics.scroll_position_drift_px, 6)} px  ` +
        `rebuilt ${row.metrics.grid_instance_reconstructed ?? "-"}  ${verdict}`,
    );
  }
  if (!report.ok) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run();
}
