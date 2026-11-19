// Actual public-model default-budget diagnostic. Run: node --import tsx scripts/probe-remote-publication-performance.mjs
import { performance } from "node:perf_hooks";
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
const provider = {
  capabilities: { ...capabilities, maxRangeSize: 1000 },
  async open(_query, queryKey) {
    return { ok: true, value: { ...session, queryKey, rootCount: 100000000 } };
  },
  async read(request) {
    return {
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
  },
};
const model = createRemoteModel(provider, { blockSize: 1000 });
await model.setQuery({ ...groupedQuery, aggregates: [] });
const demandStart = performance.now();
await model.demandViewport({ start: 0, end: 5000 });
const fillMs = performance.now() - demandStart;
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
