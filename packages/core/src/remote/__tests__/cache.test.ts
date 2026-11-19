import { describe, expect, it } from "vitest";
import { RemoteCache, type CacheRecord, type CachePlan } from "../cache";

const record = (
  key: string,
  overrides: Partial<CacheRecord> = {},
): CacheRecord => ({
  scope: 1,
  key,
  kind: "payload",
  bytes: 10,
  entries: 1,
  value: key,
  address: {
    generation: overrides.scope ?? 1,
    route: [{ columnId: "group", key }],
    start: 0,
    end: 1,
  },
  ...overrides,
});
function admit(cache: RemoteCache, records: CacheRecord[]) {
  const result = cache.prepare({ records });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(cache.commit(result.plan)).toBe(true);
  return result.plan;
}
function cacheWith(limits = {}) {
  const cache = new RemoteCache(limits);
  expect(cache.openScope(1)).toBe(true);
  return cache;
}

describe("RemoteCache admission owner", () => {
  it("shares payload counts and bytes across current and retiring scopes and evicts cold LRU", () => {
    const cache = cacheWith({ payloadEntries: 2, payloadBytes: 20 });
    cache.openScope(2);
    expect(cache.openScope(3)).toBe(false);
    admit(cache, [record("a"), record("b", { scope: 2 })]);
    cache.touch(1, "a");
    const plan = admit(cache, [record("c")]);
    expect(plan.evictions.map((r) => r.key)).toEqual(["b"]);
    expect(cache.snapshot().payloadBytes).toBe(20);
    expect(cache.get(2, "b")).toBeUndefined();
  });
  it("atomically refuses oversized or minimum-visible payloads without changing state or retrying", () => {
    const cache = cacheWith({ payloadBytes: 20 });
    admit(cache, [record("visible", { protected: true })]);
    const before = cache.snapshot();
    for (let i = 0; i < 3; i++) {
      expect(
        cache.prepare({
          records: [record("new", { bytes: 21, protected: true })],
        }),
      ).toEqual({ ok: false, reason: "minimum-visible-too-large" });
      expect(cache.snapshot()).toEqual(before);
    }
    expect(
      cache.prepare({ records: [record("large", { bytes: 21 })] }),
    ).toEqual({ ok: false, reason: "payload-capacity" });
  });
  it("reports ordinary capacity when a mixed batch exceeds budget but its protected minimum fits", () => {
    for (const limits of [
      { payloadEntries: 1 },
      { payloadBytes: 10 },
      { metadataBytes: 350 },
    ]) {
      const cache = cacheWith(limits);
      const before = cache.snapshot();
      const result = cache.prepare({
        records: [
          record("visible", { protected: true }),
          record("prefetch", { tier: "prefetch" }),
        ],
      });
      expect(result).toEqual({
        ok: false,
        reason:
          "metadataBytes" in limits ? "metadata-capacity" : "payload-capacity",
      });
      expect(cache.snapshot()).toEqual(before);
      expect(cache.get(1, "visible")).toBeUndefined();
      expect(cache.get(1, "prefetch")).toBeUndefined();
      admit(cache, [record("visible", { protected: true })]);
    }
  });
  it("includes retained protected rows and required intent when diagnosing the protected minimum", () => {
    const cache = cacheWith({ payloadEntries: 1, expansions: 1 });
    admit(cache, [
      record("old", { protected: true }),
      record("intent", { kind: "expansion" }),
    ]);
    const before = cache.snapshot();
    expect(
      cache.prepare({
        records: [
          record("visible", { protected: true }),
          record("prefetch", { tier: "prefetch" }),
        ],
      }),
    ).toEqual({ ok: false, reason: "minimum-visible-too-large" });
    expect(cache.snapshot()).toEqual(before);
    expect(cache.get(1, "intent")).toBe("intent");
    expect(
      cache.prepare({
        records: [
          record("visible", { protected: true }),
          record("intent2", { kind: "expansion" }),
        ],
      }),
    ).toEqual({ ok: false, reason: "intent-capacity" });
    expect(cache.snapshot()).toEqual(before);
  });
  it("drops prefetch then overscan before cold payloads and preserves protected focus", () => {
    const cache = cacheWith({ payloadEntries: 4 });
    admit(cache, [
      record("cold"),
      record("over", { tier: "overscan" }),
      record("pre", { tier: "prefetch" }),
      record("focus", { protected: true }),
    ]);
    expect(admit(cache, [record("one")]).evictions.map((r) => r.key)).toEqual([
      "pre",
    ]);
    expect(admit(cache, [record("two")]).evictions.map((r) => r.key)).toEqual([
      "over",
    ]);
    expect(cache.get(1, "focus")).toBe("focus");
  });
  it("separates store retention from topology and refuses new intent instead of silently collapsing or deselecting", () => {
    const cache = cacheWith({
      stores: 1,
      topology: 1,
      expansions: 1,
      selectedIds: 1,
      cellRanges: 1,
    });
    for (const kind of [
      "topology",
      "expansion",
      "selection",
      "cellRange",
    ] as const) {
      admit(cache, [record(kind, { kind })]);
      expect(
        cache.prepare({ records: [record(`${kind}2`, { kind })] }).ok,
      ).toBe(false);
      expect(cache.get(1, kind)).toBe(kind);
    }
    admit(cache, [record("store", { kind: "store" })]);
    admit(cache, [record("store2", { kind: "store" })]);
    expect(cache.get(1, "store")).toBeUndefined();
    expect(cache.get(1, "topology")).toBe("topology");
  });
  it("charges oversized keys and explicit metadata costs, including payload addresses", () => {
    const cache = cacheWith({ metadataBytes: 200 });
    expect(cache.prepare({ records: [record("x".repeat(101))] }).ok).toBe(
      false,
    );
    expect(
      cache.prepare({ records: [record("x", { metadataBytes: 201 })] }).ok,
    ).toBe(false);
    expect(
      cache.prepare({
        records: [
          record("x", {
            address: {
              generation: 1,
              route: [{ columnId: "group", key: "x".repeat(101) }],
              start: 0,
              end: 1,
            },
          }),
        ],
      }).ok,
    ).toBe(false);
    expect(cache.snapshot().records).toBe(0);
  });
  it("bounds measurement LRU independently and permits reestimation after eviction", () => {
    const cache = cacheWith({ measurements: 2 });
    admit(cache, [
      record("a", { kind: "measurement" }),
      record("b", { kind: "measurement" }),
    ]);
    cache.touch(1, "a");
    admit(cache, [record("c", { kind: "measurement" })]);
    expect(cache.get(1, "b")).toBeUndefined();
    expect(cache.snapshot().measurements).toBe(2);
  });
  it("keeps ingress leases until explicit physical settlement even after scope disposal", () => {
    const cache = cacheWith({ ingressBytes: 20, responseBytes: 10 });
    expect(cache.reserveIngress(11)).toBeUndefined();
    const a = cache.reserveIngress(10)!;
    const b = cache.reserveIngress(10)!;
    expect(cache.reserveIngress(1)).toBeUndefined();
    cache.closeScope(1);
    expect(cache.snapshot().ingressBytes).toBe(20);
    expect(cache.releaseIngress(a)).toBe(true);
    expect(cache.releaseIngress(a)).toBe(false);
    expect(cache.releaseIngress(b)).toBe(true);
    expect(cache.snapshot().ingressBytes).toBe(0);
  });
  it("rejects stale, foreign, or reused plans; snapshots have no sensitive keys", () => {
    const cache = cacheWith();
    const prepared = cache.prepare({ records: [record("secret")] });
    if (!prepared.ok) throw new Error("prepare failed");
    cache.openScope(2);
    expect(cache.commit(prepared.plan)).toBe(false);
    const plan = admit(cache, [record("secret")]);
    expect(cache.commit(plan)).toBe(false);
    expect(cacheWith().commit(plan)).toBe(false);
    expect(JSON.stringify(cache.snapshot())).not.toContain("secret");
    expect(cache.commit({} as CachePlan)).toBe(false);
  });
  it("atomically releases an old protected view when explicitly permitted for a new root", () => {
    const cache = cacheWith({ payloadEntries: 1 });
    cache.openScope(2);
    admit(cache, [record("old", { protected: true })]);
    const result = cache.prepare({
      records: [record("root", { scope: 2, protected: true })],
      releaseScopes: [1],
    });
    expect(cache.get(1, "old")).toBe("old");
    if (!result.ok) throw new Error("prepare failed");
    expect(cache.commit(result.plan)).toBe(true);
    expect(cache.get(1, "old")).toBeUndefined();
    expect(cache.snapshot().scopes).toBe(1);
  });
  it("supports protection changes and exact drops without retaining historical values", () => {
    const cache = cacheWith({ payloadEntries: 1 });
    admit(cache, [record("a", { protected: true })]);
    cache.protect(1, "a", false);
    admit(cache, [record("b")]);
    cache.drop(1, "b");
    expect(cache.snapshot().records).toBe(0);
    cache.closeScope(1);
    expect(cache.snapshot().scopes).toBe(0);
  });
  it("validates configuration, finite safe costs, depth, address, and expected epochs atomically", () => {
    for (const value of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => new RemoteCache({ payloadBytes: value })).toThrow();
      expect(
        cacheWith().prepare({ records: [record("x", { bytes: value })] }).ok,
      ).toBe(false);
    }
    expect(() => new RemoteCache({ responseBytes: 0 })).toThrow();
    const cache = cacheWith({ payloadEntries: 0 });
    expect(cache.prepare({ records: [record("x")] }).ok).toBe(false);
    expect(cache.prepare({ records: [], expectedEpoch: -1 }).ok).toBe(false);
    expect(
      cacheWith().prepare({
        records: [
          record("x", {
            address: {
              generation: 1,
              route: Array.from({ length: 33 }, () => ({
                columnId: "group",
                key: "x",
              })),
              start: 0,
              end: 1,
            },
          }),
        ],
      }).ok,
    ).toBe(false);
  });
  it("charges scope and ingress lease bookkeeping to metadata before dispatch", () => {
    const cache = cacheWith({ metadataBytes: 192 });
    const lease = cache.reserveIngress(1)!;
    expect(lease).toBeDefined();
    expect(cache.reserveIngress(1)).toBeDefined();
    expect(cache.reserveIngress(1)).toBeUndefined();
    expect(cache.snapshot().metadataBytes).toBe(192);
    expect(cache.openScope(2)).toBe(false);
    cache.releaseIngress(lease);
    expect(cache.openScope(2)).toBe(true);
  });
  it("accounts payload entry and byte limits independently and leaves external snapshots usable", () => {
    const cache = cacheWith({ payloadEntries: 2, payloadBytes: 100 });
    const payload = Object.freeze({ row: "retained externally" });
    admit(cache, [record("old", { entries: 2, value: payload })]);
    const external = cache.get(1, "old");
    admit(cache, [record("new", { bytes: 90, entries: 1 })]);
    expect(cache.snapshot().payloadEntries).toBe(1);
    expect(external).toBe(payload);
    expect(cache.get(1, "old")).toBeUndefined();
    expect(cache.snapshot().payloadBytes).toBe(90);
  });
  it("rejects transactions prepared after reentrant sizing and throws without partial admission", () => {
    const cache = cacheWith();
    const epoch = cache.snapshot().epoch;
    cache.openScope(2); // adapter sizing hook reentered the owner
    expect(
      cache.prepare({ records: [record("x")], expectedEpoch: epoch }),
    ).toEqual({ ok: false, reason: "stale-plan" });
    const source = record("x");
    Object.defineProperty(source, "value", {
      get() {
        cache.closeScope(2);
        return "x";
      },
    });
    expect(cache.prepare({ records: [source] })).toEqual({
      ok: false,
      reason: "stale-plan",
    });
    Object.defineProperty(source, "bytes", {
      get() {
        throw new Error("cost failed");
      },
    });
    expect(cache.prepare({ records: [source] }).ok).toBe(false);
    expect(cache.snapshot().records).toBe(0);
  });
  it("preserves all prior state when a multi-record transaction or replacement is refused", () => {
    const cache = cacheWith({ payloadEntries: 2, expansions: 1 });
    admit(cache, [record("old"), record("intent", { kind: "expansion" })]);
    const before = cache.snapshot();
    expect(
      cache.prepare({
        records: [
          record("old", { value: "changed" }),
          record("intent2", { kind: "expansion" }),
        ],
      }).ok,
    ).toBe(false);
    expect(cache.snapshot()).toEqual(before);
    expect(cache.get(1, "old")).toBe("old");
  });
  it("charges escaped identity allocation and cannot retain unlimited zero-cost records", () => {
    const cache = cacheWith({ metadataBytes: 200 });
    expect(
      cache.prepare({
        records: [
          record("\0".repeat(10), { kind: "external", address: undefined }),
        ],
      }).ok,
    ).toBe(false);
    const candidates = Array.from({ length: 10 }, (_, i) =>
      record(String(i), {
        kind: "external",
        metadataBytes: 0,
        address: undefined,
      }),
    );
    expect(cache.prepare({ records: candidates }).ok).toBe(false);
    expect(cache.snapshot().records).toBe(0);
  });
  it("allows only one pending plan and releases explicitly discarded preparations", () => {
    const cache = cacheWith();
    const first = cache.prepare({ records: [record("first")] });
    const second = cache.prepare({ records: [record("second")] });
    if (!first.ok || !second.ok) throw new Error("prepare failed");
    expect(cache.commit(first.plan)).toBe(false);
    cache.discard(second.plan);
    expect(cache.commit(second.plan)).toBe(false);
    expect(cache.snapshot().records).toBe(0);
  });
});
