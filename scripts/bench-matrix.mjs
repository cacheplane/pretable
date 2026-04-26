import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getBenchAdapterFamily } from "../shared/bench-adapter-families.js";

const DEFAULT_ADAPTERS = ["pretable", "ag-grid"];
const DEFAULT_REPEATS = 1;
const DEFAULT_SCALE = "dev";
const DEFAULT_SCENARIOS = ["S1", "S2", "S3", "S7"];
const DEFAULT_SCRIPTS = ["initial", "scroll"];
const BENCH_BASE_URL = "http://127.0.0.1:4173";
const BENCH_APP_ID = "@pretable/app-bench";

export function parseBenchMatrixArgs(args) {
  const parsed = {
    adapters: DEFAULT_ADAPTERS,
    repeats: DEFAULT_REPEATS,
    scale: DEFAULT_SCALE,
    scenarios: DEFAULT_SCENARIOS,
    scripts: DEFAULT_SCRIPTS,
    passthroughArgs: [],
  };

  for (const arg of args) {
    if (arg.startsWith("--adapters=")) {
      parsed.adapters = splitCsvArg(arg.slice("--adapters=".length));
      continue;
    }

    if (arg.startsWith("--repeats=")) {
      parsed.repeats = parsePositiveInteger(
        arg.slice("--repeats=".length),
        DEFAULT_REPEATS,
      );
      continue;
    }

    if (arg.startsWith("--scale=")) {
      parsed.scale = arg.slice("--scale=".length).trim() || DEFAULT_SCALE;
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
    Array.from({ length: parsedArgs.repeats }, (_, repeatIndex) =>
      parsedArgs.scenarios.flatMap((scenarioId) =>
        parsedArgs.scripts.map((scriptName) => ({
          adapterId,
          repeatIndex,
          scale: parsedArgs.scale,
          scenarioId,
          scriptName,
        })),
      ),
    ).flat(),
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

export function createBenchPreviewLaunch(workspaceDir) {
  return {
    build: {
      command: "pnpm",
      args: ["--filter", BENCH_APP_ID, "build"],
      cwd: workspaceDir,
    },
    preview: {
      command: "pnpm",
      args: [
        "exec",
        "vite",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        "4173",
        "--strictPort",
      ],
      cwd: path.join(workspaceDir, "apps", "bench"),
    },
  };
}

export function createHypothesisReport(input) {
  return {
    runsetId: input.runsetId,
    generatedAt: input.generatedAt,
    adapters: summarizeReportAdapters(input.entries, input.runs),
    matrix: summarizeMatrixScope(input.entries, input.runs),
    slices: summarizeReportSlices(input.entries, input.runs),
    hypotheses: [
      evaluateH1(input.runs, "S2"),
      evaluateH6(input.runs, "S2"),
      evaluateH7(input.runs, "S2"),
      evaluateH8(input.runs, "S2"),
      evaluateH5(input.entries, input.runs),
      evaluateH9(input.runs),
      evaluateH10(input.runs),
      evaluateH11(input.runs),
      evaluateH12(input.runs),
      evaluateH13(input.runs),
    ],
  };
}

async function run() {
  const parsedArgs = parseBenchMatrixArgs(process.argv.slice(2));
  const runsetId = sanitizeTimestamp(new Date().toISOString());
  const previewLaunch = createBenchPreviewLaunch(process.cwd());
  await runCommand(previewLaunch.build);
  const server = spawn(
    previewLaunch.preview.command,
    previewLaunch.preview.args,
    {
      cwd: previewLaunch.preview.cwd,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );
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

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32",
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command.command} exited with signal ${signal}`));
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command.command} exited with code ${code ?? 1}`));
    });
  });
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
      `bench:e2e did not write a summary for ${entry.adapterId}/${entry.scenarioId}/${entry.scriptName}#${entry.repeatIndex + 1}`,
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
        PRETABLE_BENCH_REPEAT_INDEX: String(entry.repeatIndex),
        PRETABLE_BENCH_SCALE: entry.scale,
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

      reject(
        new Error(
          `bench:e2e failed for ${entry.adapterId}/${entry.scenarioId}/${entry.scriptName}#${entry.repeatIndex + 1}`,
        ),
      );
    });
  });
}

