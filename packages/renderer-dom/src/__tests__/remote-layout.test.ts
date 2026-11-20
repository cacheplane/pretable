import { expect, it } from "vitest";
import { RemoteMetrics, RemoteScrollMapping } from "../remote-layout";

it("uses bounded corrections over 100 million estimated rows", () => {
  const ranks = new Map([
    ["a", 2],
    ["b", 80000000],
    ["c", 9],
  ]);
  const metrics = new RemoteMetrics(100000000, 20, 2, (id) => ranks.get(id));
  metrics.measure("a", 40);
  metrics.measure("b", 70);
  expect(metrics.getTotalHeight()).toBe(2000000070);
  expect(metrics.getIndexForOffset(61)).toBe(2);
  expect(metrics.getOffsetForIndex(80000001)).toBe(1600000090);
  const anchor = metrics.captureAnchor(
    "b",
    metrics.getOffsetForIndex(80000000) + 7,
  )!;
  metrics.measure("c", 30); // evicts a, shifts b by -10
  expect(metrics.measurementCount).toBe(2);
  expect(metrics.restoreAnchor(anchor)).toBe(1600000017);
  ranks.set("b", 5); // collapse/expansion changes ranks, identity remains
  metrics.sync(40, (id) => ranks.get(id));
  expect(metrics.restoreAnchor(anchor)).toBe(107);
  metrics.invalidateMeasurements();
  expect(metrics.restoreAnchor(anchor)).toBe(107);
  expect(metrics.getTotalHeight()).toBe(800);
  ranks.delete("b");
  metrics.sync(39, (id) => ranks.get(id));
  expect(metrics.restoreAnchor(anchor)).toBeUndefined();
});
it("handles exact boundaries and validates without corrupting metrics", () => {
  const metrics = new RemoteMetrics(3, 20, 2, (id) =>
    id === "b" ? 1 : undefined,
  );
  metrics.measure("b", 40);
  expect(
    [0, 19, 20, 59, 60, 80].map((n) => metrics.getIndexForOffset(n)),
  ).toEqual([0, 0, 1, 1, 2, 3]);
  expect(() => metrics.measure("b", -1)).toThrow();
  expect(() =>
    metrics.sync(Number.MAX_SAFE_INTEGER, () => undefined),
  ).toThrow();
  expect(metrics.getTotalHeight()).toBe(80);
});
it("maps distant thumb intent and local pixel intent in one logical coordinate domain", () => {
  const mapping = new RemoteScrollMapping(2000000000, 600, 8000000);
  mapping.fromDOM(mapping.domRange / 2);
  const middle = mapping.logicalScrollTop;
  mapping.moveBy(40);
  expect(mapping.logicalScrollTop).toBe(middle + 40);
  const rowTop = mapping.logicalScrollTop + 120;
  expect(mapping.toDOMRowTop(rowTop) - mapping.domScrollTop).toBeCloseTo(120);
  expect(mapping.hitTest(120)).toBe(rowTop);
  expect(mapping.telemetry()).toEqual({
    scrollTop: middle + 40,
    totalHeight: 2000000000,
  });
  mapping.reveal(1999999800, 40);
  expect(mapping.logicalScrollTop).toBe(1999999240);
  const restored = new RemoteScrollMapping(2000000000, 600, 8000000);
  restored.fromDOM(mapping.domScrollTop);
  expect(restored.logicalScrollTop).toBeCloseTo(mapping.logicalScrollTop, 5);
  mapping.moveBy(Infinity);
  expect(mapping.logicalScrollTop).toBe(1999999400);
});
it("keeps ordinary geometry identity mapped and validates dimensions", () => {
  const mapping = new RemoteScrollMapping(1000, 200, 8000000);
  mapping.fromDOM(300);
  expect(mapping.toDOMRowTop(350)).toBe(350);
  expect(() => new RemoteScrollMapping(1e30, 200, 8000000)).toThrow();
  expect(() => new RemoteScrollMapping(100, 200, 100)).toThrow();
});

it("matches RowMetricsReader boundaries and batches one bounded rebuild", () => {
  let resolutions = 0;
  const metrics = new RemoteMetrics(100000000, 20, 1000, (id) => {
    resolutions++;
    return Number(id);
  });
  metrics.measureBatch(
    Array.from({ length: 1000 }, (_, i) => ({ id: String(i), height: 21 })),
  );
  expect(resolutions).toBe(1000);
  expect(metrics.getHeight(-1)).toBe(0);
  expect(metrics.getHeight(100000000)).toBe(0);
  expect(metrics.getHeight(1.5)).toBe(0);
  expect(metrics.getOffsetForIndex(-3)).toBe(0);
  expect(metrics.getOffsetForIndex(NaN)).toBe(0);
  expect(metrics.getOffsetForIndex(Infinity)).toBe(metrics.getTotalHeight());
  expect(metrics.getIndexForOffset(Infinity)).toBe(metrics.rowCount);
  expect(metrics.getIndexForOffset(NaN)).toBe(0);
  expect(() =>
    metrics.measureBatch([
      { id: "0", height: 22 },
      { id: "1", height: -1 },
    ]),
  ).toThrow();
  expect(metrics.getHeight(0)).toBe(21);
  const empty = new RemoteMetrics(0, 20, 0, () => undefined);
  expect(empty.getHeight(0)).toBe(0);
  expect(empty.getOffsetForIndex(1)).toBe(0);
  expect(empty.getIndexForOffset(100)).toBe(0);
});

