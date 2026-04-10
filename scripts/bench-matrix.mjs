import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_ADAPTERS = ["pretable", "ag-grid"];
const DEFAULT_SCENARIOS = ["S1", "S2"];
const DEFAULT_SCRIPTS = ["initial", "scroll"];
const BENCH_BASE_URL = "http://127.0.0.1:4173";

export function parseBenchMatrixArgs(args) {
  const parsed = {
    adapters: DEFAULT_ADAPTERS,
    scenarios: DEFAULT_SCENARIOS,
    scripts: DEFAULT_SCRIPTS,
    passthroughArgs: [],
  };

  for (const arg of args) {
    if (arg.startsWith("--adapters=")) {
      parsed.adapters = splitCsvArg(arg.slice("--adapters=".length));
      continue;
    }

    if (arg.startsWith("--scenarios=")) {
      parsed.scenarios = splitCsvArg(arg.slice("--scenarios=".length));
      continue;
    }

    if (arg.startsWith("--scripts=")) {
      parsed.scripts = splitCsvArg(arg.slice("--scripts=".length));
      continue;
    }

    parsed.passthroughArgs.push(arg);
  }

  return parsed;
}

export function createBenchMatrixEntries(parsedArgs) {
  return parsedArgs.adapters.flatMap((adapterId) =>
    parsedArgs.scenarios.flatMap((scenarioId) =>
      parsedArgs.scripts.map((scriptName) => ({
        adapterId,
        scenarioId,
        scriptName,
      })),
    ),
  );
}

export function createBenchRunsetManifest(input) {
  return {
    runsetId: input.runsetId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    ...(input.reportPath ? { reportPath: input.reportPath } : {}),
    entries: input.entries,
  };
}

export function createHypothesisReport(input) {
  return {
    runsetId: input.runsetId,
    generatedAt: input.generatedAt,
    hypotheses: [
      evaluateH1(input.runs),
      evaluateH3(input.runs),
      evaluateH5(input.entries, input.runs),
    ],
  };
}

async function run() {
  const parsedArgs = parseBenchMatrixArgs(process.argv.slice(2));
  const runsetId = sanitizeTimestamp(new Date().toISOString());
  const server = spawn("pnpm", ["--filter", "@pretable/app-bench", "preview:bench"], {
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const startedAt = new Date().toISOString();
  const runEntries = [];

  try {
    await waitForServer(BENCH_BASE_URL, server);

    for (const entry of createBenchMatrixEntries(parsedArgs)) {
      runEntries.push(await runBenchEntry(entry, parsedArgs.passthroughArgs));
    }

    const runs = await readRunSummaries(runEntries);
    const reportPath = await writeHypothesisReport(
      createHypothesisReport({
        runsetId,
        generatedAt: new Date().toISOString(),
        entries: runEntries,
        runs,
      }),
    );

    await writeRunsetManifest(
      createBenchRunsetManifest({
        runsetId,
        startedAt,
        completedAt: new Date().toISOString(),
        reportPath,
        entries: runEntries,
      }),
    );
  } finally {
    server.kill("SIGTERM");
  }
}

async function runBenchEntry(entry, passthroughArgs) {
  const summariesDir = path.join(process.cwd(), "status");
  const before = new Set(await collectSummaryFiles(summariesDir));

  await spawnBenchRun(entry, passthroughArgs);

  const summaryPath = (await collectSummaryFiles(summariesDir)).find(
    (file) => !before.has(file),
  );

  if (!summaryPath) {
    throw new Error(
      `bench:e2e did not write a summary for ${entry.scenarioId}/${entry.scriptName}`,
    );
  }

  return {
    ...entry,
    summaryPath: path.relative(process.cwd(), summaryPath),
  };
}

function spawnBenchRun(entry, passthroughArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["bench:e2e", ...passthroughArgs], {
      env: {
        ...process.env,
        PRETABLE_BENCH_BASE_URL: BENCH_BASE_URL,
        PRETABLE_BENCH_ADAPTER: entry.adapterId,
        PRETABLE_BENCH_EXTERNAL_SERVER: "1",
        PRETABLE_BENCH_SCENARIO: entry.scenarioId,
        PRETABLE_BENCH_SCRIPT: entry.scriptName,
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`bench:e2e failed for ${entry.scenarioId}/${entry.scriptName}`));
    });
  });
}

function splitCsvArg(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function waitForServer(url, server, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`preview:bench exited early with code ${server.exitCode}`);
    }

    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // Retry until the preview server responds or the timeout elapses.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for preview server at ${url}`);
}

async function collectSummaryFiles(statusDir) {
  const entries = await readdir(statusDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".summary.json"))
    .map((entry) => path.join(statusDir, entry.name))
    .sort();
}

async function readRunSummaries(entries) {
  return Promise.all(
    entries.map(async (entry) => {
      const raw = await readFile(path.join(process.cwd(), entry.summaryPath), "utf8");
      return JSON.parse(raw);
    }),
  );
}

