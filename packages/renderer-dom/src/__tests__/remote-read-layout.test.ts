import { expect, it } from "vitest";
import type {
  PretableRemoteModelSnapshot,
  PretableRemoteNode,
  PretableRemoteSlot,
} from "@pretable/core";
import {
  createRowHeightIndex,
  readLayout,
} from "@pretable-internal/layout-core";
import * as remote from "../index";
type Row = { value: string };
function snapshot(
  count: number,
  loaded: [number, PretableRemoteNode<Row>][],
  generation = 1,
  status: "unloaded" | "loading" = "unloaded",
): PretableRemoteModelSnapshot<Row> {
  const nodes = new Map(loaded);
  return {
    status: { state: "idle" },
    generation,
    rootCount: count,
    displayCount: count,
    residentCount: loaded.length,
    residentLeafCount: loaded.length,
    residentGroupCount: 0,
    readSlot(index): PretableRemoteSlot<Row> | undefined {
      return index < 0 || index >= count
        ? undefined
        : nodes.has(index)
          ? { kind: "loaded", node: nodes.get(index)! }
          : { kind: status, route: [], ordinal: index };
    },
    loadedEntries: () => loaded.map(([index, node]) => ({ index, node })),
    getSummary: () => ({ state: "unavailable" }),
  };
}
const leaf = (id: string | number): PretableRemoteNode<Row> => ({
  kind: "leaf",
  id,
  row: { value: String(id) },
});
function accept(
  adapter: remote.RemoteLayoutAdapter<Row>,
  next: PretableRemoteModelSnapshot<Row>,
) {
  const pending = adapter.prepare(next);
  while (!pending.advance(8)) {
    /* scheduled by host in production */
  }
  expect(pending.commit()).toBe(true);
}
it("shares materialized geometry with local and manual readers at nonzero offsets", () => {
  expect(remote.RemoteLayoutAdapter).toBeTypeOf("function");
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
  });
  accept(
    adapter,
    snapshot(100, [
      [50, leaf("a")],
      [51, leaf("b")],
      [52, leaf("c")],
    ]),
  );
  adapter.setViewport({ scrollTop: 1025, viewportHeight: 30, overscan: 0 });
  const metrics = createRowHeightIndex({
    defaultHeight: 20,
    getKey: (key: number) => key,
    rows: [0, 1, 2].map((key) => ({ key })),
  });
  const manual = readLayout({
    rowMetrics: metrics,
    leadingHeight: 1000,
    trailingHeight: 940,
    scrollTop: 1025,
    viewportHeight: 30,
    overscan: 0,
    readRange: (a, b) => ["a", "b", "c"].slice(a, b),
  });
  const local = readLayout({
    rowMetrics: metrics,
    scrollTop: 25,
    viewportHeight: 30,
    overscan: 0,
    readRange: (a, b) => ["a", "b", "c"].slice(a, b),
  });
  expect(adapter.getState().rows.map((r) => [r.top, r.height])).toEqual(
    manual.rows.map((r) => [r.top, r.height]),
  );
  expect(local.rows.map((r) => [r.top + 1000, r.height])).toEqual(
    manual.rows.map((r) => [r.top, r.height]),
  );
  expect(adapter.getState().scrollTop).toBe(1025);
});
it("publishes metadata and sparse geometry together and retains typed business identity", () => {
  expect(remote.RemoteLayoutAdapter).toBeTypeOf("function");
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
  });
  const original = snapshot(100000000, [
    [0, leaf(1)],
    [1, leaf("1")],
  ]);
  accept(adapter, original);
  adapter.setViewport({ scrollTop: 0, viewportHeight: 60, overscan: 0 });
  const before = adapter.getState();
  expect(before.rows[0]!.value.businessKey).not.toBe(
    before.rows[1]!.value.businessKey,
  );
  expect(before.rows[2]!.value.businessKey).toBeUndefined();
  const pending = adapter.prepare(
    snapshot(
      100000000,
      [
        [0, leaf(1)],
        [1, leaf("1")],
      ],
      1,
      "loading",
    ),
  );
  expect(adapter.getState()).toBe(before);
  while (!pending.advance(1)) {
    expect(adapter.getState()).toBe(before);
  }
  expect(pending.commit()).toBe(true);
  expect(adapter.getState().rows[2]!.value.presentationKey).toBe(
    before.rows[2]!.value.presentationKey,
  );
  expect(adapter.getState().rows[2]!.value.slot.kind).toBe("loading");
  expect(before.rows[2]!.value.slot.kind).toBe("unloaded");
  adapter.reveal(99999999);
  expect(adapter.getState().scrollTop).toBe(1999999940);
  expect(adapter.getState().rows.at(-1)!.top).toBe(1999999980);
});
it("retains identity heights across collapse/refetch and explicitly reports missing anchors", () => {
  expect(remote.RemoteLayoutAdapter).toBeTypeOf("function");
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
  });
  accept(
    adapter,
    snapshot(100, [
      [10, leaf("a")],
      [11, leaf("b")],
    ]),
  );
  adapter.setViewport({ scrollTop: 207, viewportHeight: 40, overscan: 0 });
  const a = adapter.getState().rows[0]!.value.businessKey!;
  adapter.measureBatch([{ id: a, height: 45 }]);
  expect(adapter.getState().scrollTop).toBe(207);
  accept(
    adapter,
    snapshot(50, [
      [5, leaf("a")],
      [6, leaf("b")],
    ]),
  );
  expect(adapter.getState().scrollTop).toBe(107);
  expect(adapter.getState().rows[0]!.height).toBe(45);
  accept(adapter, snapshot(50, [[6, leaf("b")]]));
  expect(adapter.getState().anchor).toBe("unavailable");
  expect(adapter.getState().rows[0]!.height).toBe(20);
  accept(
    adapter,
    snapshot(50, [
      [5, leaf("a")],
      [6, leaf("b")],
    ]),
  );
  expect(adapter.getState().rows[0]!.height).toBe(45);
  adapter.invalidateMeasurements(); // width or theme changed
  expect(adapter.getState().rows[0]!.height).toBe(20);
  expect(adapter.getState().scrollTop).toBe(107);
});

