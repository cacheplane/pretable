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
