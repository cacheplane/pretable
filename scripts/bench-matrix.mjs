import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getBenchAdapterFamily } from "../shared/bench-adapter-families.js";

const DEFAULT_ADAPTERS = ["pretable", "ag-grid"];
const DEFAULT_REPEATS = 1;
const DEFAULT_SCALE = "dev";
const DEFAULT_SCENARIOS = ["S1", "S2"];
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
      evaluateH1(input.runs),
      evaluateH3(input.runs),
      evaluateH5(input.entries, input.runs),
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

function evaluateH1(runs) {
  const wrappedScrollSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scriptName: "scroll",
  });

  if (wrappedScrollSeries.length === 0) {
    return {
      id: "H1",
      status: "insufficient",
      summary:
        "Missing a completed S2 scroll run, so wrapped-text scroll evidence is not available yet.",
      evidence: [],
    };
  }

  const blankGapFrames = maxMetric(wrappedScrollSeries, "blank_gap_frames");
  const longTasksCount = maxMetric(wrappedScrollSeries, "long_tasks_count");
  const pretableEvidence = summarizeRunSeriesEvidence(wrappedScrollSeries);
  const competitorSeries = groupRunSeries(runs, {
    scenarioId: "S2",
    scriptName: "scroll",
  }).filter(
    (series) =>
      series[0]?.adapterId !== "pretable" &&
      medianMetric(series, "scroll_frame_p95_ms") !== undefined,
  );

  if (blankGapFrames > 0.09 || longTasksCount > 0) {
    const medianBlankGapFrames =
      pretableEvidence.metricSummary?.blank_gap_frames?.median;
    const medianLongTasksCount =
      pretableEvidence.metricSummary?.long_tasks_count?.median;

    return {
      id: "H1",
      status: "failing",
      summary:
        medianBlankGapFrames <= 0.09 && medianLongTasksCount <= 0
          ? "The wrapped-text scroll surface is measured and current medians stay controlled, but worst-case repeats still show blank gaps or long tasks beyond the current benchmark threshold."
          : "The wrapped-text scroll surface is measured, but it still shows blank gaps or long tasks beyond the current benchmark threshold.",
      evidence: [pretableEvidence],
    };
  }

  if (competitorSeries.length === 0) {
    return {
      id: "H1",
      status: "directional",
      summary: hasPolicyDrift(pretableEvidence)
        ? "Wrapped-text scrolling now has direct S2 measurements with no observed blank gaps or long tasks, but policy drift across repeats keeps the result directional rather than claim-ready."
        : "Wrapped-text scrolling now has direct S2 measurements with no observed blank gaps or long tasks, but the required relative win versus a DOM competitor is still unmeasured.",
      evidence: [pretableEvidence],
    };
  }

  const fullGridCompetitorSeries = competitorSeries.filter(
    (series) => getAdapterFamily(series[0]?.adapterId) === "full-grid",
  );
  const primitiveCompetitorSeries = competitorSeries.filter(
    (series) =>
      getAdapterFamily(series[0]?.adapterId) === "virtualization-primitive",
  );
  const primaryCompetitorSeries =
    fullGridCompetitorSeries.length > 0
      ? fullGridCompetitorSeries
      : competitorSeries;
  const bestCompetitorSeries = primaryCompetitorSeries.reduce(
    (best, current) =>
      medianMetric(current, "scroll_frame_p95_ms") <
      medianMetric(best, "scroll_frame_p95_ms")
        ? current
        : best,
  );
  const bestCompetitorEvidence =
    summarizeRunSeriesEvidence(bestCompetitorSeries);
  const bestPrimitiveEvidence =
    fullGridCompetitorSeries.length > 0 && primitiveCompetitorSeries.length > 0
      ? summarizeRunSeriesEvidence(
          primitiveCompetitorSeries.reduce((best, current) =>
            medianMetric(current, "scroll_frame_p95_ms") <
            medianMetric(best, "scroll_frame_p95_ms")
              ? current
              : best,
          ),
        )
      : null;
  const relativeDelta =
    pretableEvidence.metrics.scroll_frame_p95_ms /
      bestCompetitorEvidence.metrics.scroll_frame_p95_ms -
    1;
  const hasRelevantPolicyDrift =
    hasPolicyDrift(pretableEvidence) || hasPolicyDrift(bestCompetitorEvidence);
  const hasRepeatedH1Evidence =
    pretableEvidence.sampleCount > 1 && bestCompetitorEvidence.sampleCount > 1;

  return {
    id: "H1",
    status:
      relativeDelta <= -0.25
        ? hasRelevantPolicyDrift
          ? "directional"
          : "satisfied"
        : "failing",
    summary:
      relativeDelta <= -0.25
        ? hasRelevantPolicyDrift
          ? `Wrapped-text scrolling beats the measured ${describeComparatorFamily(bestCompetitorEvidence.adapterFamily)} comparator on current medians, but policy drift across repeats keeps the result directional rather than reproducible.`
          : hasRepeatedH1Evidence
            ? `Wrapped-text scrolling beats the best measured ${describeComparatorFamily(bestCompetitorEvidence.adapterFamily)} comparator by at least 25% on current repeated-run medians while keeping blank gaps and long tasks controlled.`
            : `Wrapped-text scrolling beats the best measured ${describeComparatorFamily(bestCompetitorEvidence.adapterFamily)} comparator by at least 25% on the current sample while keeping blank gaps and long tasks controlled.`
        : `Wrapped-text scrolling is measured against a ${describeComparatorFamily(bestCompetitorEvidence.adapterFamily)} comparator, but it has not yet cleared the required 25% relative win.`,
    evidence: [
      pretableEvidence,
      bestCompetitorEvidence,
      ...(bestPrimitiveEvidence ? [bestPrimitiveEvidence] : []),
    ],
  };
}