it("resets reused identities across result generations and disposes both budget owners", () => {
  const charges = new Map<string, number>();
  let reservations = 0;
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
    measurementBudget: {
      prepare(changes, removed) {
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
    },
    projectionBudget: {
      reserve() {
        reservations++;
        return () => {
          reservations--;
        };
      },
    },
  });
  accept(adapter, snapshot(10, [[0, leaf("a")]]));
  const key = adapter.getState().rows[0]!.value.businessKey!;
  adapter.measureBatch([{ id: key, height: 70 }]);
  expect(charges.size).toBe(1);
  expect(reservations).toBe(1);
  accept(adapter, snapshot(10, [[0, leaf("a")]], 2));
  expect(adapter.getState().rows[0]!.height).toBe(20);
  expect(charges.size).toBe(0);
  expect(reservations).toBe(1);
  adapter.dispose();
  adapter.dispose();
  expect(reservations).toBe(0);
  expect(adapter.getState().rows).toEqual([]);
  expect(adapter.getState().snapshot).toBeUndefined();
});
it("refuses candidate ranks without changing the last committed geometry", () => {
  let admit = true,
    reservations = 0;
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
    projectionBudget: {
      reserve() {
        if (!admit) return undefined;
        reservations++;
        return () => {
          reservations--;
        };
      },
    },
  });
  accept(adapter, snapshot(100, [[0, leaf("a")]]));
  const previous = adapter.getState();
  admit = false;
  const refused = adapter.prepare(snapshot(100, [[50, leaf("b")]]));
  while (!refused.advance(1)) {
    /* bounded */
  }
  expect(refused.commit()).toBe(false);
  expect(adapter.getState()).toBe(previous);
  expect(reservations).toBe(1);
  admit = true;
  const stale = adapter.prepare(snapshot(100, [[1, leaf("a")]]));
  while (!stale.advance(1)) {
    /* bounded */
  }
  adapter.measureBatch([
    { id: previous.rows[0]!.value.businessKey!, height: 30 },
  ]);
  expect(stale.commit()).toBe(false);
  expect(adapter.getState().rows[0]!.height).toBe(30);
  expect(reservations).toBe(1);
});

it("keeps geometry when shared metric admission refuses a prepared projection", () => {
  let allow = true;
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
    measurementBudget: {
      prepare() {
        return allow ? { commit: () => true, cancel() {} } : undefined;
      },
    },
  });
  accept(adapter, snapshot(20, [[0, leaf("a")]]));
  const before = adapter.getState();
  allow = false;
  const pending = adapter.prepare(snapshot(30, [[0, leaf("a")]]));
  while (!pending.advance(2)) {
    /* bounded */
  }
  expect(pending.commit()).toBe(false);
  expect(adapter.getState()).toBe(before);
});

it("anchors to the accepted session through stale replacement and resets on new acceptance", () => {
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
  });
  const ready = {
    ...snapshot(100, [[0, leaf("a")]]),
    status: {
      state: "ready" as const,
      session: {
        queryKey: "q1",
        sessionId: "s1",
        resultToken: "v1",
        rootCount: 100,
      },
    },
  };
  accept(adapter, ready);
  const key = adapter.getState().rows[0]!.value.businessKey!;
  adapter.measureBatch([{ id: key, height: 70 }]);
  const presentation = adapter.getState().rows[0]!.value.presentationKey;
  const stale = {
    ...ready,
    generation: 2,
    status: { ...ready.status, state: "stale" as const },
  };
  accept(adapter, stale);
  expect(adapter.getState().rows[0]!.height).toBe(70);
  expect(adapter.getState().rows[0]!.value.presentationKey).toBe(presentation);
  accept(adapter, {
    ...ready,
    generation: 2,
    status: {
      state: "ready",
      session: { ...ready.status.session, sessionId: "s2", resultToken: "v2" },
    },
  });
  expect(adapter.getState().rows[0]!.height).toBe(20);
});

