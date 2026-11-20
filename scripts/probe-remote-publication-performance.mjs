// Actual public-model default-budget diagnostic. Run: node --import tsx scripts/probe-remote-publication-performance.mjs
import { performance } from "node:perf_hooks";
import { createHook } from "node:async_hooks";
import { loadavg, cpus } from "node:os";
import { createRemoteModel } from "../packages/core/src/remote/create-remote-model.ts";
import { ModelRetention } from "../packages/core/src/remote/model-retention.ts";
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
const resourceTypes = new Map();
const turns = [];
let turn = { kind: "initial", processingMs: 0, commits: 0 };
const admissionCommits = [];
const originalPrepare = ModelRetention.prototype.prepareSteps;
ModelRetention.prototype.prepareSteps = function* (input) {
  const plan = yield* originalPrepare.call(this, input);
  if (
    plan &&
    input.additions?.some(
      (record) =>
        record.kind === "payload" || record.key.startsWith("summary:"),
    )
  ) {
    const commit = plan.commit;
    plan.commit = () => {
      const start = performance.now();
      const accepted = commit();
      if (accepted) {
        turn.commits++;
        queueMicrotask(() => admissionCommits.push(performance.now() - start));
      }
      return accepted;
    };
  }
  return plan;
};
const callbackHook = createHook({
  init(id, type) {
    resourceTypes.set(id, type);
  },
  destroy(id) {
    resourceTypes.delete(id);
  },
  before(id) {
    const type = resourceTypes.get(id);
    if (type === "Timeout" || type === "Immediate") {
      turns.push(turn);
      turn = { kind: type, processingMs: 0, commits: 0 };
    }
    starts.set(id, {
      time: performance.now(),
      provider: providerPreparationMs,
    });
  },
  after(id) {
    const start = starts.get(id);
    if (start !== undefined) {
      const duration =
        performance.now() -
        start.time -
        (providerPreparationMs - start.provider);
      processingSlices.push(duration);
      turn.processingMs += duration;
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
const loadBefore = loadavg();
try {
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
  resourceTypes.clear();
  turns.push(turn);
  ModelRetention.prototype.prepareSteps = originalPrepare;
  const initial = model.getDiagnostics();
  if (initial.payloadEntries !== 5000 || initial.topology !== 5001)
    throw new Error("Publication probe did not admit the required residency");
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
      count: values.length,
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
        node: process.version,
        logicalCpus: cpus().length,
        loadBefore,
        loadavg: loadavg(),
        blockSize,
        providerDelayMs: 0,
        providerPreparationMs,
        demandCommandMs,
        demandModelProcessingMs,
        fillProcessingCallbacks: summarize(processingSlices),
        admissionCommitMs: summarize(admissionCommits),
        scheduledPreparationTurnMs: summarize(
          turns
            .filter((turn) => turn.kind === "Timeout" && turn.commits === 0)
            .map((turn) => turn.processingMs),
        ),
        commitTurnMs: summarize(
          turns
            .filter((turn) => turn.commits > 0)
            .map((turn) => turn.processingMs),
        ),
        longestTurns: [...turns]
          .sort((a, b) => b.processingMs - a.processingMs)
          .slice(0, 5),
        allProcessingTurnMs: summarize(turns.map((turn) => turn.processingMs)),
        instrumentation:
          "async_hooks callback CPU sums grouped until next Timeout/Immediate; fresh commit tasks separated from preparation tasks; commit from payload plan.commit through queued microtask after synchronous publication; all instrumentation overhead included",
        initial,
        final: model.getDiagnostics(),
        fillMs,
        acceptedExpansions,
        refusal,
        measurementSamples: {
          admissionCommitMs: [...admissionCommits],
          commitTurnMs: turns
            .filter((turn) => turn.commits > 0)
            .map((turn) => turn.processingMs),
          expansionNearCapacityMs: expansions.slice(-48),
          toggleMs: [...samples],
        },
        expansionNearCapacity: summarize(expansions.slice(-48)),
        toggle: summarize(samples),
      },
      null,
      2,
    ),
  );
} finally {
  callbackHook.disable();
  starts.clear();
  resourceTypes.clear();
  ModelRetention.prototype.prepareSteps = originalPrepare;
  model.dispose();
}
