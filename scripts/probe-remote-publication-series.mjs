import { publicationGate } from "./publication-probe-accounting.mjs";
// Independent full-residency repetitions, serially on the same host.
// Run: node scripts/probe-remote-publication-series.mjs > result.json
import { spawnSync } from "node:child_process";
const count = Number(process.env.REMOTE_PROBE_RUNS ?? 3);
if (!Number.isSafeInteger(count) || count < 1 || count > 20)
  throw new RangeError("Expected 1–20 probe runs");
const groups = [];
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor(sorted.length * 0.95)],
    max: sorted.at(-1),
  };
};
for (const blockSize of [1000, 100]) {
  const runs = [];
  for (let index = 0; index < count; index++) {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/probe-remote-publication-performance.mjs"],
      {
        env: { ...process.env, REMOTE_BLOCK_SIZE: String(blockSize) },
        encoding: "utf8",
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    if (result.status !== 0)
      throw new Error(result.stderr || `Probe exit ${result.status}`);
    runs.push(JSON.parse(result.stdout));
  }
  const commit = stats(
    runs.flatMap((run) => run.measurementSamples.commitTurnMs),
  );
  const expansion = stats(
    runs.flatMap((run) => run.measurementSamples.expansionNearCapacityMs),
  );
  const toggle = stats(runs.flatMap((run) => run.measurementSamples.toggleMs));
  const admissionSamples = runs.flatMap(
    (run) => run.measurementSamples.admissionCommitMs,
  );
  const observedGate = publicationGate(
    admissionSamples,
    runs.flatMap((run) => run.measurementSamples.preparationMs),
  );
  observedGate.row_model_commit_p95_ms = Math.max(
    observedGate.row_model_commit_p95_ms,
    expansion.p95,
    toggle.p95,
  );
  observedGate.pass =
    observedGate.row_model_commit_p95_ms <= 8 &&
    observedGate.rebuild_slice_max_ms <= 8;
  groups.push({
    blockSize,
    independentRuns: count,
    admissionCommit: stats(
      runs.flatMap((run) => run.measurementSamples.admissionCommitMs),
    ),
    commitTurn: commit,
    expansionNearCapacity: expansion,
    toggle,
    observedGate,
    runs,
  });
}
console.log(
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      quietHostCertified: false,
      note: "Diagnostic repetitions; quiet-host certification requires independently established host conditions. Commit maxima and all-turn maxima are retained without replacing the approved p95 commit rule.",
      groups,
    },
    null,
    2,
  ),
);
