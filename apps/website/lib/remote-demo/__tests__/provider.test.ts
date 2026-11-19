import { describe, expect, it } from "vitest";
import {
  prepareRemoteQuery,
  remoteLeafId,
  type PretableRemoteResult,
  type PretableRemoteSession,
  type PretableRemoteRoute,
} from "@pretable/core";
import { createOrdersDataset, demoOrders } from "../dataset";
import {
  createOrdersProvider,
  ordersQuery,
  type OrdersQuery,
} from "../provider";

const signal = () => new AbortController().signal;
function value<T>(result: PretableRemoteResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const failure = (code: string) => ({ ok: false, error: { code } });
async function open(
  provider: ReturnType<typeof createOrdersProvider>,
  query: OrdersQuery = ordersQuery,
) {
  const prepared = prepareRemoteQuery(query, provider.capabilities);
  if (!prepared.ok) throw new Error(prepared.error.code);
  return value(await provider.open(query, prepared.queryKey, signal()));
}
async function read(
  provider: ReturnType<typeof createOrdersProvider>,
  session: PretableRemoteSession,
  route: PretableRemoteRoute = [],
  start = 0,
  end = 100,
) {
  return value(
    await provider.read({ ...session, route, start, end }, signal()),
  );
}

describe("bounded orders reference provider (fixture only)", () => {
  it("orders equal aggregate groups by stable typed route, and preserves null leaf placement", async () => {
    const rows = [
      { ...demoOrders[0]!, id: "b-null", region: "B", amount: null },
      { ...demoOrders[0]!, id: "b", region: "B", amount: 10 },
      { ...demoOrders[0]!, id: "a", region: "A", amount: 10 },
      { ...demoOrders[0]!, id: "null", region: null, amount: 5 },
    ];
    const provider = createOrdersProvider(createOrdersDataset(rows));
    const session = await open(provider);
    expect(
      value(
        await provider.readExport(
          value(await provider.captureExport(session, signal())),
          signal(),
        ),
      ).map((row) => row.id),
    ).toEqual(["a", "b", "b-null", "null"]);
    const query: OrdersQuery = {
      ...ordersQuery,
      groupSort: [
        {
          level: 0,
          by: "key",
          direction: "desc",
          nulls: "first",
          comparison: "binary@1",
        },
        ordersQuery.groupSort[1]!,
      ],
    };
    expect(
      (await read(provider, await open(provider, query))).entries.map(
        (n) => n.kind === "group" && n.route[0]!.key,
      ),
    ).toEqual([null, "B", "A"]);
  });

  it("reports exact branch counts, typed identities, duplicate labels and authoritative aggregates", async () => {
    const provider = createOrdersProvider(createOrdersDataset());
    const session = await open(provider);
    const root = await read(provider, session);
    expect(session.sessionId).not.toBe(session.resultToken);
    expect(root.siblingCount).toBe(3);
    expect(session.rootCount).toBe(3);
    expect(
      root.entries.map((n) => n.kind === "group" && n.route[0]!.key),
    ).toEqual(["West", "East", null]);
    const west = root.entries[0]!;
    if (west.kind !== "group") throw Error("group expected");
    expect(west).toMatchObject({
      childCount: 3,
      leafCount: 4,
      aggregates: {
        "amount.sum@1": {
          authority: "server",
          completeness: "complete",
          state: "ready",
          value: 100,
          aggregateDefinitionKey: "orders@1:amount:amount.sum@1",
        },
      },
    });
    const children = await read(provider, session, west.route);
    expect(children.entries.map((n) => n.kind === "group" && n.label)).toEqual([
      "Acme",
      "Acme",
      "(empty)",
    ]);
    expect(new Set(children.entries.map((n) => n.id)).size).toBe(3);
    const customer = children.entries[0]!;
    if (customer.kind !== "group") throw Error("group expected");
    const page = await read(provider, session, customer.route, 1, 3);
    expect(page.siblingCount).toBe(2);
    expect(page.entries.map((n) => n.id)).toEqual([remoteLeafId("w2")]);
    expect(page).toMatchObject({
      queryKey: session.queryKey,
      resultToken: session.resultToken,
      start: 1,
      end: 3,
    });
    expect(
      (await read(provider, session, customer.route, 20, 25)).entries,
    ).toEqual([]);
  });

  it("captures filtered and authorized unfiltered totals at the same immutable version", async () => {
    const source = createOrdersDataset();
    const provider = createOrdersProvider(source);
    const query: OrdersQuery = {
      ...ordersQuery,
      filters: [{ columnId: "amount", operator: "gte", value: 30 }],
    };
    const session = await open(provider, query);
    const before = await read(provider, session);
    source.replace(
      demoOrders.map((row) => ({ ...row, amount: 999, region: "Changed" })),
    );
    expect(await read(provider, session)).toEqual(before);
    const filtered = value(
      await provider.summary(session, "filtered", signal()),
    );
    const all = value(await provider.summary(session, "all", signal()));
    expect(filtered.values["amount.sum@1"]).toMatchObject({ value: 130 });
    expect(all.values["amount.sum@1"]).toMatchObject({ value: 170 });
    expect(all).toMatchObject({
      sessionId: session.sessionId,
      queryKey: session.queryKey,
      resultToken: session.resultToken,
      scope: "all",
      registryVersion: "orders@1",
      authority: "server",
      completeness: "complete",
    });
    expect(filtered.resultToken).toBe(all.resultToken);
    const capture = value(await provider.captureExport(session, signal()));
    expect(
      value(await provider.readExport(capture, signal())).map((row) => row.id),
    ).toEqual(["w1", "w2", "e1", "n1"]);
    expect((await open(provider)).resultToken).not.toBe(session.resultToken);
  });

  it("uses recursive filters, binary search, projection, null ordering and stable ID tie breaks", async () => {
    const provider = createOrdersProvider(createOrdersDataset());
    const query: OrdersQuery = {
      ...ordersQuery,
      rowGroups: [],
      groupSort: [],
      projection: ["amount"],
      search: "Acme",
      filters: [
        {
          op: "or",
          children: [
            { columnId: "region", operator: "equals", value: "West" },
            { columnId: "amount", operator: "gt", value: 1000 },
          ],
        },
      ],
    };
    const rows = (await read(provider, await open(provider, query))).entries;
    expect(rows.map((n) => n.id)).toEqual([
      remoteLeafId("w1"),
      remoteLeafId("w2"),
      remoteLeafId("w3"),
    ]);
    expect(rows.map((n) => n.kind === "leaf" && n.row)).toEqual([
      { amount: 30 },
      { amount: 30 },
      { amount: 20 },
    ]);
  });

  it.each(["immutable", "revision-fence"] as const)(
    "materializes export before writes for %s, independent of browser ranges",
    async (consistency) => {
      const source = createOrdersDataset();
      const provider = createOrdersProvider(source, { consistency });
      const session = await open(provider);
      const exported = value(await provider.captureExport(session, signal()));
      source.replace(
        demoOrders
          .slice()
          .reverse()
          .map((row) => ({ ...row, amount: 0, customer: "moved" })),
      );
      await provider.release(session);
      const output = value(await provider.readExport(exported, signal()));
      expect(output.map((row) => row.id)).toEqual([
        "w1",
        "w2",
        "w3",
        "w4",
        "e1",
        "e2",
        "n1",
      ]);
      expect(output.reduce((sum, row) => sum + (row.amount ?? 0), 0)).toBe(170);
      output[0]!.amount = -1;
      expect(
        value(await provider.readExport(exported, signal()))[0]!.amount,
      ).toBe(30);
      await provider.releaseExport(exported);
      expect(await provider.readExport(exported, signal())).toEqual(
        failure("expired"),
      );
    },
  );

  it.each(["replace", "move"])(
    "revision fence rejects equal-size %s and latest-data export",
    async (mutation) => {
      const source = createOrdersDataset();
      const provider = createOrdersProvider(source, {
        consistency: "revision-fence",
      });
      const session = await open(provider);
      const second = await open(provider, {
        ...ordersQuery,
        filters: [{ columnId: "amount", operator: "gt", value: 20 }],
      });
      expect(second.resultToken).toBe(session.resultToken);
      expect(second.queryKey).not.toBe(session.queryKey);
      expect(second.sessionId).not.toBe(session.sessionId);
      const changed = demoOrders.map((row) => ({ ...row }));
      if (mutation === "replace")
        changed[0] = { ...changed[0]!, id: "inserted" };
      else changed[0]!.region = "East";
      source.replace(changed);
      for (const captured of [session, second]) {
        expect(
          await provider.read(
            { ...captured, route: [], start: 0, end: 2 },
            signal(),
          ),
        ).toEqual(failure("expired"));
        expect(await provider.summary(captured, "all", signal())).toEqual(
          failure("expired"),
        );
        expect(await provider.captureExport(captured, signal())).toEqual(
          failure("expired"),
        );
      }
    },
  );

  it("places mutation hooks outside the atomic fence plus read operation", async () => {
    const source = createOrdersDataset();
    const provider = createOrdersProvider(source, {
      consistency: "revision-fence",
    });
    const session = await open(provider);
    source.afterNextRead(() => source.replace([]));
    const root = await read(provider, session);
    expect(root.siblingCount).toBe(3);
    expect(root.entries[0]).toMatchObject({
      leafCount: 4,
      aggregates: { "amount.sum@1": { value: 100 } },
    });
    expect(await provider.summary(session, "filtered", signal())).toEqual(
      failure("expired"),
    );
    const fresh = await open(provider);
    source.beforeNextRead(() => source.replace(demoOrders));
    expect(await provider.captureExport(fresh, signal())).toEqual(
      failure("expired"),
    );
  });

  it("bounds retained storage, reclaims release/expiry, and never extends a TTL on reads", async () => {
    let now = 0;
    const provider = createOrdersProvider(createOrdersDataset(), {
      now: () => now,
      ttlMs: 10,
      maxResources: 2,
      maxStoredRows: 14,
    });
    const session = await open(provider);
    const exported = value(await provider.captureExport(session, signal()));
    expect(
      await provider.open(ordersQuery, session.queryKey, signal()),
    ).toEqual(failure("transient"));
    now = 9;
    await read(provider, session);
    now = 10;
    expect(await provider.summary(session, "all", signal())).toEqual(
      failure("expired"),
    );
    expect(await provider.readExport(exported, signal())).toEqual(
      failure("expired"),
    );
    const fresh = await open(provider);
    await provider.release(fresh);
    expect(
      await provider.read({ ...fresh, route: [], start: 0, end: 1 }, signal()),
    ).toEqual(failure("expired"));
    expect((await open(provider)).expiresAt).toBe(20);
  });

  it("charges export copies to row quota and reclaims released copies", async () => {
    const provider = createOrdersProvider(createOrdersDataset(), {
      maxStoredRows: 7,
    });
    const session = await open(provider);
    expect(await provider.captureExport(session, signal())).toEqual(
      failure("transient"),
    );
    await provider.release(session);
    await open(provider);
    const room = createOrdersProvider(createOrdersDataset(), {
      maxStoredRows: 14,
    });
    const retained = await open(room);
    const copy = value(await room.captureExport(retained, signal()));
    expect(await room.captureExport(retained, signal())).toEqual(
      failure("transient"),
    );
    await room.releaseExport(copy);
    expect((await room.captureExport(retained, signal())).ok).toBe(true);
  });

  it("returns an empty exact result and empty export with a complete zero filtered sum", async () => {
    const provider = createOrdersProvider(createOrdersDataset());
    const session = await open(provider, {
      ...ordersQuery,
      filters: [{ columnId: "amount", operator: "gt", value: 1000 }],
    });
    expect(session.rootCount).toBe(0);
    expect((await read(provider, session)).entries).toEqual([]);
    expect(
      value(await provider.summary(session, "filtered", signal())).values[
        "amount.sum@1"
      ],
    ).toMatchObject({ state: "ready", completeness: "complete", value: 0 });
    expect(
      value(
        await provider.readExport(
          value(await provider.captureExport(session, signal())),
          signal(),
        ),
      ),
    ).toEqual([]);
  });

  it("owns query/range copies, isolates namespaces and distrusts mutable advisory capabilities", async () => {
    const provider = createOrdersProvider(createOrdersDataset());
    const query = structuredClone(ordersQuery);
    const session = await open(provider, query);
    (query.projection as string[]).splice(0);
    const first = await read(provider, session);
    if (first.entries[0]!.kind !== "group") throw Error("group expected");
    (first.entries[0]!.route[0] as { key: string }).key = "tampered";
    expect((await read(provider, session)).entries[0]).toMatchObject({
      route: [{ columnId: "region", key: "West" }],
    });
    const other = createOrdersProvider(createOrdersDataset());
    await open(other);
    expect(await other.summary(session, "all", signal())).toEqual(
      failure("expired"),
    );
    (provider.capabilities.comparisons as string[]).push("unsafe");
    const unsafe = { ...ordersQuery, comparison: "unsafe" };
    const prepared = prepareRemoteQuery(unsafe, provider.capabilities);
    if (!prepared.ok) throw Error("advisory changed");
    expect(await provider.open(unsafe, prepared.queryKey, signal())).toEqual(
      failure("unsupported-query"),
    );
  });

  it("settles cancellation at the atomic boundary without allocating a session", async () => {
    const source = createOrdersDataset();
    const provider = createOrdersProvider(source, { maxResources: 1 });
    const abort = new AbortController();
    source.beforeNextRead(() => abort.abort());
    const prepared = prepareRemoteQuery(ordersQuery, provider.capabilities);
    if (!prepared.ok) throw Error("query expected");
    expect(
      await provider.open(ordersQuery, prepared.queryKey, abort.signal),
    ).toEqual(failure("cancelled"));
    const session = await open(provider);
    expect(await provider.summary(session, "all", abort.signal)).toEqual(
      failure("cancelled"),
    );
  });

  it.each(["auth", "source"])(
    "revocation of %s denies retained snapshots and exports without leaking data",
    async (kind) => {
      const source = createOrdersDataset();
      const provider = createOrdersProvider(source);
      const session = await open(provider);
      const exported = value(await provider.captureExport(session, signal()));
      if (kind === "auth") source.revokeAuth();
      else source.revokeSource();
      const denied = {
        ok: false,
        error: { code: "unauthorized", scope: "session" },
      };
      expect(await provider.summary(session, "all", signal())).toEqual(denied);
      expect(await provider.readExport(exported, signal())).toEqual(denied);
      expect(
        await provider.open(ordersQuery, session.queryKey, signal()),
      ).toEqual(denied);
    },
  );

  it("rejects cancellation, spoofed identity, invalid ranges and untrusted registry input", async () => {
    const provider = createOrdersProvider(createOrdersDataset());
    const session = await open(provider);
    const abort = new AbortController();
    abort.abort();
    expect(
      await provider.open(ordersQuery, session.queryKey, abort.signal),
    ).toEqual(failure("cancelled"));
    expect(
      await provider.read(
        { ...session, route: [], start: 0, end: 1 },
        abort.signal,
      ),
    ).toEqual(failure("cancelled"));
    expect(await provider.captureExport(session, abort.signal)).toEqual(
      failure("cancelled"),
    );
    expect(
      await provider.summary(
        { ...session, resultToken: "forged" },
        "all",
        signal(),
      ),
    ).toEqual(failure("invalid-query"));
    expect(
      await provider.summary(
        { ...session, sessionId: "unknown" },
        "all",
        signal(),
      ),
    ).toEqual(failure("expired"));
    expect(await provider.open(ordersQuery, "forged", signal())).toEqual(
      failure("invalid-query"),
    );
    for (const change of [
      { locale: "de" },
      { registryVersion: "other" },
      { aggregates: [{ columnId: "region", id: "amount.sum@1" }] },
    ]) {
      const query = { ...ordersQuery, ...change } as OrdersQuery;
      const prepared = prepareRemoteQuery(query, provider.capabilities);
      if (!prepared.ok) throw Error("advisory validator expected to accept");
      expect(await provider.open(query, prepared.queryKey, signal())).toEqual(
        failure("unsupported-query"),
      );
    }
    for (const change of [{ source: "other" }, { authScope: "other" }]) {
      expect(
        await provider.open({ ...ordersQuery, ...change }, "ignored", signal()),
      ).toEqual({
        ok: false,
        error: { code: "unauthorized", scope: "session" },
      });
    }
    for (const range of [
      { start: -1, end: 2 },
      { start: 2, end: 1 },
      { start: 0, end: 101 },
    ]) {
      expect(
        await provider.read({ ...session, route: [], ...range }, signal()),
      ).toEqual(failure("invalid-query"));
    }
    expect(
      await provider.read(
        {
          ...session,
          route: [{ columnId: "customer", key: "wrong-level" }],
          start: 0,
          end: 1,
        },
        signal(),
      ),
    ).toEqual(failure("invalid-query"));
  });

  it("validates untrusted query structure before reading fields or invoking accessors", async () => {
    const provider = createOrdersProvider(createOrdersDataset());
    expect(
      await provider.open(null as unknown as OrdersQuery, "key", signal()),
    ).toEqual(failure("invalid-query"));
    let calls = 0;
    const hostile = { ...ordersQuery };
    Object.defineProperty(hostile, "source", {
      get() {
        calls++;
        return "orders";
      },
      enumerable: true,
    });
    expect(await provider.open(hostile, "key", signal())).toEqual(
      failure("invalid-query"),
    );
    expect(calls).toBe(0);
  });
});
