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

it("resolves each retained measurement once for a viewport batch at the provisional cap", () => {
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
  expect(work).toBe(100000);
  expect(metrics.measurementCount).toBe(100000);
  expect(metrics.getTotalHeight()).toBe(2000100050);
});
