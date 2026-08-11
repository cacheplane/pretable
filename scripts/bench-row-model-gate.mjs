import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createBenchPreviewLaunch } from "./bench-matrix.mjs";

const BASE_URL = "http://127.0.0.1:4173";
const DEFAULT_SEED = 505;
const EXPECTED_PATCHES = 3_000;

export function createRowModelGateEntries({ seed = DEFAULT_SEED } = {}) {
  return [
    ["target", "updates"],
    ["target", "updates-grouped"],
    ["local-max", "updates"],
    ["local-max", "updates-grouped"],
  ].map(([scale, scriptName]) => ({
    adapterId: "pretable",
    scenarioId: "S5",
    scale,
    scriptName,
    seed,
    diagnostics: "row-model",
    updateRatePerSec: 1_000,
  }));
}

export function validateRowModelGateSummaries(
  summaries,
  { seed = DEFAULT_SEED, startedAt },
) {
  if (!Array.isArray(summaries)) throw new TypeError("Summaries are required.");
  const expectedEntries = createRowModelGateEntries({ seed });
  const byKey = new Map();
  for (const summary of summaries) {
    const key = `${summary?.scale}/${summary?.scriptName}`;
    if (byKey.has(key)) throw new Error(`Duplicate row-model summary: ${key}`);
    byKey.set(key, summary);
  }
  const selected = expectedEntries.map((entry) => {
    const key = `${entry.scale}/${entry.scriptName}`;
    const summary = byKey.get(key);
    if (summary === undefined)
      throw new Error(`Missing row-model summary: ${key}`);
    return summary;
  });
  if (summaries.length !== selected.length) {
    throw new Error(
      "Unexpected row-model summaries make the gate incomparable.",
    );
  }

  const comparableKeys = [
    "adapterId",
    "scenarioId",
    "profile",
    "browserName",
    "browserVersion",
    "viewport",
    "fontStack",
    "deviceScaleFactor",
    "seed",
  ];
  const baseline = selected[0];
  for (const summary of selected) {
    if (summary.adapterId !== "pretable") {
      throw new Error("Permanent row-model gate requires adapter pretable.");
    }
    if (summary.scenarioId !== "S5") {
      throw new Error("Permanent row-model gate requires scenario S5.");
    }
    if (summary.profile !== "default" || summary.browserName !== "chromium") {
      throw new Error(
        "Permanent row-model gate requires the default Chromium profile.",
      );
    }
    if (summary.status !== "completed") {
      throw new Error(
        `${summary.scale}/${summary.scriptName} is not completed.`,
      );
    }
    if (
      typeof summary.timestamp !== "string" ||
      !Number.isFinite(Date.parse(summary.timestamp)) ||
      (startedAt && Date.parse(summary.timestamp) < Date.parse(startedAt))
    ) {
      throw new Error(`${summary.scale}/${summary.scriptName} is stale.`);
    }
    if (summary.seed !== seed) {
      throw new Error(
        `${summary.scale}/${summary.scriptName} used the wrong seed.`,
      );
    }
    if (
      typeof summary.tracePath !== "string" ||
      summary.tracePath.length === 0
    ) {
      throw new Error(
        `${summary.scale}/${summary.scriptName} is missing its trace.`,
      );
    }
    for (const key of comparableKeys) {
      if (JSON.stringify(summary[key]) !== JSON.stringify(baseline[key])) {
        throw new Error(`Summaries are not comparable: ${key} differs.`);
      }
    }
    const expectedRows = summary.scale === "target" ? 20_000 : 100_000;
    if (summary.rowCount !== expectedRows) {
      throw new Error(`${summary.scale} rowCount must be ${expectedRows}.`);
    }
    assertAtMost(summary, "row_model_commit_p95_ms", 8);
    const rowModel = summary.rowModel;
    if (rowModel?.diagnostics !== true) {
      throw new Error(
        `${summary.scale}/${summary.scriptName} lacks diagnostics.`,
      );
    }
    if (
      rowModel.acceptedPatchCount !== EXPECTED_PATCHES ||
      rowModel.checksumAcceptedPatchCount !== EXPECTED_PATCHES
    ) {
      throw new Error("The final checksum must include every accepted patch.");
    }
    if (rowModel.finalChecksum !== rowModel.expectedFinalChecksum) {
      throw new Error(
        "The final deterministic checksum omitted catch-up work.",
      );
    }
  }

  for (const scale of ["target", "local-max"]) {
    const scaleRuns = selected.filter((summary) => summary.scale === scale);
    const scheduleChecksum = scaleRuns[0].rowModel.updatePlanChecksum;
    if (
      typeof scheduleChecksum !== "string" ||
      scheduleChecksum.length === 0 ||
      scaleRuns.some(
        (summary) => summary.rowModel.updatePlanChecksum !== scheduleChecksum,
      )
    ) {
      throw new Error(
        `Flat and grouped ${scale} jobs did not share one update schedule.`,
      );
    }
  }

  for (const summary of selected.filter(
    (candidate) => candidate.scriptName === "updates-grouped",
  )) {
    assertAtMost(summary, "scroll_frame_p95_ms", 16);
    assertEqual(summary, "long_tasks_count", 0);
    assertEqual(summary, "scroll_position_drift_px", 0);
    assertEqual(summary, "visible_row_count_drift", 0);
    assertAtMost(summary, "rebuild_slice_max_ms", 8);
    const rebuild = summary.rowModel.rebuild;
    if (rebuild?.completed !== true)
      throw new Error("rebuild_completed must be true.");
    const observedResponsiveWork =
      rebuild.durationMs <= 50 ||
      (rebuild.streamCommitsObserved >= 1 &&
        rebuild.interactionSamplesObserved >= 1);
    if (rebuild.responsive !== true || !observedResponsiveWork) {
      throw new Error("rebuild_responsive must be true with observed work.");
    }
    if (rebuild.sourceRowCountBefore !== rebuild.sourceRowCountAfter) {
      throw new Error("The rebuild changed the source row count.");
    }
    if (
      typeof rebuild.expectedGroupCountAfter !== "number" ||
      rebuild.groupCountAfter !== rebuild.expectedGroupCountAfter
    ) {
      throw new Error("The rebuild changed the deterministic group count.");
    }
  }

  return Object.freeze({
    status: "ready-for-performance-gate",
    seed,
    summary:
      "Deterministic harness artifacts are complete; Task 22 evaluates performance claims.",
    runs: Object.freeze(
      selected.map((summary) =>
        Object.freeze({
          scale: summary.scale,
          scriptName: summary.scriptName,
          summaryPath: summary.summaryPath,
          tracePath: summary.tracePath,
        }),
      ),
    ),
  });
}