function splitCsvArg(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value.trim(), 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function waitForServer(url, server, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(
        `preview:bench exited early with code ${server.exitCode}`,
      );
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
      const raw = await readFile(
        path.join(process.cwd(), entry.summaryPath),
        "utf8",
      );
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
  const reportPath = path.join(
    reportsDir,
    `${report.runsetId}.hypotheses.json`,
  );

  await mkdir(reportsDir, { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  return path.relative(process.cwd(), reportPath);
}

function evaluateH1(runs, scenarioId) {
  const wrappedScrollSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId,
    scriptName: "scroll",
  });

  if (wrappedScrollSeries.length === 0) {
    return {
      id: "H1",
      status: "insufficient",
      summary: `Missing a completed ${scenarioId} scroll run, so composite scroll quality cannot be evaluated yet.`,
      evidence: [],
    };
  }

  const pretableEvidence = summarizeRunSeriesEvidence(wrappedScrollSeries);
  const blankGapFrames = maxMetric(wrappedScrollSeries, "blank_gap_frames");
  const longTasksCount = maxMetric(wrappedScrollSeries, "long_tasks_count");
  const rowHeightError = pretableEvidence.metrics.row_height_error_p95_px;
  const anchorShift =
    pretableEvidence.metrics.scroll_anchor_shift_backward_p95_px ??
    pretableEvidence.metrics.scroll_anchor_shift_px;

  const failingSubCriteria = [];

  if (rowHeightError === undefined || rowHeightError > 1) {
    failingSubCriteria.push(
      `row height error p95 is ${rowHeightError ?? "missing"}px (threshold: ≤ 1px)`,
    );
  }

  if (anchorShift === undefined || anchorShift > 16) {
    failingSubCriteria.push(
      `anchor shift is ${anchorShift ?? "missing"}px (threshold: ≤ 16px)`,
    );
  }

  if (blankGapFrames === undefined || blankGapFrames > 0) {
    failingSubCriteria.push(
      `blank gap frames is ${blankGapFrames ?? "missing"} (threshold: 0)`,
    );
  }

  if (longTasksCount === undefined || longTasksCount > 0) {
    failingSubCriteria.push(
      `long tasks count is ${longTasksCount ?? "missing"} (threshold: 0)`,
    );
  }

  if (failingSubCriteria.length > 0) {
    return {
      id: "H1",
      status: "failing",
      summary: `Wrapped-text scrolling is measured, but ${failingSubCriteria.length} quality sub-criteria are not yet met: ${failingSubCriteria.join("; ")}.`,
      evidence: [pretableEvidence],
    };
  }

  const competitorSeries = groupRunSeries(runs, {
    scenarioId,
    scriptName: "scroll",
  }).filter(
    (series) =>
      series[0]?.adapterId !== "pretable" &&
      medianMetric(series, "scroll_frame_p95_ms") !== undefined,
  );
  const fullGridCompetitorSeries = competitorSeries.filter(
    (series) => getAdapterFamily(series[0]?.adapterId) === "full-grid",
  );
  const primitiveCompetitorSeries = competitorSeries.filter(
    (series) =>
      getAdapterFamily(series[0]?.adapterId) === "virtualization-primitive",
  );

  if (fullGridCompetitorSeries.length === 0) {
    return {
      id: "H1",
      status: "directional",
      summary: hasPolicyDrift(pretableEvidence)
        ? "Wrapped-text scrolling meets all absolute quality thresholds on current medians, but policy drift across repeats keeps the result directional rather than reproducible."
        : "Wrapped-text scrolling meets all absolute quality thresholds, but the comparative uniqueness claim is unmeasured — no full-grid competitor data is available.",
      evidence: [
        pretableEvidence,
        ...(primitiveCompetitorSeries.length > 0
          ? [
              summarizeRunSeriesEvidence(
                primitiveCompetitorSeries.reduce((best, current) =>
                  medianMetric(current, "scroll_frame_p95_ms") <
                  medianMetric(best, "scroll_frame_p95_ms")
                    ? current
                    : best,
                ),
              ),
            ]
          : []),
      ],
    };
  }

  const bestFullGridSeries = fullGridCompetitorSeries.reduce((best, current) =>
    medianMetric(current, "scroll_frame_p95_ms") <
    medianMetric(best, "scroll_frame_p95_ms")
      ? current
      : best,
  );
  const bestFullGridEvidence = summarizeRunSeriesEvidence(bestFullGridSeries);
  const bestPrimitiveEvidence =
    primitiveCompetitorSeries.length > 0
      ? summarizeRunSeriesEvidence(
          primitiveCompetitorSeries.reduce((best, current) =>
            medianMetric(current, "scroll_frame_p95_ms") <
            medianMetric(best, "scroll_frame_p95_ms")
              ? current
              : best,
          ),
        )
      : null;
  const evidenceArray = [
    pretableEvidence,
    bestFullGridEvidence,
    ...(bestPrimitiveEvidence ? [bestPrimitiveEvidence] : []),
  ];

  const frameParityRatio =
    pretableEvidence.metrics.scroll_frame_p95_ms /
    bestFullGridEvidence.metrics.scroll_frame_p95_ms;

  if (frameParityRatio > 1.1) {
    const percentAbove = Math.round((frameParityRatio - 1) * 100);

    return {
      id: "H1",
      status: "failing",
      summary: `Wrapped-text scrolling meets all quality thresholds, but frame p95 is ${percentAbove}% above the best full-grid comparator (${bestFullGridEvidence.adapterId}: ${bestFullGridEvidence.metrics.scroll_frame_p95_ms}ms vs pretable: ${pretableEvidence.metrics.scroll_frame_p95_ms}ms). The 10% parity threshold is not met.`,
      evidence: evidenceArray,
    };
  }

  const allFullGridCompetitorsPassQuality = fullGridCompetitorSeries.every(
    (series) => {
      const evidence = summarizeRunSeriesEvidence(series);
      const subCriteria = evaluateCompetitorSubCriteria(evidence);

      return Object.values(subCriteria).every(Boolean);
    },
  );

  if (allFullGridCompetitorsPassQuality) {
    return {
      id: "H1",
      status: "directional",
      summary:
        "Wrapped-text scrolling meets all quality thresholds, but so does every measured full-grid competitor — the uniqueness claim is not yet supported.",
      evidence: evidenceArray,
    };
  }

  const hasRelevantPolicyDrift =
    hasPolicyDrift(pretableEvidence) || hasPolicyDrift(bestFullGridEvidence);

  if (hasRelevantPolicyDrift) {
    return {
      id: "H1",
      status: "directional",
      summary:
        "Wrapped-text scrolling meets all quality and uniqueness thresholds on current medians, but policy drift across repeats keeps the result directional rather than reproducible.",
      evidence: evidenceArray,
    };
  }

  const hasRepeatedEvidence =
    pretableEvidence.sampleCount > 1 && bestFullGridEvidence.sampleCount > 1;

  return {
    id: "H1",
    status: "satisfied",
    summary: hasRepeatedEvidence
      ? "Wrapped-text scrolling delivers zero-artifact quality (row height error ≤ 1px, anchor shift ≤ 16px, no blank gaps, no long tasks) with frame times within 10% of the best measured full-grid comparator. No measured full-grid competitor achieves the same combined quality. Evidence is based on current repeated-run medians."
      : "Wrapped-text scrolling delivers zero-artifact quality (row height error ≤ 1px, anchor shift ≤ 16px, no blank gaps, no long tasks) with frame times within 10% of the best measured full-grid comparator. No measured full-grid competitor achieves the same combined quality. Evidence is based on the current sample.",
    evidence: evidenceArray,
  };
}

function evaluateCompetitorSubCriteria(evidence) {
  return {
    rowHeightAccuracy: evidence.metrics.row_height_error_p95_px <= 1,
    anchorStability:
      (evidence.metrics.scroll_anchor_shift_backward_p95_px ??
        evidence.metrics.scroll_anchor_shift_px) <= 16,
    blankGapControl: evidence.metrics.blank_gap_frames === 0,
    longTaskControl: evidence.metrics.long_tasks_count === 0,
  };
}

function evaluateH5(entries, runs) {
  const hasSummaries =
    entries.length > 0 && entries.every((entry) => Boolean(entry.summaryPath));
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
      ...(entry.repeatIndex === undefined
        ? {}
        : { repeatIndex: entry.repeatIndex }),
      summaryPath: entry.summaryPath,
    })),
  };
}

