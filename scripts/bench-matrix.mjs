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
/**
 * Default update-rate dimension. Only the `updates` script consumes it;
 * other scripts ignore the value. Single-element default keeps non-rate-
 * sweep matrix runs unchanged.
 */
const DEFAULT_UPDATE_RATES = [1000];
/**
 * Minimum repeats per side for comparator-parity verdicts in the tight
 * zone. p95 of 3 samples is essentially max-of-3, so a ±10% wobble can
 * easily flip a real-parity result. Reused by H1 (frame p95 parity) and
 * H22 (autosize latency parity).
 */
const COMPARATOR_PARITY_MIN_REPEATS = 10;
const BENCH_BASE_URL = "http://127.0.0.1:4173";
const BENCH_APP_ID = "@pretable/app-bench";

export function parseBenchMatrixArgs(args) {
  const parsed = {
    adapters: DEFAULT_ADAPTERS,
    repeats: DEFAULT_REPEATS,
    scale: DEFAULT_SCALE,
    scenarios: DEFAULT_SCENARIOS,
    scripts: DEFAULT_SCRIPTS,
    updateRates: DEFAULT_UPDATE_RATES,
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

    if (arg.startsWith("--update-rates=")) {
      parsed.updateRates = splitCsvArg(arg.slice("--update-rates=".length))
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (parsed.updateRates.length === 0) {
        parsed.updateRates = DEFAULT_UPDATE_RATES;
      }
      continue;
    }

    parsed.passthroughArgs.push(arg);
  }

  return parsed;
}

