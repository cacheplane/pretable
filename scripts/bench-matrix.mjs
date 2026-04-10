import { mkdir, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DEFAULT_SCENARIOS = ["S1", "S2"];
const DEFAULT_SCRIPTS = ["initial", "scroll"];
const BENCH_BASE_URL = "http://127.0.0.1:4173";

export function parseBenchMatrixArgs(args) {
  const parsed = {
    scenarios: DEFAULT_SCENARIOS,
    scripts: DEFAULT_SCRIPTS,
    passthroughArgs: [],
  };

  for (const arg of args) {
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
  return parsedArgs.scenarios.flatMap((scenarioId) =>
    parsedArgs.scripts.map((scriptName) => ({
      scenarioId,
      scriptName,
    })),
  );
}

export function createBenchRunsetManifest(input) {
  return {
    runsetId: input.runsetId,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    entries: input.entries,
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

    await writeRunsetManifest(
      createBenchRunsetManifest({
        runsetId,
        startedAt,
        completedAt: new Date().toISOString(),
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

async function writeRunsetManifest(manifest) {
  const manifestsDir = path.join(process.cwd(), "status", "runsets");
  const manifestPath = path.join(manifestsDir, `${manifest.runsetId}.json`);

  await mkdir(manifestsDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function sanitizeTimestamp(timestamp) {
  return timestamp.toLowerCase().replaceAll(/[:.]/g, "-");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await run();
}