it("namespaces groups, typed leaf IDs and signed-zero status addresses", () => {
  const group: PretableRemoteNode<Row> = {
    kind: "group",
    id: "1",
    route: [],
    label: "group",
    childCount: 0,
    aggregates: {},
  };
  const keys = [group, leaf("1"), leaf(1), leaf(0), leaf(-0)].map(
    remote.remoteLayoutNodeKey,
  );
  expect(new Set(keys).size).toBe(5);
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
  });
  accept(adapter, {
    ...snapshot(2, []),
    readSlot(index) {
      return {
        kind: "unloaded",
        route: [{ columnId: "value", key: index === 0 ? -0 : 0 }],
        ordinal: 5,
      };
    },
  });
  expect(adapter.getState().rows[0]!.value.presentationKey).not.toBe(
    adapter.getState().rows[1]!.value.presentationKey,
  );
});

it("anchors shared-budget measurement eviction and clamps viewport resize", () => {
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
  });
  accept(
    adapter,
    snapshot(100, [
      [0, leaf("above")],
      [50, leaf("anchor")],
    ]),
  );
  const above = adapter.getState().rows[0]!.value.businessKey!;
  adapter.measureBatch([{ id: above, height: 60 }]);
  adapter.setViewport({ scrollTop: 1047, viewportHeight: 100, overscan: 0 });
  expect(adapter.getState().rows[0]!.value.slot).toMatchObject({
    kind: "loaded",
    node: { id: "anchor" },
  });
  expect(adapter.evictMeasurements([above])).toBe(true);
  expect(adapter.getState().scrollTop).toBe(1007);
  expect(adapter.getState().rows[0]!.top - adapter.getState().scrollTop).toBe(
    -7,
  );
  adapter.setViewport({ scrollTop: 2000, viewportHeight: 3000, overscan: 0 });
  expect(adapter.getState().scrollTop).toBe(0);
});

it("keeps disjoint branch status addresses stable when another branch collapses", () => {
  const routeA = [{ columnId: "value", key: "a" }],
    routeB = [{ columnId: "value", key: "b" }];
  const groupA: PretableRemoteNode<Row> = {
    kind: "group",
    id: "a",
    route: routeA,
    label: "a",
    childCount: 100,
    aggregates: {},
  };
  const groupB: PretableRemoteNode<Row> = {
    kind: "group",
    id: "b",
    route: routeB,
    label: "b",
    childCount: 200,
    aggregates: {},
  };
  const branched = (expanded: boolean): PretableRemoteModelSnapshot<Row> => {
    const b = expanded ? 101 : 1;
    const base = snapshot(expanded ? 302 : 202, [
      [0, groupA],
      [b, groupB],
      [b + 150, leaf("far")],
    ]);
    return {
      ...base,
      readSlot(index) {
        const loaded = base.readSlot(index);
        if (loaded?.kind === "loaded") return loaded;
        if (index < 0 || index >= base.displayCount) return;
        return index > b
          ? { kind: "unloaded", route: routeB, ordinal: index - b - 1 }
          : { kind: "unloaded", route: routeA, ordinal: index - 1 };
      },
    };
  };
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
  });
  accept(adapter, branched(true));
  adapter.setViewport({ scrollTop: 3000, viewportHeight: 40, overscan: 0 });
  const before = adapter.getState().rows[0]!.value;
  expect(before.slot).toMatchObject({
    kind: "unloaded",
    route: routeB,
    ordinal: 48,
  });
  accept(adapter, branched(false));
  adapter.setViewport({ scrollTop: 1000, viewportHeight: 40, overscan: 0 });
  expect(adapter.getState().rows[0]!.value.presentationKey).toBe(
    before.presentationKey,
  );
  adapter.reveal(151);
  expect(
    adapter
      .getState()
      .rows.some(
        (row) =>
          row.value.slot.kind === "loaded" &&
          row.value.slot.node.id === "far" &&
          row.top + row.height > adapter.getState().scrollTop &&
          row.top < adapter.getState().scrollTop + 40,
      ),
  ).toBe(true);
});

it("makes already scheduled preparation harmless after disposal", () => {
  const adapter = new remote.RemoteLayoutAdapter<Row>({
    estimate: 20,
    measurementCap: 10,
  });
  const pending = adapter.prepare(snapshot(100, [[0, leaf("a")]]));
  pending.advance(1);
  adapter.dispose();
  expect(pending.advance(1)).toBe(true);
  expect(pending.commit()).toBe(false);
  expect(() => pending.cancel()).not.toThrow();
});