function evaluateH6(runs, scenarioId) {
  return evaluateInteractionHypothesis(runs, scenarioId, {
    id: "H6",
    scriptName: "sort",
    latencyThreshold: 64,
    settleThreshold: 48,
    requiresRowReduction: false,
    satisfiedSummary:
      "Wrapped-text local sorting stays within the current interaction and settle thresholds while preserving post-sort stability.",
    insufficientSummary: `Missing a completed ${scenarioId} sort run, so local sort interaction proof is not available yet.`,
  });
}

function evaluateH7(runs, scenarioId) {
  return evaluateInteractionHypothesis(runs, scenarioId, {
    id: "H7",
    scriptName: "filter-metadata",
    latencyThreshold: 64,
    settleThreshold: 48,
    requiresRowReduction: true,
    satisfiedSummary:
      "Metadata filtering stays within the current interaction and settle thresholds while reducing the row set without post-filter instability.",
    insufficientSummary: `Missing a completed ${scenarioId} metadata-filter run, so metadata filter proof is not available yet.`,
  });
}

function evaluateH8(runs, scenarioId) {
  return evaluateInteractionHypothesis(runs, scenarioId, {
    id: "H8",
    scriptName: "filter-text",
    latencyThreshold: 96,
    settleThreshold: 64,
    requiresRowReduction: true,
    satisfiedSummary:
      "Wrapped-text primary-column filtering stays within the current interaction and settle thresholds while preserving post-filter stability.",
    insufficientSummary: `Missing a completed ${scenarioId} text-filter run, so wrapped-text filter proof is not available yet.`,
  });
}

