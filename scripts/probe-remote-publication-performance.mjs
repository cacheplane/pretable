// Actual public-model default-budget diagnostic. Run: node --import tsx scripts/probe-remote-publication-performance.mjs
import { performance } from "node:perf_hooks";
import { createHook } from "node:async_hooks";
import { loadavg } from "node:os";
import { createRemoteModel } from "../packages/core/src/remote/create-remote-model.ts";
import { remoteGroupId } from "../packages/core/src/remote/query.ts";
import {
  capabilities,
  groupedQuery,
  session,
} from "../packages/core/src/remote/__tests__/fixtures/responses.ts";
const nodeAt = (ordinal) => {
  const route = [{ columnId: "value", key: ordinal }];
  return {
    kind: "group",
    id: remoteGroupId(route),
    route,
    label: String(ordinal),
    childCount: 100,
    aggregates: {},
  };
};
let providerPreparationMs = 0;
const processingSlices = [];
const starts = new Map();
const callbackHook = createHook({
  before(id) {
    starts.set(id, {
      time: performance.now(),
      provider: providerPreparationMs,
    });
  },
  after(id) {
    const start = starts.get(id);
    if (start !== undefined) {
      processingSlices.push(
        performance.now() -
          start.time -
          (providerPreparationMs - start.provider),
      );
      starts.delete(id);
    }
  },
});
const provider = {
  capabilities: { ...capabilities, maxRangeSize: 1000 },
  async open(_query, queryKey) {
    return { ok: true, value: { ...session, queryKey, rootCount: 100000000 } };
  },
  async read(request) {
    const start = performance.now();
    const answer = {
      ok: true,
      value: {
        ...request,
        siblingCount: 100000000,
        entries: Array.from(
          { length: request.end - request.start },
          (_, offset) => nodeAt(request.start + offset),
        ),
      },
    };
    providerPreparationMs += performance.now() - start;
    return answer;
  },
  async release() {},
  async summary() {
    return { ok: false, error: { code: "invalid-response" } };
  },
};
const blockSize = Number(process.env.REMOTE_BLOCK_SIZE ?? 1000);
const model = createRemoteModel(provider, { blockSize });
callbackHook.enable();
await model.setQuery({ ...groupedQuery, aggregates: [] });
const providerBeforeDemand = providerPreparationMs;
const demandStart = performance.now();
const demand = model.demandViewport({ start: 0, end: 5000 });
const demandCommandMs = performance.now() - demandStart;
const demandModelProcessingMs =
  demandCommandMs - (providerPreparationMs - providerBeforeDemand);
await demand;
const fillMs = performance.now() - demandStart;
await new Promise((resolve) => setImmediate(resolve));
callbackHook.disable();
starts.clear();
const initial = model.getDiagnostics();
const expansions = [];
let acceptedExpansions = 0,
  refusal;
for (let index = 0; index < 2048; index++) {
  const start = performance.now();
  if (!model.setExpanded(nodeAt(index).id, true)) {
    refusal = model.getDiagnostics();
    break;
  }
  acceptedExpansions++;
  expansions.push(performance.now() - start);
}
const samples = [];
for (let iteration = 0; iteration < 30; iteration++) {
  const start = performance.now();
  if (
    !model.setExpanded(nodeAt(acceptedExpansions - 1).id, iteration % 2 !== 0)
  )
    throw new Error("Toggle refused");
  samples.push(performance.now() - start);
}
const summarize = (values) => {
  values.sort((a, b) => a - b);
  return {
    min: values[0],
    p50: values[Math.floor(values.length / 2)],
    p95: values[Math.floor(values.length * 0.95)],
    max: values.at(-1),
  };
};
console.log(
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      loadavg: loadavg(),
      blockSize,
      providerDelayMs: 0,
      providerPreparationMs,
      demandCommandMs,
      demandModelProcessingMs,
      fillProcessingCallbacks: summarize(processingSlices),
      initial,
      final: model.getDiagnostics(),
      fillMs,
      acceptedExpansions,
      refusal,
      expansionNearCapacity: summarize(expansions.slice(-48)),
      toggle: summarize(samples),
    },
    null,
    2,
  ),
);
model.dispose();
