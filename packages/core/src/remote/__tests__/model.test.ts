import { describe, expect, it } from "vitest";
import { createRemoteModel } from "../create-remote-model";
import { createDeferredProvider } from "./fixtures/provider";
import {
  capabilities,
  query,
  session,
  type Row,
  type Columns,
} from "./fixtures/responses";
import { remoteGroupId } from "../query";
import type { PretableRemoteNode, PretableRemoteQuery } from "../types";

const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function setup(
  options: Parameters<typeof createRemoteModel<Row, Columns>>[1] = {},
) {
  const f = createDeferredProvider<Row, Columns>(capabilities);
  const model = createRemoteModel(f.provider, { blockSize: 2, ...options });
  async function open(index = 0, rootCount = 4) {
    const request = f.opens[index]!.request;
    f.opens[index]!.resolve({
      ok: true,
      value: {
        ...session,
        queryKey: request.queryKey,
        sessionId: `s${index}`,
        rootCount,
      },
    });
    await tick();
  }
  async function read(
    index: number,
    entries?: readonly PretableRemoteNode<Row>[],
    siblingCount?: number,
  ) {
    const request = f.reads[index]!.request;
    const count = siblingCount ?? request.rootCount;
    f.reads[index]!.resolve({
      ok: true,
      value: {
        ...request,
        siblingCount: count,
        entries:
          entries ??
          Array.from(
            {
              length: Math.max(0, Math.min(request.end, count) - request.start),
            },
            (_, i) => ({
              kind: "leaf",
              id: request.start + i,
              row: { value: request.start + i },
            }),
          ),
      },
    });
    await tick();
  }
  async function ready(
    q: PretableRemoteQuery<Columns> = query,
    rootCount = 4,
    entries?: readonly PretableRemoteNode<Row>[],
  ) {
    const pending = model.setQuery(q);
    await open(0, rootCount);
    await read(0, entries);
    await pending;
  }
  return { ...f, model, open, read, ready };
}

