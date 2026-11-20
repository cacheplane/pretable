import { afterEach, expect, it, vi } from "vitest";
import { createRemoteModel } from "../create-remote-model";
import { SparseIndex } from "../sparse-index";
import {
  capabilities,
  groupedQuery,
  session,
  type Row,
  type Columns,
} from "./fixtures/responses";
import { remoteGroupId } from "../query";

afterEach(() => vi.restoreAllMocks());
async function ready(rootCount = 1) {
  const route = [{ columnId: "value", key: 1 }];
  const id = remoteGroupId(route);
  const model = createRemoteModel<Row, Columns>(
    {
      capabilities,
      async open(_query, queryKey) {
        return {
          ok: true as const,
          value: { ...session, queryKey, rootCount },
        };
      },
      async read(request) {
        return {
          ok: true as const,
          value: {
            ...request,
            siblingCount: rootCount,
            entries: Array.from(
              { length: Math.min(request.end, rootCount) - request.start },
              (_, offset) => {
                const nodeRoute = [
                  { columnId: "value", key: request.start + offset + 1 },
                ];
                return {
                  kind: "group" as const,
                  id: remoteGroupId(nodeRoute),
                  route: nodeRoute,
                  label: "1",
                  childCount: 2,
                  aggregates: {},
                };
              },
            ),
          },
        };
      },
      async release() {},
      async summary() {
        return {
          ok: false as const,
          error: { code: "invalid-response" as const },
        };
      },
    },
    { blockSize: 1 },
  );
  await model.setQuery({ ...groupedQuery, aggregates: [] });
  return { model, id };
}
it("constructs one immutable geometry per expansion and reuses it during publication", async () => {
  const { model, id } = await ready();
  const before = model.getSnapshot();
  const builds = vi.spyOn(SparseIndex.prototype, "resolveBatch");
  expect(model.setExpanded(id, true)).toBe(true);
  expect(builds).toHaveBeenCalledTimes(1);
  expect(model.getSnapshot().displayCount).toBe(3);
  expect(before.displayCount).toBe(1);
  expect(before.readSlot(1)).toBeUndefined();
  builds.mockClear();
  const expanded = model.getSnapshot();
  expect(model.setExpanded(id, false)).toBe(true);
  expect(builds).toHaveBeenCalledTimes(1);
  expect(model.getSnapshot().displayCount).toBe(1);
  expect(expanded.readSlot(1)?.kind).toBe("unloaded");
  model.dispose();
});

it("metadata-only preparation does not resubmit resident payload or topology", async () => {
  const { model, id } = await ready();
  const { RemoteCache } = await import("../cache");
  const prepare = vi.spyOn(RemoteCache.prototype, "prepare");
  const before = model.getSnapshot();
  const unsubscribe = model.subscribe(() => {});
  expect(
    prepare.mock.calls
      .flatMap(([input]) => input.records)
      .every((record) => record.kind === "external"),
  ).toBe(true);
  expect(model.getSnapshot()).toBe(before);
  prepare.mockClear();
  expect(model.setExpanded(id, true)).toBe(true);
  expect(
    prepare.mock.calls
      .flatMap(([input]) => input.records)
      .map((record) => record.kind),
  ).toEqual(["expansion"]);
  unsubscribe();
  model.dispose();
});

it("admits a response without revalidating already accepted topology records", async () => {
  const { model } = await ready(2);
  const { RemoteCache } = await import("../cache");
  const prepare = vi.spyOn(RemoteCache.prototype, "prepare");
  await model.demandViewport({ start: 0, end: 2 });
  expect(model.getDiagnostics().payloadEntries).toBe(2);
  const topology = prepare.mock.calls
    .flatMap(([input]) => input.records)
    .filter((record) => record.kind === "topology");
  expect(topology).toHaveLength(1);
  model.dispose();
});