it("projects against observed DOM scroll rounding without changing logical telemetry", () => {
  const mapping = new RemoteScrollMapping(2000000000, 600, 8000000);
  mapping.seek(1000000007);
  const observed = Math.floor(mapping.domScrollTop);
  expect(mapping.toDOMRowTop(1000000000, observed) - observed).toBe(-7);
  expect(mapping.telemetry().scrollTop).toBe(1000000007);
});

it("resolves only changed measurements for a viewport batch at the provisional cap", () => {
  let work = 0;
  const metrics = new RemoteMetrics(100000000, 20, 100000, (id) => {
    work++;
    return Number(id);
  });
  metrics.measureBatch(
    Array.from({ length: 100000 }, (_, i) => ({ id: String(i), height: 21 })),
  );
  work = 0;
  metrics.measureBatch(
    Array.from({ length: 50 }, (_, i) => ({ id: String(i), height: 22 })),
  );
  expect(work).toBe(50);
  expect(metrics.measurementCount).toBe(100000);
  expect(metrics.getTotalHeight()).toBe(2000100050);
});

it("terminates inverse lookup at safe-integer row-count boundaries without materialization", () => {
  class GuardedMetrics extends RemoteMetrics {
    probes = 0;
    override getOffsetForIndex(index: number): number {
      if (++this.probes > 54)
        throw new Error("Binary search failed to converge");
      return super.getOffsetForIndex(index);
    }
  }
  const count = Number.MAX_SAFE_INTEGER;
  const metrics = new GuardedMetrics(count, 1, 0, () => undefined);
  for (const offset of [count - 3, count - 2, count - 1, count]) {
    metrics.probes = 0;
    expect(metrics.getIndexForOffset(offset)).toBe(offset);
    expect(metrics.probes).toBeLessThanOrEqual(54);
  }
  expect(metrics.measurementCount).toBe(0);
});

it("prepares topology measurement changes in bounded steps and rejects stale publication", () => {
  const metrics = new RemoteMetrics(100000, 20, 1000, Number);
  metrics.measureBatch(
    Array.from({ length: 1000 }, (_, i) => ({ id: String(i), height: 21 })),
  );
  let work = 0;
  expect(metrics.prepareSync).toBeTypeOf("function");
  const pending = metrics.prepareSync(200000, (id) => {
    work++;
    return Number(id) + 1000;
  });
  expect(pending.advance(8)).toBe(false);
  expect(work).toBe(8);
  expect(metrics.getHeight(0)).toBe(21);
  metrics.measure("0", 40);
  while (!pending.advance(32)) {
    /* bounded preparation */
  }
  expect(pending.commit()).toBe(false);
  expect(metrics.getHeight(0)).toBe(40);
  const accepted = metrics.prepareSync(200000, (id) => Number(id) + 1000);
  while (!accepted.advance(32)) {
    /* bounded preparation */
  }
  expect(accepted.commit()).toBe(true);
  expect(metrics.getHeight(1000)).toBe(40);
});

it("uses transactional shared measurement admission, eviction and release", () => {
  let allow = true;
  const charges = new Map<string, number>();
  const metrics = new RemoteMetrics(100, 20, 2, Number, {
    prepare(changes, removed, transientBytes) {
      expect(transientBytes).toBeGreaterThanOrEqual(0);
      if (!allow) return undefined;
      return {
        commit() {
          if (removed === "all") charges.clear();
          else for (const id of removed) charges.delete(id);
          for (const item of changes) charges.set(item.id, item.bytes);
          return true;
        },
        cancel() {},
      };
    },
  });
  metrics.measure("1", 40);
  expect(charges.size).toBe(1);
  allow = false;
  expect(metrics.measureBatch([{ id: "2", height: 30 }])).toBe(false);
  expect(metrics.getHeight(2)).toBe(20);
  expect(metrics.measurementCount).toBe(1);
  allow = true;
  metrics.measure("2", 30);
  metrics.measure("3", 50);
  expect([...charges.keys()]).toEqual(["2", "3"]);
  expect(metrics.getHeight(1)).toBe(20);
  expect(metrics.evictMeasurements(["2"])).toBe(true);
  expect(charges.size).toBe(1);
  metrics.invalidateMeasurements();
  expect(charges.size).toBe(0);
});