describe("headless remote read model", () => {
  it("publishes an atomic root and pure immutable reads over a huge extent", async () => {
    const f = setup();
    let publications = 0;
    const off = f.model.subscribe(() => publications++);
    expect(f.model.getSnapshot().displayCount).toBe(0);
    await f.ready(query, 1_000_000_000);
    const before = f.model.getSnapshot();
    expect(before.displayCount).toBe(1_000_000_000);
    expect(before.rootCount).toBe(1_000_000_000);
    expect(before.residentCount).toBe(2);
    expect(before.readSlot(999_999_999)).toMatchObject({
      kind: "unloaded",
      ordinal: 999_999_999,
    });
    expect([...before.loadedEntries()]).toHaveLength(2);
    expect(f.reads).toHaveLength(1);
    const demand = f.model.demandViewport({
      start: 999_999_998,
      end: 1_000_000_000,
    });
    expect(f.model.readSlot(999_999_999)?.kind).toBe("loading");
    await f.read(1);
    await demand;
    expect(f.model.readSlot(999_999_999)?.kind).toBe("loaded");
    expect(before.readSlot(999_999_999)?.kind).toBe("unloaded");
    off();
    const seen = publications;
    f.model.dispose();
    expect(publications).toBe(seen);
    expect(f.model.getSnapshot().displayCount).toBe(0);
  });
  it("deduplicates demand and cancels obsolete viewport without accepting late data", async () => {
    const f = setup();
    await f.ready(query, 20);
    const a = f.model.demandViewport({ start: 4, end: 6 });
    const same = f.model.demandViewport({ start: 4, end: 6 });
    expect(f.reads).toHaveLength(2);
    const b = f.model.demandViewport({ start: 10, end: 12 });
    expect(f.reads[1]!.signal.aborted).toBe(true);
    await f.read(1);
    await f.read(2);
    await Promise.all([a, same, b]);
    expect(f.model.readSlot(4)?.kind).toBe("unloaded");
    f.model.dispose();
  });
  it("evicts payload and validator evidence together, then refetches the same version", async () => {
    const f = setup({ limits: { payloadEntries: 2 } });
    await f.ready(query, 20);
    let p = f.model.demandViewport({ start: 8, end: 10 });
    await f.read(1);
    await p;
    expect(f.model.readSlot(0)?.kind).toBe("unloaded");
    expect(f.model.getDiagnostics()).toMatchObject({
      payloadEntries: 2,
      evidenceNodes: 2,
    });
    p = f.model.demandViewport({ start: 0, end: 2 });
    await f.read(2);
    await p;
    expect(f.model.readSlot(0)?.kind).toBe("loaded");
    f.model.dispose();
  });
  it("persists capacity refusal without a refetch loop and retries explicitly", async () => {
    const f = setup({ limits: { payloadEntries: 1 } });
    await f.ready();
    expect(f.model.getDiagnostics().capacity).toBeDefined();
    expect(f.model.getDiagnostics().evidenceNodes).toBe(0);
    await f.model.demandViewport({ start: 0, end: 2 });
    await f.model.demandViewport({ start: 0, end: 2 });
    expect(f.reads).toHaveLength(1);
    const retry = f.model.retry();
    await f.open(1);
    await f.read(1);
    await retry;
    expect(f.reads).toHaveLength(2);
    f.model.dispose();
  });
  it("keeps expanded topology after group payload eviction and collapse cancels demand", async () => {
    const f = setup({ limits: { payloadEntries: 2 } });
    const q = {
      ...query,
      rowGroups: [{ columnId: "value" as const }],
      groupSort: [
        {
          level: 0,
          by: "key" as const,
          direction: "asc" as const,
          nulls: "first" as const,
          comparison: "binary@1",
        },
      ],
    };
    const route = [{ columnId: "value", key: 1 }];
    const id = remoteGroupId(route);
    await f.ready(q, 1, [
      {
        kind: "group",
        id,
        route,
        label: "one",
        childCount: 10,
        aggregates: {},
      },
    ]);
    expect(f.model.setExpanded(id, true)).toBe(true);
    expect(f.model.getSnapshot().displayCount).toBe(11);
    let p = f.model.demandViewport({ start: 5, end: 7 });
    await f.read(1, undefined, 10);
    await p;
    expect(f.model.readSlot(0)?.kind).toBe("unloaded");
    expect(f.model.getSnapshot().displayCount).toBe(11);
    p = f.model.demandViewport({ start: 9, end: 11 });
    expect(f.reads[2]!.request.route).toEqual(route);
    f.model.setExpanded(id, false);
    expect(f.model.getSnapshot().displayCount).toBe(1);
    expect(f.reads[2]!.signal.aborted).toBe(true);
    await f.read(2, undefined, 10);
    await p;
    expect(f.model.getSnapshot().displayCount).toBe(1);
    f.model.dispose();
  });
  it("holds ingress after cancelled ignored-abort transport and releases late opens on disposal", async () => {
    const f = setup({ limits: { responseBytes: 1024, ingressBytes: 1024 } });
    const a = f.model.setQuery(query);
    const b = f.model.setQuery({ ...query, search: "next" });
    expect(f.opens).toHaveLength(1);
    expect(f.model.getDiagnostics().ingressBytes).toBe(1024);
    await f.open(0);
    await a;
    await tick();
    expect(f.opens).toHaveLength(2);
    f.model.dispose();
    await f.open(1);
    await b;
    await tick();
    expect(f.released).toHaveLength(2);
    expect(f.model.getDiagnostics().ingressBytes).toBe(0);
    expect(f.model.getDiagnostics().payloadEntries).toBe(0);
  });
});