it("keeps previously published geometry readable after disposal and source replacement", async () => {
  const { model, id } = await ready();
  model.setExpanded(id, true);
  const before = model.getSnapshot();
  const child = before.readSlot(1);
  const replacing = model.setQuery({
    ...groupedQuery,
    source: "replacement",
    aggregates: [],
  });
  expect(before.readSlot(1)).toEqual(child);
  await replacing;
  model.dispose();
  expect(before.readSlot(1)).toEqual(child);
  expect(before.displayCount).toBe(3);
});

it("failed preparation supersedes the previous candidate without retaining commit authority", async () => {
  const { RemoteCache } = await import("../cache");
  const cache = new RemoteCache();
  cache.openScope(1);
  const first = cache.prepare({
    records: [{ scope: 1, key: "first", kind: "external", value: {} }],
  });
  expect(first.ok).toBe(true);
  const refused = cache.prepare({
    records: [
      {
        scope: 1,
        key: "oversize",
        kind: "external",
        value: {},
        metadataBytes: 9 * 1024 * 1024,
      },
    ],
  });
  expect(refused.ok).toBe(false);
  expect(first.ok && cache.commit(first.plan)).toBe(false);
  expect(cache.snapshot().records).toBe(0);
});

it("stages geometry atomically and rejects superseded or closed-scope candidates", async () => {
  const { ModelRetention } = await import("../model-retention");
  const retention = new ModelRetention<Row>({});
  retention.begin(1);
  const route = [{ columnId: "value", key: 1 }];
  const id = remoteGroupId(route);
  const range = {
    ...session,
    route: [],
    start: 0,
    end: 1,
    siblingCount: 1,
    entries: [
      {
        kind: "group" as const,
        id,
        route,
        label: "1",
        childCount: 2,
        aggregates: {},
      },
    ],
  };
  const root = retention.prepare({
    root: true,
    additions: [retention.responseRecord(1, range, true)],
  });
  expect(root).toBeDefined();
  root!.index(1);
  expect(retention.visible).toBe(0);
  expect(root!.commit()).toBe(true);
  const before = retention.index(1);
  const expanded = retention.prepare({
    expanded: new Set([id]),
    additions: [
      { scope: -1, key: `expanded:${id}`, kind: "expansion", value: id },
    ],
  });
  expect(expanded!.index(1).rowCount).toBe(3);
  expect(retention.index(1)).toBe(before);
  const replacement = retention.prepare({
    additions: [{ scope: -1, key: "metadata", kind: "external", value: null }],
  });
  expect(expanded!.commit()).toBe(false);
  expect(replacement!.commit()).toBe(true);
  expect(retention.index(1).rowCount).toBe(1);
  const closing = retention.prepare({ expanded: new Set([id]) });
  closing!.index(1);
  retention.close(1);
  expect(closing!.commit()).toBe(false);
  expect(retention.groups.size).toBe(0);
  expect(before.rowCount).toBe(1);
  expect(before.at(0)).toEqual({ parent: null, ordinal: 0 });
});

it("validates a root request without rebuilding retained row evidence", async () => {
  const { createResponseValidator } = await import("../validate-response");
  const { query } = await import("./fixtures/responses");
  const acceptedSession = { ...session, rootCount: 1000 };
  const validator = createResponseValidator<Row, Columns>(
    query,
    acceptedSession,
  );
  const request = { ...acceptedSession, route: [], start: 0, end: 1000 };
  expect(
    validator.acceptRange(request, {
      ...request,
      siblingCount: 1000,
      entries: Array.from({ length: 1000 }, (_, id) => ({
        kind: "leaf" as const,
        id,
        row: { value: id },
      })),
    }).ok,
  ).toBe(true);
  const writes = vi.spyOn(Map.prototype, "set");
  expect(validator.validateRequest(request).ok).toBe(true);
  expect(writes.mock.calls.length).toBeLessThanOrEqual(4);
});