it("normalizes wheel, keyboard and touch intent without amplifying physical scroll", async () => {
  const api = await import("../remote-layout");
  expect(api.RemoteScrollInput).toBeTypeOf("function");
  const mapping = new RemoteScrollMapping(2000000000, 600, 8000000);
  const input = new api.RemoteScrollInput(mapping, () => 24);
  mapping.seek(1000000007);
  expect(input.wheel({ deltaY: 2, deltaMode: 1 })).toBe(true);
  expect(mapping.logicalScrollTop).toBe(1000000055);
  input.wheel({ deltaY: 0.5, deltaMode: 2 });
  input.wheel({ deltaY: 0.25, deltaMode: 0 }); // trackpad/momentum deltas retain fractions
  expect(mapping.logicalScrollTop).toBe(1000000355.25);
  expect(input.wheel({ deltaY: 100, deltaMode: 0, ctrlKey: true })).toBe(false);
  expect(mapping.logicalScrollTop).toBe(1000000355.25);
  input.key("PageDown");
  input.key("ArrowUp");
  expect(mapping.logicalScrollTop).toBe(1000000931.25);
  input.touchStart(100);
  input.touchMove(80);
  input.touchMove(75);
  input.touchEnd();
  expect(mapping.logicalScrollTop).toBe(1000000956.25);
  expect(input.touchMove(0)).toBe(false);
  input.recordDOM(Math.floor(mapping.domScrollTop));
  expect(input.fromDOM(Math.floor(mapping.domScrollTop))).toBe(false);
  expect(mapping.logicalScrollTop).toBe(1000000956.25);
  expect(input.fromDOM(mapping.domRange)).toBe(true);
  expect(mapping.logicalScrollTop).toBe(mapping.logicalRange);
  input.key("Home");
  expect(mapping.logicalScrollTop).toBe(0);
  input.key("End");
  expect(mapping.logicalScrollTop).toBe(mapping.logicalRange);
  expect(input.key("a")).toBe(false);
});

it("releases speculative measurement reservations when rank resolution or commit throws", () => {
  let reserved = 0,
    failCommit = false;
  const metrics = new RemoteMetrics(10, 20, 5, Number, {
    prepare() {
      reserved++;
      return {
        commit() {
          if (failCommit) throw new Error("owner failed");
          reserved--;
          return true;
        },
        cancel() {
          reserved--;
        },
      };
    },
  });
  metrics.measure("1", 30);
  const pending = metrics.prepareSync(20, () => {
    throw new Error("rank failed");
  });
  expect(reserved).toBe(1);
  expect(() => pending.advance(1)).toThrow("rank failed");
  expect(reserved).toBe(0);
  pending.cancel();
  expect(reserved).toBe(0);
  expect(metrics.getHeight(1)).toBe(30);
  const second = metrics.prepareSync(20, Number);
  while (!second.advance(2)) {
    /* bounded */
  }
  failCommit = true;
  expect(() => second.commit()).toThrow("owner failed");
  expect(reserved).toBe(0);
  expect(metrics.rowCount).toBe(10);
  expect(metrics.getHeight(1)).toBe(30);
});

it("matches an independent eager oracle through measured-prefix insertion, deletion and reordering", () => {
  const retained = new Map<string, number>();
  let shift = 0,
    seed = 17;
  const rankOf = (id: string) => (Number(id) + shift) % 50;
  const metrics = new RemoteMetrics(50, 20, 10, rankOf);
  for (let step = 0; step < 300; step++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const id = String(seed % 50),
      height = 10 + (seed % 70);
    retained.delete(id);
    retained.set(id, height);
    while (retained.size > 10) retained.delete(retained.keys().next().value!);
    metrics.measure(id, height);
    if (step % 37 === 0) {
      shift = (shift + 7) % 50;
      metrics.sync(50, rankOf);
    }
    const heights = Array<number>(50).fill(20);
    for (const [key, value] of retained) heights[rankOf(key)] = value;
    let offset = 0;
    for (let rank = 0; rank < 50; rank++) {
      expect(metrics.getOffsetForIndex(rank)).toBe(offset);
      expect(metrics.getHeight(rank)).toBe(heights[rank]);
      expect(metrics.getIndexForOffset(offset + heights[rank]! - 1)).toBe(rank);
      offset += heights[rank]!;
    }
    expect(metrics.getTotalHeight()).toBe(offset);
  }
});

it("rejects reentrant budget mutations and preserves the published prefix", () => {
  const hook: { callback?: () => void } = {};
  const metrics = new RemoteMetrics(10, 20, 5, Number, {
    prepare() {
      hook.callback?.();
      return { commit: () => true, cancel() {} };
    },
  });
  metrics.measure("1", 30);
  hook.callback = () => metrics.measure("2", 40);
  expect(() => metrics.measure("3", 60)).toThrow(/Reentrant/);
  expect(metrics.measurementCount).toBe(1);
  expect(metrics.getTotalHeight()).toBe(210);
});