it("purges source/auth data even when replacement query metadata cannot fit", async () => {
  const f = setup({ limits: { metadataBytes: 30_000 } });
  await f.ready();
  const pending = f.model.setQuery({
    ...query,
    authScope: "new",
    search: "x".repeat(30_000),
  });
  expect(f.model.readSlot(0)).toBeUndefined();
  expect(f.model.getSnapshot().displayCount).toBe(0);
  await pending;
  expect(f.model.getDiagnostics().capacity).toBeDefined();
  expect(f.opens).toHaveLength(1);
  f.model.dispose();
});
it("rejects throwing or reentrant sizing without retaining evidence or reviving disposal", async () => {
  let dispose = () => {};
  const f = setup({
    estimateResponseBytes: () => {
      dispose();
      throw new Error("size");
    },
  });
  dispose = () => f.model.dispose();
  await f.ready();
  expect(f.model.getSnapshot().status.state).toBe("disposed");
  expect(f.model.getDiagnostics()).toMatchObject({
    payloadEntries: 0,
    evidenceNodes: 0,
    ingressBytes: 0,
  });
});
it("keeps no stale body history across repeated query handovers and charges physical old queries", async () => {
  const f = setup({ limits: { payloadEntries: 2 } });
  await f.ready();
  const old = f.model.getSnapshot();
  const p = f.model.setQuery({ ...query, search: "B" });
  expect(f.model.getSnapshot().status.state).toBe("stale");
  expect(f.model.getSnapshot().readSlot(0)?.kind).toBe("loaded");
  await f.open(1);
  await f.read(1);
  await p;
  expect(f.model.getDiagnostics()).toMatchObject({
    scopes: 1,
    payloadEntries: 2,
    evidenceNodes: 2,
  });
  expect(old.readSlot(0)?.kind).toBe("loaded");
  f.model.dispose();
  expect(f.model.getDiagnostics()).toMatchObject({
    scopes: 0,
    metadataBytes: 0,
  });
});
it("publishes empty roots atomically without fake slots", async () => {
  const f = setup();
  await f.ready(query, 0);
  expect(f.model.getSnapshot()).toMatchObject({
    displayCount: 0,
    residentCount: 0,
    rootCount: 0,
  });
  expect(f.model.getSnapshot().status.state).toBe("ready");
  expect(f.model.readSlot(0)).toBeUndefined();
  expect([...f.model.getSnapshot().loadedEntries()]).toEqual([]);
  f.model.dispose();
});
it("bounds failed page history and reports value-free range errors", async () => {
  const f = setup();
  await f.ready(query, 1000);
  for (let i = 1; i < 20; i++) {
    const p = f.model.demandViewport({ start: i * 2, end: i * 2 + 2 });
    f.reads[i]!.resolve({ ok: false, error: { code: "timeout" } });
    await p;
    expect(f.model.readSlot(i * 2)).toMatchObject({
      kind: "error",
      error: { code: "timeout" },
    });
    expect(f.model.getDiagnostics().metadataBytes).toBeLessThan(30_000);
  }
  expect(f.model.readSlot(2)?.kind).toBe("unloaded");
  f.model.dispose();
});

it("drops denied branch topology and expansion after parent payload eviction, preserving other branches", async () => {
  const f = setup({ blockSize: 1, limits: { payloadEntries: 1 } });
  const q = {
    ...query,
    rowGroups: [{ columnId: "value" as const }],
    groupSort: [
      {
        level: 0,
        by: "key" as const,
        direction: "asc" as const,
        nulls: "first" as const,
        comparison: "binary@1",
      },
    ],
  };
  const routes = [1, 2].map((key) => [{ columnId: "value", key }]);
  const ids = routes.map(remoteGroupId);
  const groups = routes.map((route, i) => ({
    kind: "group" as const,
    id: ids[i]!,
    route,
    label: String(i),
    childCount: 3,
    aggregates: {},
  }));
  await f.ready(q, 2, [groups[0]!]);
  f.model.setExpanded(ids[0]!, true);
  let p = f.model.demandViewport({ start: 4, end: 5 });
  await f.read(1, [groups[1]!]);
  await p;
  f.model.setExpanded(ids[1]!, true);
  p = f.model.demandViewport({ start: 1, end: 2 });
  await f.read(2, undefined, 3);
  await p;
  expect(f.model.getSnapshot().displayCount).toBe(8);
  p = f.model.demandViewport({ start: 0, end: 1 });
  f.reads[3]!.resolve({
    ok: false,
    error: { code: "unauthorized", scope: "range" },
  });
  await p;
  expect(f.model.getSnapshot().displayCount).toBe(5);
  expect(f.model.getDiagnostics().expansions).toBe(1);
  expect(f.model.readSlot(0)).toMatchObject({ kind: "error" });
  f.model.dispose();
});