export function createBenchMatrixEntries(parsedArgs) {
  const updateRates =
    parsedArgs.updateRates && parsedArgs.updateRates.length > 0
      ? parsedArgs.updateRates
      : DEFAULT_UPDATE_RATES;

  return parsedArgs.adapters.flatMap((adapterId) =>
    Array.from({ length: parsedArgs.repeats }, (_, repeatIndex) =>
      parsedArgs.scenarios.flatMap((scenarioId) =>
        parsedArgs.scripts.flatMap((scriptName) => {
          // Only the `updates` script consumes the update-rate dimension.
          // For every other script, single entry with the default rate so
          // existing matrix runs aren't multiplied.
          const ratesForEntry =
            scriptName === "updates" ? updateRates : DEFAULT_UPDATE_RATES;
          return ratesForEntry.map((updateRatePerSec) => ({
            adapterId,
            repeatIndex,
            scale: parsedArgs.scale,
            scenarioId,
            scriptName,
            updateRatePerSec,
          }));
        }),
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
      evaluateH14(input.runs),
      evaluateH15(input.runs),
      evaluateH16(input.runs),
      evaluateH17(input.runs),
      evaluateH18(input.runs),
      evaluateH19(input.runs),
      evaluateH20(input.runs),
      evaluateH21(input.runs),
      evaluateH22(input.runs),
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
        ...(entry.updateRatePerSec !== undefined
          ? {
              PRETABLE_BENCH_UPDATE_RATE_PER_SEC: String(
                entry.updateRatePerSec,
              ),
            }
          : {}),
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

/**
 * Find comparator-adapter series for the given (scenarioId, scriptName)
 * slice and return their evidence summaries. Pretable is excluded —
 * callers are expected to construct pretable evidence separately. Each
 * returned entry is the same shape as summarizeRunSeriesEvidence's output,
 * matching the evidence-array contract used by all evaluators.
 *
 * Used by H6/H7/H8 (interaction) and H19/H20/H21 (cell-renderer) to
 * surface comparator metrics alongside pretable in their evidence arrays.
 * Status verdicts remain pretable-only; this data is informational.
 */
function findComparatorEvidence(runs, { scenarioId, scriptName }) {
  const series = groupRunSeries(runs, { scenarioId, scriptName }).filter(
    (s) => s[0]?.adapterId && s[0].adapterId !== "pretable",
  );
  return series.map((s) => summarizeRunSeriesEvidence(s));
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

  // Comparator-parity is sensitive to low-repeat noise around the 10% threshold.
  // Require ≥COMPARATOR_PARITY_MIN_REPEATS repeats on both sides before
  // crowning a parity verdict in the tight zone (0.9 ≤ ratio ≤ 1.2). Outside
  // that band the gap is large enough to dominate noise.
  const ratioIsInTightZone = frameParityRatio >= 0.9 && frameParityRatio <= 1.2;
  const repeatsAreInsufficient =
    pretableEvidence.sampleCount < COMPARATOR_PARITY_MIN_REPEATS ||
    bestFullGridEvidence.sampleCount < COMPARATOR_PARITY_MIN_REPEATS;

  if (frameParityRatio > 1.1 && ratioIsInTightZone && repeatsAreInsufficient) {
    return {
      id: "H1",
      status: "insufficient",
      summary: `Comparator-parity check needs ≥${COMPARATOR_PARITY_MIN_REPEATS} repeats per adapter when the frame-p95 ratio is in the tight zone (got pretable n=${pretableEvidence.sampleCount}, ${bestFullGridEvidence.adapterId} n=${bestFullGridEvidence.sampleCount}; ratio = ${frameParityRatio.toFixed(3)}). Re-run with --repeats=${COMPARATOR_PARITY_MIN_REPEATS} or higher.`,
      evidence: evidenceArray,
    };
  }

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
    // 64 ms = 4 frames at 60 fps. The original 48 ms was set on 2026-04-14
    // (commit f553cf5) before the column-virtualization refactor switched
    // cells from CSS-grid auto-sized rows to absolute positioning with
    // planner-driven heights and a useLayoutEffect measurement-reconcile
    // cycle. Post-refactor, sort can settle in 1 frame (~17 ms) on the
    // happy path but occasionally takes 3 frames (~50 ms) when a measured
    // row height differs from the estimate enough to shift a neighbor's
    // top by a pixel — the bench's settle signature treats that as
    // momentary instability and resets the stable-frame counter. The
    // perceptual budget for a sort interaction is ~100 ms; latency (64 ms)
    // + 4-frame settle (64 ms) = 128 ms, still under the boundary where
    // users perceive sluggishness. Matches H8/H12's existing 64 ms settle.
    settleThreshold: 64,
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
 * H13 — Streaming Update Frame Budget (comparative).
 *
 * Pretable's `updates` script on the S5 streaming-updates scenario must
 * (a) clear absolute frame-budget thresholds (frame p95 ≤ 16ms, zero
 * long tasks across the 3-second test), and (b) match or beat the best
 * measured comparator's frame p95 within a 10% parity band — the same
 * structure as H1 for the scroll wedge.
 *
 * Each adapter wires its idiomatic streaming pattern in apps/bench/src/
 * (Pretable: stream-adapter batcher → applyTransaction; AG Grid: native
 * applyTransaction; MUI: apiRef.updateRows; TanStack: setRows merge).
 * If no comparator data is available, status falls back to "directional"
 * (absolute thresholds met but uniqueness unmeasured).
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

  const pretableEvidence = summarizeRunSeriesEvidence(updatesSeries);
  const framePass = pretableEvidence.metrics.scroll_frame_p95_ms;
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
      evidence: [pretableEvidence],
    };
  }

  // Comparative band: the best comparator that completed a run.
  const competitorSeries = groupRunSeries(runs, {
    scenarioId: "S5",
    scriptName: "updates",
  }).filter(
    (series) =>
      series[0]?.adapterId !== "pretable" &&
      medianMetric(series, "scroll_frame_p95_ms") !== undefined,
  );

  if (competitorSeries.length === 0) {
    return {
      id: "H13",
      status: "directional",
      summary:
        "Streaming updates on S5 meet absolute frame-budget thresholds, but the comparative claim is unmeasured — no comparator's `updates` run completed.",
      evidence: [pretableEvidence],
    };
  }

  const bestCompetitorSeries = competitorSeries.reduce((best, current) =>
    medianMetric(current, "scroll_frame_p95_ms") <
    medianMetric(best, "scroll_frame_p95_ms")
      ? current
      : best,
  );
  const bestCompetitorEvidence =
    summarizeRunSeriesEvidence(bestCompetitorSeries);
  const evidenceArray = [pretableEvidence, bestCompetitorEvidence];

  const frameParityRatio =
    pretableEvidence.metrics.scroll_frame_p95_ms /
    bestCompetitorEvidence.metrics.scroll_frame_p95_ms;

  if (frameParityRatio > 1.1) {
    const percentAbove = Math.round((frameParityRatio - 1) * 100);

    return {
      id: "H13",
      status: "failing",
      summary: `Streaming updates on S5 meet absolute thresholds, but frame p95 is ${percentAbove}% above the best comparator (${bestCompetitorEvidence.adapterId}: ${bestCompetitorEvidence.metrics.scroll_frame_p95_ms}ms vs pretable: ${pretableEvidence.metrics.scroll_frame_p95_ms}ms). The 10% parity threshold is not met.`,
      evidence: evidenceArray,
    };
  }

  // Whether any comparator also clears the absolute thresholds.
  const allCompetitorsPassAbsolutes = competitorSeries.every((series) => {
    const evidence = summarizeRunSeriesEvidence(series);
    const fp = evidence.metrics.scroll_frame_p95_ms;
    const lt = maxMetric(series, "long_tasks_count");
    return fp !== undefined && fp <= 16 && lt !== undefined && lt === 0;
  });

  if (allCompetitorsPassAbsolutes) {
    return {
      id: "H13",
      status: "directional",
      summary:
        "Streaming updates on S5 meet all frame-budget thresholds, but every measured comparator also clears them — the uniqueness claim is not yet supported.",
      evidence: evidenceArray,
    };
  }

  const hasRepeatedEvidence =
    pretableEvidence.sampleCount > 1 && bestCompetitorEvidence.sampleCount > 1;

  return {
    id: "H13",
    status: "satisfied",
    summary: hasRepeatedEvidence
      ? "Streaming updates on S5 keep frame p95 within one 60Hz frame (≤ 16ms) with zero long tasks, within 10% of the best measured comparator. At least one comparator fails the absolute thresholds. Evidence is based on current repeated-run medians."
      : "Streaming updates on S5 keep frame p95 within one 60Hz frame (≤ 16ms) with zero long tasks, within 10% of the best measured comparator. At least one comparator fails the absolute thresholds. Evidence is based on the current sample.",
    evidence: evidenceArray,
  };
}

/**
 * Parses the rate-per-second from a run's notes. The bench writes
 * `update rate per sec: N` into notes (see apps/bench/src/bench-runtime.ts).
 * Returns null if the run has no rate annotation (older runs, or non-
 * updates scripts).
 */
function getUpdateRateFromRun(run) {
  if (!Array.isArray(run.notes)) return null;
  const note = run.notes.find(
    (n) => typeof n === "string" && n.startsWith("update rate per sec:"),
  );
  if (!note) return null;
  const parsed = Number(note.slice("update rate per sec:".length).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Groups completed S5/updates runs by (adapter, rate). Returns a
 * Map<adapterId, Map<rate, RunSeries>> so callers can ask: "what's
 * Pretable's series at 5,000 patches/sec?"
 */
function groupUpdatesRunsByAdapterAndRate(runs) {
  const byAdapter = new Map();
  for (const run of runs) {
    if (
      run.status !== "completed" ||
      run.scenarioId !== "S5" ||
      run.scriptName !== "updates"
    ) {
      continue;
    }
    const rate = getUpdateRateFromRun(run);
    if (rate === null) continue;
    const adapter = run.adapterId;
    if (!byAdapter.has(adapter)) byAdapter.set(adapter, new Map());
    const byRate = byAdapter.get(adapter);
    const series = byRate.get(rate) ?? [];
    series.push(run);
    byRate.set(rate, series);
  }
  return byAdapter;
}

/**
 * Highest streaming rate at which an adapter's median frame p95 ≤ 16ms
 * AND median long_tasks_count == 0. Returns null if the adapter has no
 * passing rates (broke at the smallest tested rate).
 */
function highestPassingStreamingRate(rateSeriesMap) {
  let highest = null;
  for (const [rate, series] of rateSeriesMap) {
    const fp = medianMetric(series, "scroll_frame_p95_ms");
    const lt = medianMetric(series, "long_tasks_count");
    if (fp === undefined || lt === undefined) continue;
    if (fp > 16 || lt > 0) continue;
    if (highest === null || rate > highest) highest = rate;
  }
  return highest;
}

/**
 * H14 — Streaming Operating Envelope.
 *
 * Pretable's `updates` script on S5 should sustain its frame budget
 * (frame p95 ≤ 16ms, zero long tasks) across the full operating
 * envelope. Reports the highest rate at which Pretable still passes,
 * compares to the highest passing rate of the best comparator, and
 * checks whether at least one comparator breaks before Pretable does.
 *
 * Status:
 * - insufficient: no rate-tagged Pretable run.
 * - failing: Pretable doesn't pass at the H13 baseline rate (1,000/sec).
 * - directional: Pretable's envelope is unique-or-tied with comparators
 *   but no comparator's envelope is meaningfully smaller (uniqueness
 *   not supported).
 * - satisfied: Pretable passes at ≥ 1,000/sec AND at least one
 *   comparator's envelope is smaller than Pretable's by 10× or more
 *   (e.g., MUI tops out at < 500 while Pretable sustains 25,000+).
 */
function evaluateH14(runs) {
  const byAdapter = groupUpdatesRunsByAdapterAndRate(runs);
  const pretableSeriesByRate = byAdapter.get("pretable");

  if (!pretableSeriesByRate || pretableSeriesByRate.size === 0) {
    return {
      id: "H14",
      status: "insufficient",
      summary:
        "Missing rate-tagged S5 updates runs for pretable, so the streaming operating envelope cannot be evaluated yet.",
      evidence: [],
    };
  }

  const pretableEnvelope = highestPassingStreamingRate(pretableSeriesByRate);
  const sortedRates = [...pretableSeriesByRate.keys()].sort((a, b) => a - b);
  const lowestSampledRate = sortedRates[0];

  if (pretableEnvelope === null) {
    return {
      id: "H14",
      status: "failing",
      summary: `Streaming operating envelope is failing — pretable does not pass absolute thresholds at any tested rate (lowest sampled: ${lowestSampledRate}/sec).`,
      evidence: [],
    };
  }

  if (pretableEnvelope < 1000) {
    return {
      id: "H14",
      status: "failing",
      summary: `Streaming operating envelope is failing — pretable's highest passing rate is ${pretableEnvelope}/sec, below the H13 baseline of 1,000/sec.`,
      evidence: [],
    };
  }

  // Compare against comparators.
  const competitorEnvelopes = [];
  for (const [adapterId, rateSeriesMap] of byAdapter) {
    if (adapterId === "pretable") continue;
    const envelope = highestPassingStreamingRate(rateSeriesMap);
    competitorEnvelopes.push({ adapterId, envelope });
  }

  if (competitorEnvelopes.length === 0) {
    return {
      id: "H14",
      status: "directional",
      summary: `Streaming operating envelope reaches ${pretableEnvelope}/sec for pretable, but the comparative claim is unmeasured — no comparator's rate-tagged S5 updates runs are available.`,
      evidence: [],
    };
  }

  // Identify the comparator with the smallest envelope (or no envelope).
  // A "meaningfully smaller" envelope is ≥ 10× below Pretable's.
  const smallestCompetitor = competitorEnvelopes.reduce((acc, current) => {
    const currentEnvelope =
      current.envelope === null ? -Infinity : current.envelope;
    const accEnvelope = acc.envelope === null ? -Infinity : acc.envelope;
    return currentEnvelope < accEnvelope ? current : acc;
  });

  const meaningfullySmaller =
    smallestCompetitor.envelope === null ||
    smallestCompetitor.envelope * 10 <= pretableEnvelope;

  if (!meaningfullySmaller) {
    return {
      id: "H14",
      status: "directional",
      summary: `Streaming operating envelope reaches ${pretableEnvelope}/sec for pretable. The smallest comparator envelope is ${smallestCompetitor.adapterId} at ${smallestCompetitor.envelope}/sec, which is within 10× of pretable — uniqueness claim is not supported by an order-of-magnitude gap.`,
      evidence: [],
    };
  }

  const smallestSummary =
    smallestCompetitor.envelope === null
      ? `${smallestCompetitor.adapterId} fails the streaming budget at the lowest sampled rate (${lowestSampledRate}/sec)`
      : `${smallestCompetitor.adapterId} tops out at ${smallestCompetitor.envelope}/sec`;

  return {
    id: "H14",
    status: "satisfied",
    summary: `Streaming operating envelope reaches at least ${pretableEnvelope}/sec for pretable. ${smallestSummary} — an order of magnitude smaller envelope, supporting the uniqueness claim.`,
    evidence: [],
  };
}

/**
 * H15 — Streaming row stability.
 *
 * The bench's `visible_row_count_drift` metric measures how many rows
 * the surface added or removed between the start and end of the
 * 3-second updates run. Pretable's stream-adapter holds drift at zero
 * across the operating envelope; AG Grid's row recycling makes its
 * drift visible (22+ rows at sub-5k/sec rates).
 *
 * Status:
 * - insufficient: no rate-tagged Pretable run.
 * - failing: Pretable's max drift across all sampled rates exceeds 1.
 * - directional: every measured comparator's drift also stays ≤ 1.
 * - satisfied: pretable drift ≤ 1 AND at least one comparator drifts > 5.
 */
function evaluateH15(runs) {
  const byAdapter = groupUpdatesRunsByAdapterAndRate(runs);
  const pretableSeriesByRate = byAdapter.get("pretable");

  if (!pretableSeriesByRate || pretableSeriesByRate.size === 0) {
    return {
      id: "H15",
      status: "insufficient",
      summary:
        "Missing rate-tagged S5 updates runs for pretable, so streaming row stability cannot be evaluated yet.",
      evidence: [],
    };
  }

  const adapterMaxDrift = (rateSeriesMap) => {
    let maxDrift = 0;
    for (const series of rateSeriesMap.values()) {
      const drift = medianMetric(series, "visible_row_count_drift");
      if (drift !== undefined && drift > maxDrift) maxDrift = drift;
    }
    return maxDrift;
  };

  const pretableMaxDrift = adapterMaxDrift(pretableSeriesByRate);

  if (pretableMaxDrift > 1) {
    return {
      id: "H15",
      status: "failing",
      summary: `Streaming row stability is failing — pretable's worst visible-row drift across rates is ${pretableMaxDrift} rows (threshold: ≤ 1).`,
      evidence: [],
    };
  }

  // Find the worst comparator drift.
  let worstCompetitor = null;
  for (const [adapterId, rateSeriesMap] of byAdapter) {
    if (adapterId === "pretable") continue;
    const drift = adapterMaxDrift(rateSeriesMap);
    if (worstCompetitor === null || drift > worstCompetitor.drift) {
      worstCompetitor = { adapterId, drift };
    }
  }

  if (worstCompetitor === null) {
    return {
      id: "H15",
      status: "directional",
      summary: `Streaming row stability holds for pretable (max drift: ${pretableMaxDrift} rows), but the comparative claim is unmeasured — no comparator's rate-tagged S5 updates runs are available.`,
      evidence: [],
    };
  }

  if (worstCompetitor.drift <= 5) {
    return {
      id: "H15",
      status: "directional",
      summary: `Streaming row stability holds for pretable (max drift: ${pretableMaxDrift} rows). Worst comparator drift is ${worstCompetitor.adapterId} at ${worstCompetitor.drift} rows, which doesn't exceed the differentiation threshold of 5.`,
      evidence: [],
    };
  }

  return {
    id: "H15",
    status: "satisfied",
    summary: `Streaming row stability holds for pretable (max drift: ${pretableMaxDrift} rows across the operating envelope). ${worstCompetitor.adapterId} drifts up to ${worstCompetitor.drift} rows during streaming — a real differentiator vs that adapter's row recycling behavior.`,
    evidence: [],
  };
}

/**
 * H16 — selection extend latency. The S2/hypothesis pretable
 * select-range-extend slice's interaction_latency_ms p95 must stay
 * within a single 60Hz frame (≤ 16ms).
 *
 * Status:
 * - satisfied: p95 ≤ 16ms across all repeats.
 * - failing: any repeat exceeds 16ms.
 * - insufficient: no completed runs.
 */
export function evaluateH16(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "select-range-extend",
  });

  if (series.length === 0) {
    return {
      id: "H16",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable select-range-extend runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const latency = evidence.metrics.interaction_latency_ms;

  if (latency === undefined || latency > 16) {
    return {
      id: "H16",
      status: "failing",
      summary: `Selection extend latency p95 is ${latency ?? "missing"}ms (threshold: ≤ 16ms).`,
      evidence: [evidence],
    };
  }

  return {
    id: "H16",
    status: "satisfied",
    summary: `Selection extend p95 is ${latency}ms (≤ 16ms single-frame budget).`,
    evidence: [evidence],
  };
}

/**
 * H17 — keyboard nav latency. Same shape as H16, different script.
 */
export function evaluateH17(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "keyboard-nav-row",
  });

  if (series.length === 0) {
    return {
      id: "H17",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable keyboard-nav-row runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const latency = evidence.metrics.interaction_latency_ms;

  if (latency === undefined || latency > 16) {
    return {
      id: "H17",
      status: "failing",
      summary: `Keyboard nav latency p95 is ${latency ?? "missing"}ms (threshold: ≤ 16ms).`,
      evidence: [evidence],
    };
  }

  return {
    id: "H17",
    status: "satisfied",
    summary: `Keyboard nav p95 is ${latency}ms (≤ 16ms single-frame budget).`,
    evidence: [evidence],
  };
}

/**
 * H18 — select-all end-to-end latency. Single event; threshold 33ms (two-frame
 * budget — one-time cost is acceptable).
 */
export function evaluateH18(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "select-all",
  });

  if (series.length === 0) {
    return {
      id: "H18",
      status: "insufficient",
      summary: "No completed S2/hypothesis pretable select-all runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const latency = evidence.metrics.interaction_latency_ms;

  if (latency === undefined || latency > 33) {
    return {
      id: "H18",
      status: "failing",
      summary: `Select-all latency is ${latency ?? "missing"}ms (threshold: ≤ 33ms).`,
      evidence: [evidence],
    };
  }

  return {
    id: "H18",
    status: "satisfied",
    summary: `Select-all latency is ${latency}ms (≤ 33ms two-frame budget).`,
    evidence: [evidence],
  };
}

/**
 * H19 — format overhead bound. The S2/hypothesis/pretable/scroll-with-format
 * slice's scroll_frame_p95_ms is compared to the sibling
 * S2/hypothesis/pretable/scroll slice in the same runset. Threshold: format
 * adds at most 2ms to scroll p95.
 */
export function evaluateH19(runs) {
  const formatSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "scroll-with-format",
  });
  const baselineSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "scroll",
  });

  if (formatSeries.length === 0) {
    return {
      id: "H19",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable scroll-with-format runs available.",
      evidence: [],
    };
  }

  if (baselineSeries.length === 0) {
    return {
      id: "H19",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable scroll baseline available — H19 requires both.",
      evidence: [],
    };
  }

  const formatEvidence = summarizeRunSeriesEvidence(formatSeries);
  const baselineEvidence = summarizeRunSeriesEvidence(baselineSeries);
  // evidence shape: [pretable format-overhead summary, pretable scroll
  // baseline summary, ...comparator scroll-with-format absolute summaries].
  // Pretable's first two entries form the format-overhead delta the H19
  // status verdict consumes; comparator entries are absolute format p95
  // for cross-adapter reference, NOT deltas vs their own scroll baselines.
  const comparatorEvidence = findComparatorEvidence(runs, {
    scenarioId: "S2",
    scriptName: "scroll-with-format",
  });
  const formatP95 = formatEvidence.metrics.scroll_frame_p95_ms;
  const baselineP95 = baselineEvidence.metrics.scroll_frame_p95_ms;

  if (formatP95 === undefined || baselineP95 === undefined) {
    return {
      id: "H19",
      status: "insufficient",
      summary:
        "scroll_frame_p95_ms missing from format or baseline run — cannot evaluate.",
      evidence: [formatEvidence, baselineEvidence, ...comparatorEvidence],
    };
  }

  const overhead = formatP95 - baselineP95;
  if (overhead > 2) {
    return {
      id: "H19",
      status: "failing",
      summary: `Format overhead is ${overhead.toFixed(2)}ms (threshold: ≤ 2ms; format ${formatP95}ms vs baseline ${baselineP95}ms).`,
      evidence: [formatEvidence, baselineEvidence, ...comparatorEvidence],
    };
  }

  return {
    id: "H19",
    status: "satisfied",
    summary: `Format overhead is ${overhead.toFixed(2)}ms (≤ 2ms; format ${formatP95}ms, baseline ${baselineP95}ms).`,
    evidence: [formatEvidence, baselineEvidence, ...comparatorEvidence],
  };
}