function evaluateH9(runs) {
  return { ...evaluateH1(runs, "S7"), id: "H9" };
}

function evaluateH10(runs) {
  return { ...evaluateH6(runs, "S7"), id: "H10" };
}

function evaluateH11(runs) {
  return { ...evaluateH7(runs, "S7"), id: "H11" };
}

function evaluateH12(runs) {
  return { ...evaluateH8(runs, "S7"), id: "H12" };
}

/**
 * H13 — Streaming Update Frame Budget.
 *
 * Pretable's `updates` script on the S5 streaming-updates scenario should
 * keep frame p95 within one 60Hz frame budget (≤ 16ms) with zero long
 * tasks (>50ms blocking) across the 3-second test.
 *
 * Phase 1 ships absolute thresholds against pretable only — no comparator
 * has an `updates` adapter wired yet (only AG Grid has a native batching
 * API; MUI has updateRows; TanStack has setRows). Phase 2 will promote
 * to a comparative claim once the comparator update paths land.
 */
function evaluateH13(runs) {
  const updatesSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S5",
    scriptName: "updates",
  });

  if (updatesSeries.length === 0) {
    return {
      id: "H13",
      status: "insufficient",
      summary:
        "Missing a completed S5 updates run, so streaming update frame budget proof is not available yet.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(updatesSeries);
  const framePass = evidence.metrics.scroll_frame_p95_ms;
  const longTasksCount = maxMetric(updatesSeries, "long_tasks_count");

  const failingSubCriteria = [];

  if (framePass === undefined || framePass > 16) {
    failingSubCriteria.push(
      `frame p95 is ${framePass ?? "missing"}ms (threshold: ≤ 16ms)`,
    );
  }

  if (longTasksCount === undefined || longTasksCount > 0) {
    failingSubCriteria.push(
      `long tasks count is ${longTasksCount ?? "missing"} (threshold: 0)`,
    );
  }

  if (failingSubCriteria.length > 0) {
    return {
      id: "H13",
      status: "failing",
      summary: `Streaming updates on S5 are measured, but ${failingSubCriteria.length} frame-budget sub-criteria are not met: ${failingSubCriteria.join("; ")}.`,
      evidence: [evidence],
    };
  }

  const hasRepeatedEvidence = evidence.sampleCount > 1;

  return {
    id: "H13",
    status: "satisfied",
    summary: hasRepeatedEvidence
      ? "Streaming updates on S5 keep frame p95 within one 60Hz frame (≤ 16ms) with zero long tasks across the 3-second test. Evidence is based on current repeated-run medians."
      : "Streaming updates on S5 keep frame p95 within one 60Hz frame (≤ 16ms) with zero long tasks across the 3-second test. Evidence is based on the current sample.",
    evidence: [evidence],
  };
}

function evaluateInteractionHypothesis(
  runs,
  scenarioId,
  {
    id,
    scriptName,
    latencyThreshold,
    settleThreshold,
    requiresRowReduction,
    satisfiedSummary,
    insufficientSummary,
  },
) {
  const candidateSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId,
    scriptName,
  });

  if (candidateSeries.length === 0) {
    return {
      id,
      status: "insufficient",
      summary: insufficientSummary,
      evidence: [],
    };
  }

  const candidateEvidence = summarizeRunSeriesEvidence(candidateSeries);
  const latency = candidateEvidence.metricSummary?.interaction_latency_ms;
  const settle = candidateEvidence.metricSummary?.settle_duration_ms;
  const blankGap =
    candidateEvidence.metricSummary?.post_interaction_blank_gap_frames;
  const anchorShift =
    candidateEvidence.metricSummary?.post_interaction_anchor_shift_px;
  const rowHeight =
    candidateEvidence.metricSummary?.post_interaction_row_height_error_p95_px;
  const selectedPreserved =
    candidateEvidence.metricSummary?.selected_row_preserved;
  const focusedPreserved =
    candidateEvidence.metricSummary?.focused_row_preserved;
  const rowCount = candidateEvidence.metricSummary?.result_row_count;
  const baselineRowCount = candidateSeries[0]?.rowCount;

  if (
    !latency ||
    !settle ||
    !blankGap ||
    !anchorShift ||
    !rowHeight ||
    !selectedPreserved ||
    !focusedPreserved ||
    !rowCount
  ) {
    return {
      id,
      status: "insufficient",
      summary:
        "The interaction path is measured, but one or more required latency or stability metrics are still missing.",
      evidence: [candidateEvidence],
    };
  }

  const competitorSeries = groupRunSeries(runs, {
    scenarioId,
    scriptName,
  }).filter((series) => series[0]?.adapterId !== "pretable");
  const bestCompetitorSeries =
    competitorSeries.length > 0
      ? competitorSeries.reduce((best, current) =>
          medianMetric(current, "interaction_latency_ms") <
          medianMetric(best, "interaction_latency_ms")
            ? current
            : best,
        )
      : null;
  const bestCompetitorEvidence = bestCompetitorSeries
    ? summarizeRunSeriesEvidence(bestCompetitorSeries)
    : null;
  const rowReductionSatisfied = requiresRowReduction
    ? baselineRowCount !== undefined && rowCount.median < baselineRowCount
    : true;
  const worstCaseExceeded = hasInteractionMedianStableButWorstCaseExceeded(
    candidateEvidence,
    {
      anchorShiftThreshold: 16,
      blankGapThreshold: 0,
      latencyThreshold,
      rowHeightThreshold: 4,
      settleThreshold,
    },
  );
  const passes =
    latency.median <= latencyThreshold &&
    settle.median <= settleThreshold &&
    blankGap.max === 0 &&
    anchorShift.median <= 16 &&
    rowHeight.median <= 4 &&
    selectedPreserved.median >= 1 &&
    focusedPreserved.median >= 1 &&
    rowReductionSatisfied;

  return {
    id,
    status: passes
      ? hasPolicyDrift(candidateEvidence)
        ? "directional"
        : worstCaseExceeded
          ? "failing"
          : "satisfied"
      : "failing",
    summary: passes
      ? hasPolicyDrift(candidateEvidence)
        ? `${satisfiedSummary} Current medians are promising, but policy drift across repeats keeps the claim directional.`
        : worstCaseExceeded
          ? "The interaction is instrumented and current medians stay within thresholds, but worst-case repeats still exceed the current latency or stability limits."
          : candidateEvidence.sampleCount > 1
            ? `${satisfiedSummary} Evidence is based on current repeated-run medians.`
            : `${satisfiedSummary} Evidence is based on the current sample.`
      : requiresRowReduction && !rowReductionSatisfied
        ? "The interaction is instrumented, but the filter does not materially reduce the row set yet."
        : "The interaction is instrumented, but it still exceeds one or more current latency or stability thresholds.",
    evidence: [
      candidateEvidence,
      ...(bestCompetitorEvidence ? [bestCompetitorEvidence] : []),
    ],
  };
}