it("keeps summary scopes coherent through width changes, definition changes and late answers", async () => {
  const f = setup();
  const q = {
    ...query,
    aggregates: [{ columnId: "value" as const, id: "sum" }],
  };
  await f.ready(q);
  const filtered = f.model.requestSummary("filtered");
  const all = f.model.requestSummary("all");
  const definitionKey = (await import("../query")).remoteAggregateDefinitionKey(
    "1",
    "value",
    "sum",
  );
  const answer = (index: number, value: number) => {
    const request = f.summaries[index]!.request;
    f.summaries[index]!.resolve({
      ok: true,
      value: {
        ...request.session,
        scope: request.scope,
        registryVersion: "1",
        aggregateIds: ["sum"],
        authority: "server",
        completeness: "complete",
        values: {
          sum: {
            aggregateDefinitionKey: definitionKey,
            authority: "server",
            state: "ready",
            completeness: "complete",
            value,
          },
        },
      },
    });
  };
  answer(0, 0);
  answer(1, 20);
  await Promise.all([filtered, all]);
  expect(f.model.getSnapshot().getSummary("filtered")).toMatchObject({
    state: "ready",
    summary: { values: { sum: { value: 0 } } },
  });
  // Width is presentation state outside the strict remote query contract.
  await f.model.setQuery({ ...q });
  expect(f.opens).toHaveLength(1);
  expect(f.model.getSnapshot().getSummary("all")).toMatchObject({
    state: "ready",
    summary: { values: { sum: { value: 20 } } },
  });
  const next = f.model.setQuery({ ...q, registryVersion: "2" });
  await f.open(1);
  await f.read(1);
  await next;
  expect(f.model.getSnapshot().getSummary("filtered")).toEqual({
    state: "unavailable",
  });
  f.model.dispose();
});
it("retries summary errors explicitly and never calls an unsupported all scope", async () => {
  const f = setup();
  await f.ready();
  const p = f.model.requestSummary("filtered");
  f.summaries[0]!.resolve({ ok: false, error: { code: "timeout" } });
  await p;
  expect(f.model.getSnapshot().getSummary("filtered")).toEqual({
    state: "error",
    error: { code: "timeout" },
  });
  const retry = f.model.retry();
  expect(f.summaries).toHaveLength(2);
  f.summaries[1]!.resolve({ ok: false, error: { code: "timeout" } });
  await retry;
  f.model.dispose();
  const provider = createDeferredProvider<Row, Columns>({
    ...capabilities,
    summaries: { filtered: "same-version", all: "unavailable" },
  });
  const model = createRemoteModel(provider.provider);
  await model.requestSummary("all");
  expect(provider.summaries).toHaveLength(0);
  expect(model.getSnapshot().getSummary("all")).toEqual({
    state: "unavailable",
  });
  model.dispose();
});
it("charges and releases bounded subscription metadata", async () => {
  const f = setup();
  await f.ready();
  const initial = f.model.getDiagnostics().metadataBytes;
  const off = f.model.subscribe(() => {});
  expect(f.model.getDiagnostics().metadataBytes).toBeGreaterThan(initial);
  off();
  expect(f.model.getDiagnostics().metadataBytes).toBe(initial);
  f.model.dispose();
});
it("refuses impossible ingress immediately without dispatch or timeout wait", async () => {
  const f = setup({ limits: { ingressBytes: 1, responseBytes: 1024 } });
  const pending = f.model.setQuery(query);
  await tick();
  expect(f.model.getDiagnostics().capacity).toBeDefined();
  expect(f.opens).toHaveLength(0);
  f.model.dispose();
  await pending;
});

it("keeps same-scope invalid-query stale data charged and clears invalid scope changes", async () => {
  const f = setup();
  await f.ready();
  await f.model.setQuery({ ...query, locale: "" });
  expect(f.model.getSnapshot().status.state).toBe("stale");
  expect(f.model.getSnapshot().residentCount).toBe(
    f.model.getDiagnostics().payloadEntries,
  );
  await f.model.setQuery({ ...query, authScope: "new", locale: "" });
  expect(f.model.getSnapshot().residentCount).toBe(0);
  expect(f.model.getDiagnostics().payloadEntries).toBe(0);
  f.model.dispose();
});
it("keeps rejected cached replacements coherent after a sizing hook reenters a query change", async () => {
  let change: (() => void) | undefined;
  const f = setup({
    estimateResponseBytes: () => {
      change?.();
      return 100;
    },
  });
  await f.ready();
  let next: Promise<void> | undefined;
  change = () => {
    change = undefined;
    next = f.model.setQuery({ ...query, search: "new" });
  };
  const pending = f.model.demandViewport({ start: 2, end: 4 });
  await f.read(1);
  await pending;
  expect(f.model.getSnapshot().status.state).toBe("stale");
  expect(f.model.getDiagnostics().evidenceNodes).toBe(2);
  await f.open(1);
  await f.read(2);
  await next;
  expect(f.model.getSnapshot().status.state).toBe("ready");
  f.model.dispose();
});