function assertAtMost(summary, metricId, threshold) {
  const value = summary.metrics?.[metricId];
  if (typeof value !== "number" || value > threshold) {
    throw new Error(
      `${metricId} must be <= ${threshold}; received ${String(value)}.`,
    );
  }
}

function assertEqual(summary, metricId, expected) {
  const value = summary.metrics?.[metricId];
  if (value !== expected) {
    throw new Error(
      `${metricId} must equal ${expected}; received ${String(value)}.`,
    );
  }
}

async function run() {
  const seed = parseSeed(process.argv.slice(2));
  const workspaceDir = process.cwd();
  const launch = createBenchPreviewLaunch(workspaceDir);
  await runCommand(launch.build);
  const server = spawn(launch.preview.command, launch.preview.args, {
    cwd: launch.preview.cwd,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const startedAt = new Date().toISOString();
  const summaries = [];
  try {
    await waitForServer(BASE_URL, server);
    for (const entry of createRowModelGateEntries({ seed })) {
      summaries.push(await runEntry(entry, workspaceDir));
    }
    const report = validateRowModelGateSummaries(summaries, {
      seed,
      startedAt,
    });
    const reportDir = path.join(workspaceDir, "status", "runsets");
    const reportPath = path.join(reportDir, "row-model-gate.json");
    await mkdir(reportDir, { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `row-model gate: ${report.status}; seed=${seed}; runs=${report.runs.length}; report=${path.relative(workspaceDir, reportPath)}\n`,
    );
  } finally {
    server.kill("SIGTERM");
  }
}

async function runEntry(entry, workspaceDir) {
  const statusDir = path.join(workspaceDir, "status");
  const before = new Set(await collectSummaries(statusDir));
  await runCommand({
    command: "pnpm",
    args: ["bench:e2e"],
    cwd: workspaceDir,
    env: {
      ...process.env,
      PRETABLE_BENCH_BASE_URL: BASE_URL,
      PRETABLE_BENCH_EXTERNAL_SERVER: "1",
      PRETABLE_BENCH_ADAPTER: entry.adapterId,
      PRETABLE_BENCH_SCENARIO: entry.scenarioId,
      PRETABLE_BENCH_SCALE: entry.scale,
      PRETABLE_BENCH_SCRIPT: entry.scriptName,
      PRETABLE_BENCH_UPDATE_RATE_PER_SEC: String(entry.updateRatePerSec),
      PRETABLE_BENCH_DIAGNOSTICS: entry.diagnostics,
      PRETABLE_BENCH_SEED: String(entry.seed),
    },
  });
  const next = (await collectSummaries(statusDir)).find(
    (file) => !before.has(file),
  );
  if (next === undefined)
    throw new Error(`Missing summary for ${entry.scale}/${entry.scriptName}.`);
  const parsed = JSON.parse(await readFile(next, "utf8"));
  const tracePath = path.resolve(workspaceDir, parsed.tracePath ?? "");
  if (!parsed.tracePath || !(await stat(tracePath)).isFile()) {
    throw new Error(`Missing trace for ${entry.scale}/${entry.scriptName}.`);
  }
  return { ...parsed, summaryPath: path.relative(workspaceDir, next) };
}

async function collectSummaries(directory) {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".summary.json"))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: command.env ?? process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("exit", (code, signal) => {
      if (signal)
        reject(new Error(`${command.command} exited with signal ${signal}`));
      else if (code === 0) resolve();
      else
        reject(new Error(`${command.command} exited with code ${code ?? 1}`));
    });
  });
}

async function waitForServer(url, server, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error("Benchmark preview exited early.");
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Keep polling until the bounded deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function parseSeed(args) {
  const raw = args.find((arg) => arg.startsWith("--seed="))?.slice(7);
  const parsed = Number(raw ?? DEFAULT_SEED);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError("--seed must be a non-negative safe integer.");
  }
  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