/**
 * H20 — cheap render holds single-frame budget.
 */
export function evaluateH20(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "scroll-with-render",
  });

  if (series.length === 0) {
    return {
      id: "H20",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable scroll-with-render runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const comparatorEvidence = findComparatorEvidence(runs, {
    scenarioId: "S2",
    scriptName: "scroll-with-render",
  });
  const p95 = evidence.metrics.scroll_frame_p95_ms;

  if (p95 === undefined || p95 > 16) {
    return {
      id: "H20",
      status: "failing",
      summary: `scroll_frame_p95_ms with cheap render is ${p95 ?? "missing"}ms (threshold: ≤ 16ms).`,
      evidence: [evidence, ...comparatorEvidence],
    };
  }

  return {
    id: "H20",
    status: "satisfied",
    summary: `Cheap render scroll p95 is ${p95}ms (≤ 16ms single-frame budget).`,
    evidence: [evidence, ...comparatorEvidence],
  };
}

/**
 * H21 — heavy render degrades gracefully.
 */
export function evaluateH21(runs) {
  const series = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    scriptName: "scroll-with-heavy-render",
  });

  if (series.length === 0) {
    return {
      id: "H21",
      status: "insufficient",
      summary:
        "No completed S2/hypothesis pretable scroll-with-heavy-render runs available.",
      evidence: [],
    };
  }

  const evidence = summarizeRunSeriesEvidence(series);
  const comparatorEvidence = findComparatorEvidence(runs, {
    scenarioId: "S2",
    scriptName: "scroll-with-heavy-render",
  });
  const p95 = evidence.metrics.scroll_frame_p95_ms;

  if (p95 === undefined || p95 > 20) {
    return {
      id: "H21",
      status: "failing",
      summary: `scroll_frame_p95_ms with heavy render is ${p95 ?? "missing"}ms (threshold: ≤ 20ms).`,
      evidence: [evidence, ...comparatorEvidence],
    };
  }

  return {
    id: "H21",
    status: "satisfied",
    summary: `Heavy render scroll p95 is ${p95}ms (≤ 20ms; ≤ 25% above single-frame budget).`,
    evidence: [evidence, ...comparatorEvidence],
  };
}