it("bounds aligned demand count even when an offset viewport spans 65 blocks", async () => {
  const f = setup();
  await f.ready(query, 1000);
  const p = f.model.demandViewport({ start: 1, end: 129 });
  expect(f.model.getDiagnostics().capacity).toBe("minimum-visible-too-large");
  expect(f.reads).toHaveLength(1);
  f.model.dispose();
  await p;
});
it("keeps valid query configuration charged after a root protocol failure", async () => {
  const f = setup();
  const p = f.model.setQuery(query);
  await f.open();
  f.reads[0]!.resolve({ ok: false, error: { code: "invalid-response" } });
  await p;
  expect(f.model.getSnapshot().status.state).toBe("error");
  expect(f.model.getDiagnostics().metadataBytes).toBeGreaterThan(0);
  f.model.dispose();
  await tick();
  expect(f.model.getDiagnostics().metadataBytes).toBe(0);
});

it("updates the immutable view when subscription metadata evicts cold payload", async () => {
  const f = setup({ limits: { metadataBytes: 20_000 } });
  await f.ready();
  await f.model.demandViewport({ start: 0, end: 0 });
  for (let i = 0; i < 100; i++) {
    try {
      f.model.subscribe(() => {});
    } catch {
      break;
    }
    expect(f.model.getSnapshot().residentCount).toBe(
      f.model.getDiagnostics().payloadEntries,
    );
  }
  f.model.dispose();
});
it("refuses subscription overflow explicitly and releases listeners on disposal", () => {
  const f = setup();
  const off = Array.from({ length: 256 }, () => f.model.subscribe(() => {}));
  expect(() => f.model.subscribe(() => {})).toThrow(
    "Remote subscription capacity",
  );
  off[0]!();
  expect(() => f.model.subscribe(() => {})).not.toThrow();
  f.model.dispose();
  expect(f.model.getDiagnostics()).toMatchObject({
    listeners: 0,
    metadataBytes: 0,
  });
});

it("never checks expiry or dispatches from synchronous observation", async () => {
  let nowCalls = 0;
  const f = setup({
    now: () => {
      nowCalls++;
      return 0;
    },
  });
  const p = f.model.setQuery(query);
  const request = f.opens[0]!.request;
  f.opens[0]!.resolve({
    ok: true,
    value: { ...session, queryKey: request.queryKey, expiresAt: 100 },
  });
  await tick();
  await f.read(0);
  await p;
  const calls = nowCalls;
  for (let i = 0; i < 20; i++) {
    f.model.getSnapshot();
    f.model.getStatus();
    f.model.getDiagnostics();
    f.model.readSlot(3);
    void [...f.model.getSnapshot().loadedEntries()];
    f.model.getSnapshot().getSummary("all");
  }
  expect(nowCalls).toBe(calls);
  expect(f.reads).toHaveLength(1);
  f.model.checkExpiry();
  expect(nowCalls).toBeGreaterThan(calls);
  f.model.dispose();
});
it("discards late old-session summary answers after a new root is published", async () => {
  const f = setup();
  await f.ready();
  const summary = f.model.requestSummary("filtered");
  const next = f.model.setQuery({ ...query, search: "B" });
  await f.open(1);
  await f.read(1);
  await next;
  const request = f.summaries[0]!.request;
  f.summaries[0]!.resolve({
    ok: true,
    value: {
      ...request.session,
      scope: "filtered",
      registryVersion: "1",
      aggregateIds: [],
      authority: "server",
      completeness: "complete",
      values: {},
    },
  });
  await summary;
  await tick();
  expect(f.model.getSnapshot().getSummary("filtered")).toEqual({
    state: "unavailable",
  });
  expect(f.model.getDiagnostics().ingressBytes).toBe(0);
  f.model.dispose();
});
it("defaults to 100 siblings and rejects blocks above the supported maximum", async () => {
  const f = createDeferredProvider<Row, Columns>({
    ...capabilities,
    maxRangeSize: 10_000,
  });
  const model = createRemoteModel(f.provider);
  const p = model.setQuery(query);
  f.opens[0]!.resolve({
    ok: true,
    value: { ...session, queryKey: f.opens[0]!.request.queryKey },
  });
  await tick();
  expect(f.reads[0]!.request.end).toBe(100);
  model.dispose();
  f.reads[0]!.resolve({ ok: false, error: { code: "cancelled" } });
  await p;
  expect(() => createRemoteModel(f.provider, { blockSize: 1001 })).toThrow(
    RangeError,
  );
});

