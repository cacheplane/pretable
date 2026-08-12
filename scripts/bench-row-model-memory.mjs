import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";

import { createBenchPreviewLaunch } from "./bench-matrix.mjs";
import {
  previewArgsForPort,
  reserveAvailablePort,
  waitForOwnedServer,
} from "./owned-preview.mjs";

export const MEMORY_LIMITS = Object.freeze({
  growthBytes: 16 * 1024 * 1024,
  slopeBytesPerRevision: 256,
  journalEntries: 32,
  dictionaryEntries: 4,
});

export function leastSquaresSlope(samples) {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new TypeError("At least two memory samples are required.");
  }
  const xMean =
    samples.reduce((sum, sample) => sum + sample.revision, 0) / samples.length;
  const yMean =
    samples.reduce((sum, sample) => sum + sample.heapBytes, 0) / samples.length;
  let numerator = 0;
  let denominator = 0;
  for (const sample of samples) {
    const x = sample.revision - xMean;
    numerator += x * (sample.heapBytes - yMean);
    denominator += x * x;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

export function evaluateMemorySamples(
  samples,
  retention,
  limits = MEMORY_LIMITS,
) {
  const baseline = samples[0]?.heapBytes;
  const final = samples.at(-1)?.heapBytes;
  if (!Number.isFinite(baseline) || !Number.isFinite(final)) {
    throw new TypeError("Memory samples require finite heap byte counts.");
  }
  const growthBytes = final - baseline;
  const slopeBytesPerRevision = leastSquaresSlope(samples);
  const failures = [];
  if (growthBytes > limits.growthBytes) failures.push("heap-growth");
  if (slopeBytesPerRevision > limits.slopeBytesPerRevision)
    failures.push("heap-slope");
  if (retention.liveRevisionRootCount !== 1) failures.push("live-revisions");
  if (retention.explicitlyRetainedSnapshotCount !== 0)
    failures.push("snapshots");
  if (retention.transitionCandidateRootCount !== 0)
    failures.push("transition-candidate");
  if (retention.transitionDeltaRootCount !== 0)
    failures.push("transition-deltas");
  if (retention.consumerJournalEntryCount > limits.journalEntries)
    failures.push("journal-bound");
  if (retention.distinctCacheEntryCount > limits.dictionaryEntries)
    failures.push("dictionary-cache-bound");
  if (retention.distinctDictionaryRootCount > limits.dictionaryEntries)
    failures.push("dictionary-root-bound");
  if (retention.distinctProjectionRootCount !== 0)
    failures.push("distinct-projection");
  if (retention.scheduledCallbackCount !== 0)
    failures.push("scheduled-callback");
  return Object.freeze({
    status: failures.length === 0 ? "PASS" : "FAIL",
    growthBytes,
    slopeBytesPerRevision,
    failures: Object.freeze(failures),
  });
}

async function collectGarbageAndSample(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  const usage = await cdp.send("Runtime.getHeapUsage");
  return usage.usedSize;
}

async function run() {
  const workspace = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const launch = createBenchPreviewLaunch(workspace);
  const port = await reserveAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const build = spawnSync(launch.build.command, launch.build.args, {
    cwd: launch.build.cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (build.status !== 0) throw new Error("Production bench build failed.");
  const server = spawn(
    launch.preview.command,
    previewArgsForPort(launch.preview.args, port),
    {
      cwd: launch.preview.cwd,
      env: process.env,
      stdio: "inherit",
    },
  );
  let browser;
  try {
    await waitForOwnedServer(baseUrl, server);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");
    await page.goto(
      `${baseUrl}/?adapter=pretable&scenario=S5&scale=local-max&script=updates-grouped&diagnostics=row-model&seed=505`,
      { waitUntil: "networkidle" },
    );
    await page.waitForFunction(
      () => window.__PRETABLE_ROW_MODEL_BENCH__ !== undefined,
    );

    const exerciseWindow = (revisionCount) =>
      page.evaluate(async (count) => {
        const controller = window.__PRETABLE_ROW_MODEL_BENCH__;
        if (controller === undefined)
          throw new Error("Missing row-model diagnostics controller.");
        const transition = controller.startQueryCandidate();
        controller.cancelQueryCandidate();
        await transition?.finished.catch(() => undefined);
        const cancelledDistinct = controller.startDistinctDictionary("col_1");
        controller.cancelDistinctDictionary();
        await cancelledDistinct.finished.catch(() => undefined);
        controller.churnRevisions(count);
        for (const column of controller.columns.slice(0, 5)) {
          await controller.model.distinctValues(column.id, { limit: 1 })
            .finished;
        }
        await Promise.resolve();
        return controller.read().retention;
      }, revisionCount);

    await exerciseWindow(2_000);
    const samples = [
      { revision: 0, heapBytes: await collectGarbageAndSample(cdp) },
    ];
    let retention;
    for (let window = 1; window <= 5; window += 1) {
      retention = await exerciseWindow(2_000);
      samples.push({
        revision: window * 2_000,
        heapBytes: await collectGarbageAndSample(cdp),
      });
    }
    const result = evaluateMemorySamples(samples, retention, MEMORY_LIMITS);
    const metadata = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
    }));
    const commit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: workspace,
      encoding: "utf8",
    }).stdout.trim();
    const report = Object.freeze({
      status: result.status,
      commit,
      seed: 505,
      scale: "local-max",
      grouped: true,
      warmupRevisions: 2_000,
      windowRevisions: 2_000,
      windows: 5,
      samples,
      retention,
      limits: MEMORY_LIMITS,
      ...result,
      metadata,
    });
    const output = path.join(
      workspace,
      "status",
      "runsets",
      "row-model-memory.json",
    );
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `row-model memory gate: ${result.status}; growth=${result.growthBytes}; slope=${result.slopeBytesPerRevision.toFixed(2)} bytes/revision; report=status/runsets/row-model-memory.json\n`,
    );
    if (result.status !== "PASS") process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await run();