function findRunSeries(runs, matcher) {
  return runs
    .filter(
      (run) =>
        run.status === "completed" &&
        (matcher.adapterId === undefined ||
          run.adapterId === matcher.adapterId) &&
        run.scenarioId === matcher.scenarioId &&
        run.scriptName === matcher.scriptName,
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function groupRunSeries(runs, matcher) {
  const groups = new Map();

  for (const run of runs) {
    if (
      run.status !== "completed" ||
      run.scenarioId !== matcher.scenarioId ||
      run.scriptName !== matcher.scriptName
    ) {
      continue;
    }

    const key = `${run.adapterId}:${run.scenarioId}:${run.scriptName}`;
    const series = groups.get(key) ?? [];
    series.push(run);
    groups.set(key, series);
  }

  return [...groups.values()].map((series) =>
    series.sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
  );
}

function summarizeRunSeriesEvidence(series) {
  const latestRun = series.at(-1);
  const metricSummary = summarizeMetricSummary(series);
  const metrics = Object.fromEntries(
    Object.entries(metricSummary).map(([metricId, summary]) => [
      metricId,
      summary.median,
    ]),
  );

  return {
    adapterId: latestRun.adapterId,
    adapterFamily: getAdapterFamily(latestRun.adapterId),
    scenarioId: latestRun.scenarioId,
    scriptName: latestRun.scriptName,
    status: latestRun.status,
    sampleCount: series.length,
    policyNotes: summarizePolicyNotes(series),
    metrics,
    metricSummary,
  };
}

function summarizeReportAdapters(entries, runs) {
  return uniqueInOrder([
    ...entries.map((entry) => entry.adapterId),
    ...runs.map((run) => run.adapterId),
  ]).map((adapterId) => ({
    adapterId,
    adapterFamily: getAdapterFamily(adapterId),
  }));
}

function summarizeMatrixScope(entries, runs) {
  const adapters = uniqueInOrder([
    ...entries.map((entry) => entry.adapterId),
    ...runs.map((run) => run.adapterId),
  ]);
  const scenarios = uniqueInOrder([
    ...entries.map((entry) => entry.scenarioId),
    ...runs.map((run) => run.scenarioId),
  ]);
  const scripts = uniqueInOrder([
    ...entries.map((entry) => entry.scriptName),
    ...runs.map((run) => run.scriptName),
  ]);
  const repeats = Math.max(
    1,
    ...entries.map((entry) =>
      entry.repeatIndex === undefined ? 1 : entry.repeatIndex + 1,
    ),
  );

  return {
    adapters,
    scenarios,
    scripts,
    repeats,
  };
}

function summarizeReportSlices(entries, runs) {
  const sliceKeys = uniqueInOrder([
    ...entries.map((entry) => `${entry.scenarioId}:${entry.scriptName}`),
    ...runs.map((run) => `${run.scenarioId}:${run.scriptName}`),
  ]);

  return sliceKeys.map((sliceKey) => {
    const [scenarioId, scriptName] = sliceKey.split(":");
    const sliceEntries = entries.filter(
      (entry) =>
        entry.scenarioId === scenarioId && entry.scriptName === scriptName,
    );
    const sliceRuns = runs.filter(
      (run) =>
        run.status === "completed" &&
        run.scenarioId === scenarioId &&
        run.scriptName === scriptName,
    );

    return {
      scenarioId,
      scriptName,
      adapterIds: uniqueInOrder([
        ...sliceEntries.map((entry) => entry.adapterId),
        ...sliceRuns.map((run) => run.adapterId),
      ]),
      policyNotes:
        sliceRuns.length > 0
          ? summarizePolicyNotes(sliceRuns)
          : { common: [], union: [], varying: {} },
    };
  });
}

function summarizeMetricSummary(series) {
  const metricIds = new Set(
    series.flatMap((run) => Object.keys(run.metrics ?? {})),
  );
  const metricSummary = {};

  for (const metricId of metricIds) {
    const values = numericMetricValues(series, metricId);

    if (values.length > 0) {
      metricSummary[metricId] = {
        min: values[0],
        median: values[Math.floor(values.length / 2)],
        max: values.at(-1),
      };
    }
  }

  return metricSummary;
}

function medianMetric(series, metricId) {
  const values = numericMetricValues(series, metricId);

  if (values.length === 0) {
    return undefined;
  }

  return values[Math.floor(values.length / 2)];
}

function maxMetric(series, metricId) {
  const values = numericMetricValues(series, metricId);

  return values.length > 0 ? Math.max(...values) : undefined;
}

function numericMetricValues(series, metricId) {
  return series
    .map((run) => run.metrics?.[metricId])
    .filter((value) => typeof value === "number")
    .sort((left, right) => left - right);
}

function hasInteractionMedianStableButWorstCaseExceeded(
  evidence,
  {
    latencyThreshold,
    settleThreshold,
    anchorShiftThreshold,
    rowHeightThreshold,
    blankGapThreshold,
  },
) {
  const latency = evidence.metricSummary?.interaction_latency_ms;
  const settle = evidence.metricSummary?.settle_duration_ms;
  const anchorShift = evidence.metricSummary?.post_interaction_anchor_shift_px;
  const rowHeight =
    evidence.metricSummary?.post_interaction_row_height_error_p95_px;
  const blankGap = evidence.metricSummary?.post_interaction_blank_gap_frames;

  return (
    latency?.median <= latencyThreshold &&
    settle?.median <= settleThreshold &&
    anchorShift?.median <= anchorShiftThreshold &&
    rowHeight?.median <= rowHeightThreshold &&
    blankGap?.median <= blankGapThreshold &&
    (latency?.max > latencyThreshold ||
      settle?.max > settleThreshold ||
      anchorShift?.max > anchorShiftThreshold ||
      rowHeight?.max > rowHeightThreshold ||
      blankGap?.max > blankGapThreshold)
  );
}

function summarizePolicyNotes(series) {
  const noteSets = series.map((run) => new Set(run.notes ?? []));
  const union = [...new Set(series.flatMap((run) => run.notes ?? []))];
  const common = union.filter((note) =>
    noteSets.every((notes) => notes.has(note)),
  );
  const valuesByKey = new Map();

  for (const note of union) {
    const parsed = parsePolicyNote(note);

    if (!parsed) {
      continue;
    }

    const values = valuesByKey.get(parsed.key) ?? new Set();
    values.add(parsed.value);
    valuesByKey.set(parsed.key, values);
  }

  const varying = Object.fromEntries(
    [...valuesByKey.entries()]
      .filter(([, values]) => values.size > 1)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, values]) => [key, [...values].sort()]),
  );

  return {
    common,
    union,
    varying,
  };
}

function hasPolicyDrift(evidence) {
  return Object.keys(evidence.policyNotes?.varying ?? {}).length > 0;
}

function getAdapterFamily(adapterId) {
  return getBenchAdapterFamily(adapterId);
}

function describeComparatorFamily(adapterFamily) {
  if (adapterFamily === "full-grid") {
    return "full-grid";
  }

  if (adapterFamily === "virtualization-primitive") {
    return "virtualization-primitive";
  }

  return "DOM";
}

function parsePolicyNote(note) {
  const separatorIndex = note.indexOf(":");

  if (separatorIndex <= 0) {
    return null;
  }

  return {
    key: note.slice(0, separatorIndex).trim(),
    value: note.slice(separatorIndex + 1).trim(),
  };
}

function sanitizeTimestamp(timestamp) {
  return timestamp.toLowerCase().replaceAll(/[:.]/g, "-");
}

function uniqueInOrder(values) {
  return [...new Set(values.filter(Boolean))];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run();
}