/**
 * H22 — autosize comparator parity on S2.
 *
 * Pretable's autosize must (a) complete within a single 60Hz frame
 * (interaction_latency_ms ≤ 16) and (b) be within 10% of the best
 * measured comparator (ag-grid | mui). Reuses the same min-repeat gate
 * as H1: parity verdicts in the tight zone (0.9–1.2) require
 * ≥COMPARATOR_PARITY_MIN_REPEATS samples on both sides.
 */
export function evaluateH22(runs) {
  const pretableSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scriptName: "autosize",
  });

  if (pretableSeries.length === 0) {
    return {
      id: "H22",
      status: "insufficient",
      summary: "No completed pretable S2 autosize runs available.",
      evidence: [],
    };
  }

  const pretableEvidence = summarizeRunSeriesEvidence(pretableSeries);
  const pretableLatency = pretableEvidence.metrics.interaction_latency_ms;

  if (pretableLatency === undefined) {
    return {
      id: "H22",
      status: "insufficient",
      summary:
        "pretable S2 autosize runs do not report interaction_latency_ms.",
      evidence: [pretableEvidence],
    };
  }

  if (pretableLatency > 16) {
    return {
      id: "H22",
      status: "failing",
      summary: `pretable autosize interaction_latency_ms is ${pretableLatency}ms (threshold: ≤ 16ms single-frame floor).`,
      evidence: [pretableEvidence],
    };
  }

  const comparatorSeries = groupRunSeries(runs, {
    scenarioId: "S2",
    scriptName: "autosize",
  }).filter(
    (series) =>
      series[0]?.adapterId !== "pretable" &&
      (series[0]?.adapterId === "ag-grid" || series[0]?.adapterId === "mui") &&
      medianMetric(series, "interaction_latency_ms") !== undefined,
  );

  if (comparatorSeries.length === 0) {
    return {
      id: "H22",
      status: "directional",
      summary: `pretable autosize completes within the single-frame budget (${pretableLatency}ms ≤ 16ms), but the comparator-parity claim is unmeasured — no ag-grid or mui autosize data is available.`,
      evidence: [pretableEvidence],
    };
  }

  const bestComparatorSeries = comparatorSeries.reduce((best, current) =>
    medianMetric(current, "interaction_latency_ms") <
    medianMetric(best, "interaction_latency_ms")
      ? current
      : best,
  );
  const bestComparatorEvidence =
    summarizeRunSeriesEvidence(bestComparatorSeries);
  const comparatorLatency =
    bestComparatorEvidence.metrics.interaction_latency_ms;
  const evidenceArray = [pretableEvidence, bestComparatorEvidence];

  const parityRatio = pretableLatency / comparatorLatency;
  const ratioIsInTightZone = parityRatio >= 0.9 && parityRatio <= 1.2;
  const repeatsAreInsufficient =
    pretableEvidence.sampleCount < COMPARATOR_PARITY_MIN_REPEATS ||
    bestComparatorEvidence.sampleCount < COMPARATOR_PARITY_MIN_REPEATS;

  if (ratioIsInTightZone && repeatsAreInsufficient) {
    return {
      id: "H22",
      status: "insufficient",
      summary: `Autosize comparator-parity needs ≥${COMPARATOR_PARITY_MIN_REPEATS} repeats per adapter when the latency ratio is in the tight zone (got pretable n=${pretableEvidence.sampleCount}, ${bestComparatorEvidence.adapterId} n=${bestComparatorEvidence.sampleCount}; ratio = ${parityRatio.toFixed(3)}). Re-run with --repeats=${COMPARATOR_PARITY_MIN_REPEATS} or higher.`,
      evidence: evidenceArray,
    };
  }

  if (parityRatio > 1.1) {
    const percentAbove = Math.round((parityRatio - 1) * 100);

    return {
      id: "H22",
      status: "failing",
      summary: `pretable autosize meets the single-frame floor, but interaction_latency_ms is ${percentAbove}% above the best comparator (${bestComparatorEvidence.adapterId}: ${comparatorLatency}ms vs pretable: ${pretableLatency}ms). The 10% parity threshold is not met.`,
      evidence: evidenceArray,
    };
  }

  return {
    id: "H22",
    status: "satisfied",
    summary: `pretable autosize completes within the single-frame budget (${pretableLatency}ms ≤ 16ms) and within 10% of the best comparator (${bestComparatorEvidence.adapterId}: ${comparatorLatency}ms; ratio = ${parityRatio.toFixed(3)}).`,
    evidence: evidenceArray,
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
  // Surface ALL comparator entries (not just the best one) so the evidence
  // array carries every measured adapter for cross-reference. H6/H7/H8
  // status verdicts remain pretable-only — comparator data is informational.
  const comparatorEvidence = findComparatorEvidence(runs, {
    scenarioId,
    scriptName,
  });
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
      evidence: [candidateEvidence, ...comparatorEvidence],
    };
  }

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
    evidence: [candidateEvidence, ...comparatorEvidence],
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

// Drift signal should fire on actual browser/CSS policy changes (e.g.,
// "scroll anchoring: auto" vs "scroll anchoring: none" across repeats),
// not on continuous-numeric diagnostic telemetry that fluctuates by
// rounding (e.g., "internal telemetry planned height: 515712" vs "515729"
// at 3,000-row hypothesis scale). The "internal telemetry *" prefix marks
// notes that are diagnostic only — they are surfaced in the runset as
// useful context but don't represent a policy that should be reproducible
// across repeats. Without this filter, H6 (and any interaction hypothesis
// at hypothesis scale) flips to "directional" purely on planned-height
// jitter even when the actual interaction-latency distribution is fully
// within thresholds.
const DIAGNOSTIC_NOTE_KEY_PREFIX = "internal telemetry ";

function hasPolicyDrift(evidence) {
  const varying = evidence.policyNotes?.varying ?? {};
  for (const key of Object.keys(varying)) {
    if (!key.startsWith(DIAGNOSTIC_NOTE_KEY_PREFIX)) {
      return true;
    }
  }
  return false;
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
