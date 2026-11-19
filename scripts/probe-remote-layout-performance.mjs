// Local diagnostic, not a release benchmark. Run with node --import tsx.
import { performance } from "node:perf_hooks";
import { loadavg, cpus } from "node:os";
import {
  RemoteMetrics,
  RemoteLayoutAdapter,
} from "../packages/renderer-dom/src/remote-layout.ts";
import { SparseIndex } from "../packages/core/src/remote/sparse-index.ts";
import { ModelRetention } from "../packages/core/src/remote/model-retention.ts";
import { remoteGroupId } from "../packages/core/src/remote/query.ts";
import { createModelView } from "../packages/core/src/remote/model-view.ts";
import {
  capabilities,
  query,
  session,
} from "../packages/core/src/remote/__tests__/fixtures/responses.ts";
const time = (fn) => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};
const summarize = (values) => {
  values.sort((a, b) => a - b);
  return {
    min: values[0],
    p50: values[Math.floor(values.length / 2)],
    p95: values[Math.floor(values.length * 0.95)],
    max: values.at(-1),
  };
};
let resolutions = 0;
const metrics = new RemoteMetrics(100000000, 20, 100000, (id) => {
  resolutions++;
  return Number(id);
});
const populateMs = time(() =>
  metrics.measureBatch(
    Array.from({ length: 100000 }, (_, i) => ({ id: String(i), height: 21 })),
  ),
);
const samples = [];
let work = 0;
for (let run = 0; run < 110; run++) {
  resolutions = 0;
  const ms = time(() =>
    metrics.measureBatch(
      Array.from({ length: 50 }, (_, i) => ({
        id: String(i),
        height: 22 + (run % 2),
      })),
    ),
  );
  if (run >= 10) samples.push(ms);
  work = resolutions;
}
const pending = metrics.prepareSync(100000000, (id) => Number(id) + 1);
const slices = [];
let done = false;
while (!done) {
  slices.push(
    time(() => {
      done = pending.advance(128);
    }),
  );
}
const syncCommitMs = time(() => pending.commit());
const groups = Array.from({ length: 8191 }, (_, ordinal) => ({
  id: String(ordinal),
  ordinal,
  parent: null,
  childCount: 100,
}));
const topology = [];
let topologyWork = 0;
for (let run = 0; run < 25; run++)
  topology.push(
    time(() => {
      const index = new SparseIndex(100000000);
      index.resolveBatch(
        groups,
        groups.slice(0, 2048).map((group) => group.id),
      );
      topologyWork = index.preparationWork;
    }),
  );
const nodes = Array.from({ length: 100000 }, (_, id) => ({
  kind: "leaf",
  id,
  row: { value: id },
}));
const ranges = Array.from({ length: 100 }, (_, block) => ({
  ...session,
  rootCount: 100000000,
  route: [],
  start: block * 1000,
  end: (block + 1) * 1000,
  siblingCount: 100000000,
  entries: nodes.slice(block * 1000, (block + 1) * 1000),
}));
const retention = new ModelRetention({});
const state = {
  state: "ready",
  generation: 1,
  view: {
    session: { ...session, rootCount: 100000000 },
    ranges,
    summaries: [],
  },
};
const views = [];
let view;
for (let run = 0; run < 10; run++)
  views.push(
    time(() => {
      view = createModelView(
        state,
        retention,
        query,
        capabilities,
        new Set(),
        new Set(),
        1000,
      );
    }),
  );
const adapter = new RemoteLayoutAdapter({
  estimate: 20,
  measurementCap: 100000,
});
const prepared = adapter.prepare(view);
const adapterSlices = [];
done = false;
while (!done)
  adapterSlices.push(
    time(() => {
      done = prepared.advance(128);
    }),
  );
const adapterCommitMs = time(() => prepared.commit());
const invalidationMs = time(() => metrics.invalidateMeasurements());
const defaultGroups = Array.from({ length: 8191 }, (_, ordinal) => {
  const route = [{ columnId: "value", key: ordinal }];
  return {
    id: remoteGroupId(route),
    ordinal,
    parent: null,
    childCount: 100,
    route,
  };
});
const defaultRetention = new ModelRetention({});
defaultRetention.groups = new Map(
  defaultGroups.map((group) => [group.id, group]),
);
defaultRetention.expanded = new Set(
  defaultGroups.slice(0, 2048).map((group) => group.id),
);
const defaultNodes = defaultGroups.slice(0, 5000).map((group) => ({
  kind: "group",
  id: group.id,
  route: group.route,
  label: String(group.ordinal),
  childCount: 100,
  aggregates: {},
}));
const defaultRanges = Array.from({ length: 50 }, (_, block) => ({
  ...session,
  rootCount: 100000000,
  route: [],
  start: block * 100,
  end: (block + 1) * 100,
  siblingCount: 100000000,
  entries: defaultNodes.slice(block * 100, (block + 1) * 100),
}));
const defaultState = {
  ...state,
  view: { ...state.view, ranges: defaultRanges },
};
const defaultViews = [];
let defaultView;
for (let run = 0; run < 110; run++) {
  const ms = time(() => {
    defaultView = createModelView(
      defaultState,
      defaultRetention,
      query,
      capabilities,
      new Set(),
      new Set(),
      100,
    );
  });
  if (run >= 10) defaultViews.push(ms);
}
const defaultAdapter = new RemoteLayoutAdapter({
  estimate: 20,
  measurementCap: 100000,
});
const defaultPrepared = defaultAdapter.prepare(defaultView);
const defaultSlices = [];
done = false;
while (!done)
  defaultSlices.push(
    time(() => {
      done = defaultPrepared.advance(128);
    }),
  );
const defaultCommitMs = time(() => defaultPrepared.commit());
console.log(
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      loadavg: loadavg(),
      logicalCPUs: cpus().length,
      populateMs,
      measurementBatch50: { ...summarize(samples), resolutions: work },
      measurementSync128: summarize(slices),
      syncCommitMs,
      topology8191: { ...summarize(topology), descriptorVisits: topologyWork },
      modelView100000: summarize(views),
      adapterPreparation128: summarize(adapterSlices),
      adapterCommitMs,
      invalidationMs,
      default5000With8191Topology: {
        view: summarize(defaultViews),
        adapterSlices: summarize(defaultSlices),
        commitMs: defaultCommitMs,
      },
    },
    null,
    2,
  ),
);