it("new range validation does not recreate maps for every retained row", async () => {
  const { createResponseValidator } = await import("../validate-response");
  const { query } = await import("./fixtures/responses");
  const acceptedSession = { ...session, rootCount: 2000 };
  const validator = createResponseValidator<Row, Columns>(
    query,
    acceptedSession,
  );
  const request = { ...acceptedSession, route: [], start: 0, end: 1000 };
  expect(
    validator.acceptRange(request, {
      ...request,
      siblingCount: 2000,
      entries: Array.from({ length: 1000 }, (_, id) => ({
        kind: "leaf" as const,
        id,
        row: { value: id },
      })),
    }).ok,
  ).toBe(true);
  const next = { ...request, start: 1000, end: 1001 };
  const writes = vi.spyOn(Map.prototype, "set");
  expect(
    validator.acceptRange(next, {
      ...next,
      siblingCount: 2000,
      entries: [{ kind: "leaf", id: 1000, row: { value: 1000 } }],
    }).ok,
  ).toBe(true);
  expect(writes.mock.calls.length).toBeLessThanOrEqual(8);
});

it("keeps typed and signed-zero evidence distinct through overlap replacement and eviction", async () => {
  const { createResponseValidator } = await import("../validate-response");
  const { query } = await import("./fixtures/responses");
  const acceptedSession = { ...session, rootCount: 7 };
  const validator = createResponseValidator<Row, Columns>(
    query,
    acceptedSession,
  );
  const request = { ...acceptedSession, route: [], start: 0, end: 6 };
  const entries = [0, -0, "0", 1, "1", -1].map((id, value) => ({
    kind: "leaf" as const,
    id,
    row: { value },
  }));
  const full = { ...request, siblingCount: 7, entries };
  expect(validator.acceptRange(request, full).ok).toBe(true);
  expect(validator.acceptRange(request, full).ok).toBe(true);
  const overlap = { ...full, end: 3, entries: entries.slice(0, 3) };
  expect(validator.acceptRange(overlap, overlap).ok).toBe(true);
  validator.releaseRange([], 0, 6);
  const moved = { ...full, start: 6, end: 7, entries: [entries[0]!] };
  expect(validator.acceptRange(moved, moved)).toEqual({
    ok: false,
    error: { code: "consistency" },
  });
  validator.releaseRange([], 0, 3);
  expect(validator.acceptRange(moved, moved).ok).toBe(true);
  validator.dispose();
  expect(validator.retention()).toEqual({ nodes: 0, counts: 0, summaries: 0 });
});

it("plans a viewport by sibling spans rather than visiting every loaded row", async () => {
  const { model } = await ready(2);
  // At this fixture's block size1 there are2 demanded spans. Geometry lookup
  // has one bounded span result per block and no render-time provider work.
  const spans = vi.spyOn(SparseIndex.prototype, "spanAt");
  await model.demandViewport({ start: 0, end: 2 });
  expect(spans).toHaveBeenCalledTimes(2);
  model.dispose();
});

it("sibling spans stop at expanded child boundaries and preserve safe integer ranks", () => {
  const index = new SparseIndex(Number.MAX_SAFE_INTEGER - 3);
  index.resolveBatch(
    [{ id: "group", parent: null, ordinal: 1, childCount: 3 }],
    ["group"],
  );
  expect(index.spanAt(0)).toEqual({ parent: null, ordinal: 0, end: 2 });
  expect(index.spanAt(2)).toEqual({ parent: "group", ordinal: 0, end: 5 });
  expect(index.spanAt(5)).toEqual({
    parent: null,
    ordinal: 2,
    end: Number.MAX_SAFE_INTEGER,
  });
  expect(index.spanAt(Number.MAX_SAFE_INTEGER)).toBeUndefined();
});