function evaluateH3(runs) {
  const wrappedScrollSeries = findRunSeries(runs, {
    adapterId: "pretable",
    scenarioId: "S2",
    scriptName: "scroll",
  });

  if (wrappedScrollSeries.length === 0) {
    return {
      id: "H3",
      status: "insufficient",
      summary:
        "Missing a completed S2 scroll run, so variable-height stability cannot be evaluated yet.",
      evidence: [],
    };
  }

  const rowHeightError = maxMetric(
    wrappedScrollSeries,
    "row_height_error_p95_px",
  );
  const pretableEvidence = summarizeRunSeriesEvidence(wrappedScrollSeries);
  const anchorShift =
    maxMetric(wrappedScrollSeries, "scroll_anchor_shift_backward_p95_px") ??
    maxMetric(wrappedScrollSeries, "scroll_anchor_shift_px");

  if (rowHeightError === undefined || anchorShift === undefined) {
    return {
      id: "H3",
      status: "insufficient",
      summary:
        "S2 scrolling is measured, but row-height error and scroll-anchor shift are still missing, so backward-scroll stability is not claim-ready.",
      evidence: [pretableEvidence],
    };
  }

  return {
    id: "H3",
    status:
      rowHeightError <= 4 &&
      anchorShift <= 16 &&
      maxMetric(wrappedScrollSeries, "blank_gap_frames") === 0
        ? hasPolicyDrift(pretableEvidence)
          ? "directional"
          : "satisfied"
        : "failing",
    summary:
      rowHeightError <= 4 &&
      anchorShift <= 16 &&
      maxMetric(wrappedScrollSeries, "blank_gap_frames") === 0
        ? hasPolicyDrift(pretableEvidence)
          ? "Variable-height scrolling stays within the current thresholds on current medians, but policy drift across repeats keeps the stability claim directional rather than reproducible."
          : pretableEvidence.sampleCount > 1
            ? "Variable-height scrolling stays within the current row-height and anchor-shift thresholds on current repeated-run medians."
            : "Variable-height scrolling stays within the current row-height and anchor-shift thresholds on the current sample."
        : hasMedianStableButWorstCaseExceeded(pretableEvidence, {
              rowHeightErrorThreshold: 4,
              anchorShiftThreshold: 16,
              blankGapThreshold: 0,
            })
          ? "Variable-height scrolling is instrumented and current medians stay within thresholds, but worst-case repeats still exceed the row-height, anchor-shift, or blank-gap limits."
          : "Variable-height scrolling is instrumented, but at least one stability threshold is still failing.",
    evidence: [pretableEvidence],
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

function hasMedianStableButWorstCaseExceeded(
  evidence,
  { rowHeightErrorThreshold, anchorShiftThreshold, blankGapThreshold },
) {
  const rowHeight = evidence.metricSummary?.row_height_error_p95_px;
  const anchorShift =
    evidence.metricSummary?.scroll_anchor_shift_backward_p95_px ??
    evidence.metricSummary?.scroll_anchor_shift_px;
  const blankGap = evidence.metricSummary?.blank_gap_frames;

  return (
    rowHeight?.median <= rowHeightErrorThreshold &&
    rowHeight?.max > rowHeightErrorThreshold &&
    anchorShift?.median <= anchorShiftThreshold &&
    anchorShift?.max > anchorShiftThreshold &&
    blankGap?.median <= blankGapThreshold
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
