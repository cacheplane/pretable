import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateMemorySamples,
  leastSquaresSlope,
} from "../bench-row-model-memory.mjs";
import { waitForOwnedServer } from "../owned-preview.mjs";

const cleanRetention = {
  liveRevisionRootCount: 1,
  explicitlyRetainedSnapshotCount: 0,
  consumerJournalEntryCount: 32,
  transitionCandidateRootCount: 0,
  transitionDeltaRootCount: 0,
  distinctCacheEntryCount: 4,
  distinctDictionaryRootCount: 4,
  distinctProjectionRootCount: 0,
  scheduledCallbackCount: 0,
};

test("calculates least-squares retained bytes per revision", () => {
  const samples = [0, 2_000, 4_000, 6_000].map((revision) => ({
    revision,
    heapBytes: 10_000_000 + revision * 128,
  }));
  assert.equal(leastSquaresSlope(samples), 128);
  assert.equal(evaluateMemorySamples(samples, cleanRetention).status, "PASS");
});

test("rejects excessive growth, slope, and retained ownership", () => {
  const samples = [
    { revision: 0, heapBytes: 10_000_000 },
    { revision: 10_000, heapBytes: 30_000_000 },
  ];
  const result = evaluateMemorySamples(samples, {
    ...cleanRetention,
    transitionCandidateRootCount: 1,
  });
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.failures, [
    "heap-growth",
    "heap-slope",
    "transition-candidate",
  ]);
});

test("rejects a foreign response when the owned preview exits", async () => {
  const child = { exitCode: null };
  await assert.rejects(
    waitForOwnedServer("http://127.0.0.1:4173", child, {
      fetchImpl: async () => ({ ok: true }),
      delay: async () => {
        child.exitCode = 1;
      },
    }),
    /exited/,
  );
});