it("keeps response preparation unpublished and releases its stage on disposal", async () => {
  vi.useFakeTimers();
  try {
    const { createDeferredProvider } = await import("./fixtures/provider");
    const { query } = await import("./fixtures/responses");
    const f = createDeferredProvider<Row, Columns>({
      ...capabilities,
      maxRangeSize: 1000,
    });
    const model = createRemoteModel(f.provider, { blockSize: 1000 });
    const pending = model.setQuery(query);
    f.opens[0]!.resolve({
      ok: true,
      value: {
        ...session,
        queryKey: f.opens[0]!.request.queryKey,
        rootCount: 1000,
      },
    });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const request = f.reads[0]!.request;
    f.reads[0]!.resolve({
      ok: true,
      value: {
        ...request,
        siblingCount: 1000,
        entries: Array.from({ length: 1000 }, (_, id) => ({
          kind: "leaf",
          id,
          row: { value: id },
        })),
      },
    });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const during = model.getSnapshot();
    const ingress = model.getDiagnostics().ingressBytes;
    model.dispose();
    await pending;
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(during.residentCount).toBe(0);
    expect(during.status.state).toBe("loading");
    expect(ingress).toBe(16 * 1024 * 1024);
    expect(model.getDiagnostics().ingressBytes).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("invalidated retention candidates release geometry preparation authority immediately", async () => {
  const { ModelRetention } = await import("../model-retention");
  const retention = new ModelRetention<Row>({});
  retention.begin(1);
  const plan = retention.prepare({
    additions: [{ scope: 1, key: "metadata", kind: "external", value: null }],
  })!;
  plan.discard();
  const build = vi.spyOn(SparseIndex.prototype, "resolveBatch");
  expect(() => plan.index(1)).toThrow("Invalidated remote candidate");
  expect(build).not.toHaveBeenCalled();
});

it("drops cooperative retention candidates on a newer metadata transaction without publishing them", async () => {
  const { ModelRetention } = await import("../model-retention");
  const retention = new ModelRetention<Row>({});
  retention.begin(1);
  const range = {
    ...session,
    route: [],
    start: 0,
    end: 2000,
    siblingCount: 2000,
    entries: Array.from({ length: 2000 }, (_, id) => ({
      kind: "leaf" as const,
      id,
      row: { value: id },
    })),
  };
  const steps = retention.prepareSteps({
    root: true,
    additions: [retention.responseRecord(1, range, true)],
  });
  expect(steps.next().done).toBe(false);
  expect(retention.cache.snapshot().payloadEntries).toBe(0);
  retention.dropGlobal("unrelated");
  expect(steps.next()).toEqual({ done: true, value: undefined });
  expect(retention.visible).toBe(0);
  expect(retention.cache.snapshot().payloadEntries).toBe(0);
});

it("rejects a response whose cooperative acceptance crosses the transport's monotonic deadline", async () => {
  vi.useFakeTimers();
  try {
    const { createDeferredProvider } = await import("./fixtures/provider");
    const { query } = await import("./fixtures/responses");
    const f = createDeferredProvider<Row, Columns>({
      ...capabilities,
      maxRangeSize: 1000,
    });
    const model = createRemoteModel(f.provider, { blockSize: 1000 });
    const pending = model.setQuery(query);
    f.opens[0]!.resolve({
      ok: true,
      value: {
        ...session,
        queryKey: f.opens[0]!.request.queryKey,
        rootCount: 1000,
      },
    });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(29999);
    const request = f.reads[0]!.request;
    f.reads[0]!.resolve({
      ok: true,
      value: {
        ...request,
        siblingCount: 1000,
        entries: Array.from({ length: 1000 }, (_, id) => ({
          kind: "leaf",
          id,
          row: { value: id },
        })),
      },
    });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await vi.runAllTimersAsync();
    await pending;
    expect(model.getSnapshot().residentCount).toBe(0);
    expect(model.getSnapshot().error?.code).toBe("timeout");
    expect(model.getDiagnostics().ingressBytes).toBe(0);
    model.dispose();
  } finally {
    vi.useRealTimers();
  }
});

it("builds candidate sparse geometry cooperatively without mutating the accepted index", () => {
  const index = new SparseIndex(2000);
  const groups = Array.from({ length: 2000 }, (_, ordinal) => ({
    id: String(ordinal),
    parent: null,
    ordinal,
    childCount: 2,
  }));
  const steps = index.resolveBatchSteps(groups, ["0"]);
  expect(steps.next().done).toBe(false);
  expect(index.rowCount).toBe(2000);
  expect(index.allocatedNodes).toBe(1);
  steps.return();
  expect(index.rowCount).toBe(2000);
  expect(index.allocatedNodes).toBe(1);
  const accepted = index.resolveBatchSteps(groups, ["0"]);
  while (!accepted.next().done) {
    /* Bounded primitive work can be scheduled. */
  }
  expect(index.rowCount).toBe(2002);
  expect(index.at(1)).toEqual({ parent: "0", ordinal: 0 });
});

it("closes a suspended geometry builder when its candidate is superseded", async () => {
  const { ModelRetention } = await import("../model-retention");
  const retention = new ModelRetention<Row>({});
  retention.begin(1);
  const route = [{ columnId: "value", key: 1 }];
  const range = {
    ...session,
    route: [],
    start: 0,
    end: 1,
    siblingCount: 1,
    entries: [
      {
        kind: "group" as const,
        id: remoteGroupId(route),
        route,
        label: "1",
        childCount: 2,
        aggregates: {},
      },
    ],
  };
  const plan = retention.prepare({
    root: true,
    additions: [retention.responseRecord(1, range, true)],
  })!;
  const steps = plan.indexSteps(1);
  expect(steps.next().done).toBe(false);
  retention.dropGlobal("unrelated");
  expect(steps.next()).toEqual({ done: true, value: undefined });
  expect(plan.commit()).toBe(false);
  expect(retention.visible).toBe(0);
});

it("rebases an owned response after metadata changes and an identical query during retention preparation", async () => {
  vi.useFakeTimers();
  try {
    const { createDeferredProvider } = await import("./fixtures/provider");
    const { query } = await import("./fixtures/responses");
    const { ModelRetention } = await import("../model-retention");
    const f = createDeferredProvider<Row, Columns>({
      ...capabilities,
      maxRangeSize: 1000,
    });
    const model = createRemoteModel(f.provider, { blockSize: 1000 });
    const pending = model.setQuery(query);
    f.opens[0]!.resolve({
      ok: true,
      value: {
        ...session,
        queryKey: f.opens[0]!.request.queryKey,
        rootCount: 1000,
      },
    });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    let preparing = false;
    const original = ModelRetention.prototype.prepareSteps;
    vi.spyOn(ModelRetention.prototype, "prepareSteps").mockImplementation(
      function (this: InstanceType<typeof ModelRetention>, input) {
        if (input.additions?.some((record) => record.kind === "payload"))
          preparing = true;
        return original.call(this, input);
      },
    );
    const request = f.reads[0]!.request;
    f.reads[0]!.resolve({
      ok: true,
      value: {
        ...request,
        siblingCount: 1000,
        entries: Array.from({ length: 1000 }, (_, id) => ({
          kind: "leaf",
          id,
          row: { value: id },
        })),
      },
    });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    for (let i = 0; i < 100 && !preparing; i++)
      await vi.advanceTimersToNextTimerAsync();
    const during = model.getSnapshot();
    const off = model.subscribe(() => {});
    await model.setQuery(query);
    off();
    await vi.runAllTimersAsync();
    await pending;
    expect(during.residentCount).toBe(0);
    expect(model.getSnapshot().residentCount).toBe(1000);
    expect(model.getSnapshot().status.state).toBe("ready");
    expect(f.reads).toHaveLength(1);
    expect(model.getDiagnostics().ingressBytes).toBe(0);
    model.dispose();
  } finally {
    vi.useRealTimers();
  }
});