async function writeRunsetManifest(manifest) {
  const manifestsDir = path.join(process.cwd(), "status", "runsets");
  const manifestPath = path.join(manifestsDir, `${manifest.runsetId}.json`);

  await mkdir(manifestsDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeHypothesisReport(report) {
  const reportsDir = path.join(process.cwd(), "status", "runsets");
  const reportPath = path.join(reportsDir, `${report.runsetId}.hypotheses.json`);

  await mkdir(reportsDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  return path.relative(process.cwd(), reportPath);
}

function evaluateH1(runs) {
  const wrappedScrollRun = findLatestRun(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scriptName: "scroll",
  });

  if (!wrappedScrollRun || wrappedScrollRun.status !== "completed") {
    return {
      id: "H1",
      status: "insufficient",
      summary:
        "Missing a completed S2 scroll run, so wrapped-text scroll evidence is not available yet.",
      evidence: wrappedScrollRun ? [summarizeRunEvidence(wrappedScrollRun)] : [],
    };
  }

  const blankGapFrames = wrappedScrollRun.metrics?.blank_gap_frames ?? Number.NaN;
  const longTasksCount = wrappedScrollRun.metrics?.long_tasks_count ?? Number.NaN;
  const competitorRuns = runs.filter(
    (run) =>
      run.scenarioId === "S2" &&
      run.scriptName === "scroll" &&
      run.adapterId !== "pretable" &&
      run.status === "completed" &&
      run.metrics?.scroll_frame_p95_ms !== undefined,
  );

  if (blankGapFrames > 0.09 || longTasksCount > 0) {
    return {
      id: "H1",
      status: "failing",
      summary:
        "The wrapped-text scroll surface is measured, but it still shows blank gaps or long tasks beyond the current benchmark threshold.",
      evidence: [summarizeRunEvidence(wrappedScrollRun)],
    };
  }

  if (competitorRuns.length === 0) {
    return {
      id: "H1",
      status: "directional",
      summary:
        "Wrapped-text scrolling now has direct S2 measurements with no observed blank gaps or long tasks, but the required relative win versus a DOM competitor is still unmeasured.",
      evidence: [summarizeRunEvidence(wrappedScrollRun)],
    };
  }

  const bestCompetitor = competitorRuns.reduce((best, current) =>
    current.metrics.scroll_frame_p95_ms < best.metrics.scroll_frame_p95_ms
      ? current
      : best,
  );
  const relativeDelta =
    wrappedScrollRun.metrics.scroll_frame_p95_ms / bestCompetitor.metrics.scroll_frame_p95_ms -
    1;

  return {
    id: "H1",
    status: relativeDelta <= -0.25 ? "satisfied" : "failing",
    summary:
      relativeDelta <= -0.25
        ? "Wrapped-text scrolling beats the best measured DOM comparator by at least 25% while keeping blank gaps and long tasks controlled."
        : "Wrapped-text scrolling is measured against a competitor, but it has not yet cleared the required 25% relative win.",
    evidence: [
      summarizeRunEvidence(wrappedScrollRun),
      summarizeRunEvidence(bestCompetitor),
    ],
  };
}

function evaluateH3(runs) {
  const wrappedScrollRun = findLatestRun(runs, {
    scenarioId: "S2",
    scriptName: "scroll",
  });

  if (!wrappedScrollRun || wrappedScrollRun.status !== "completed") {
    return {
      id: "H3",
      status: "insufficient",
      summary:
        "Missing a completed S2 scroll run, so variable-height stability cannot be evaluated yet.",
      evidence: wrappedScrollRun ? [summarizeRunEvidence(wrappedScrollRun)] : [],
    };
  }

  const rowHeightError = wrappedScrollRun.metrics?.row_height_error_p95_px;
  const anchorShift = wrappedScrollRun.metrics?.scroll_anchor_shift_px;

  if (rowHeightError === undefined || anchorShift === undefined) {
    return {
      id: "H3",
      status: "insufficient",
      summary:
        "S2 scrolling is measured, but row-height error and scroll-anchor shift are still missing, so backward-scroll stability is not claim-ready.",
      evidence: [summarizeRunEvidence(wrappedScrollRun)],
    };
  }

  return {
    id: "H3",
    status:
      rowHeightError <= 4 &&
      anchorShift <= 16 &&
      (wrappedScrollRun.metrics?.blank_gap_frames ?? Number.POSITIVE_INFINITY) === 0
        ? "satisfied"
        : "failing",
    summary:
      rowHeightError <= 4 &&
      anchorShift <= 16 &&
      (wrappedScrollRun.metrics?.blank_gap_frames ?? Number.POSITIVE_INFINITY) === 0
        ? "Variable-height scrolling stays within the current row-height and anchor-shift thresholds."
        : "Variable-height scrolling is instrumented, but at least one stability threshold is still failing.",
    evidence: [summarizeRunEvidence(wrappedScrollRun)],
  };
}

function evaluateH5(entries, runs) {
  const hasSummaries = entries.length > 0 && entries.every((entry) => Boolean(entry.summaryPath));
  const hasTraces =
    runs.length > 0 &&
    runs.every((run) => run.status === "unsupported" || Boolean(run.tracePath));

  return {
    id: "H5",
    status: hasSummaries && hasTraces ? "satisfied" : "insufficient",
    summary:
      hasSummaries && hasTraces
        ? "The matrix run writes summary JSON, trace artifacts, and a machine-readable hypothesis report from one command."
        : "The matrix run is still missing one or more required artifacts for reproducible claims.",
    evidence: entries.map((entry) => ({
      scenarioId: entry.scenarioId,
      scriptName: entry.scriptName,
      summaryPath: entry.summaryPath,
    })),
  };
}

function findLatestRun(runs, matcher) {
  return runs
    .filter(
      (run) =>
        (matcher.adapterId === undefined || run.adapterId === matcher.adapterId) &&
        run.scenarioId === matcher.scenarioId &&
        run.scriptName === matcher.scriptName,
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .at(-1);
}

function summarizeRunEvidence(run) {
  return {
    adapterId: run.adapterId,
    scenarioId: run.scenarioId,
    scriptName: run.scriptName,
    status: run.status,
    metrics: run.metrics ?? {},
  };
}

function sanitizeTimestamp(timestamp) {
  return timestamp.toLowerCase().replaceAll(/[:.]/g, "-");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run();
}