it("keeps a capacity diagnostic through unrelated subscription changes", async () => {
  const f = setup({ limits: { payloadEntries: 1 } });
  await f.ready();
  const capacity = f.model.getDiagnostics().capacity;
  const off = f.model.subscribe(() => {});
  expect(f.model.getDiagnostics().capacity).toBe(capacity);
  off();
  f.model.dispose();
});

it("restarts when a rejected query is corrected back to the prior valid query", async () => {
  const f = setup();
  await f.ready();
  await f.model.setQuery({ ...query, locale: "" });
  const p = f.model.setQuery(query);
  expect(f.opens).toHaveLength(2);
  await f.open(1);
  await f.read(1);
  await p;
  expect(f.model.getSnapshot().status.state).toBe("ready");
  f.model.dispose();
});

it("retries only locally refused summaries and publishes cleared capacity, including empty roots", async () => {
  let refuse = true;
  const f = setup({
    estimateResponseBytes: (value) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "scope" in value &&
        refuse
      )
        throw new Error("size");
      return 100;
    },
  });
  await f.ready(query, 0);
  const respond = (index: number) => {
    const request = f.summaries[index]!.request;
    f.summaries[index]!.resolve({
      ok: true,
      value: {
        ...request.session,
        scope: request.scope,
        registryVersion: "1",
        aggregateIds: [],
        authority: "server",
        completeness: "complete",
        values: {},
      },
    });
  };
  const first = f.model.requestSummary("filtered");
  respond(0);
  await first;
  expect(f.model.getSnapshot().getSummary("filtered").state).toBe(
    "unavailable",
  );
  expect(f.model.getSnapshot().capacity).toBe("invalid-cost");
  refuse = false;
  const retry = f.model.retry();
  expect(f.summaries).toHaveLength(2);
  expect(f.summaries[1]!.request.scope).toBe("filtered");
  expect(f.model.getSnapshot().capacity).toBeUndefined();
  expect(f.model.getDiagnostics().capacity).toBeUndefined();
  respond(1);
  await retry;
  expect(f.model.getSnapshot().getSummary("filtered").state).toBe("ready");
  expect(f.opens).toHaveLength(1);
  await f.model.retry();
  expect(f.summaries).toHaveLength(2);
  f.model.dispose();
});

it("refuses viewport metadata atomically while retaining prior admitted demand", async () => {
  const f = setup({ limits: { metadataBytes: 20_000 } });
  await f.ready(query, 1000);
  const old = f.model.demandViewport({ start: 2, end: 4 });
  expect(f.reads).toHaveLength(2);
  const metadata = f.model.getDiagnostics().metadataBytes;
  await f.model.demandViewport({ start: 100, end: 228 });
  expect(f.model.getDiagnostics().capacity).toBeDefined();
  expect(f.model.getDiagnostics().metadataBytes).toBe(metadata);
  expect(f.reads[1]!.signal.aborted).toBe(false);
  expect(f.model.readSlot(2)?.kind).toBe("loading");
  await f.model.demandViewport({ start: 100, end: 228 });
  expect(f.reads).toHaveLength(2);
  await f.read(1);
  await old;
  expect(f.model.readSlot(2)?.kind).toBe("loaded");
  f.model.dispose();
});
