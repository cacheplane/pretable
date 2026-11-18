import { expect, test } from "vitest";
import {
  createColumnHelper,
  createLocalRowModel,
  mergeColumnAggregateOverrides,
  ɵsetLocalRowModelSortAuthority,
  ɵsetLocalRowModelFilterAuthority,
} from "../index";

const helper = createColumnHelper<{ id: number; n: number }>();
const columns = [
  helper.accessor("id", { type: "number" }),
  helper.accessor("n", { type: "number", aggregate: "sum" }),
  helper.accessor("average", (row) => row.n, {
    type: "number",
    aggregate: "avg",
  }),
  helper.accessor("count", (row) => row.n, {
    type: "number",
    aggregate: "count",
  }),
] as const;

test("summaries are leased immutable input aggregates independent of visible rows", async () => {
  const model = createLocalRowModel({
    columns,
    rows: [
      { id: 1, n: 10 },
      { id: 2, n: 30 },
    ],
    transitionClock: () => 0,
  });
  const initial = model.getState().snapshot;
  expect(initial.getSummary?.("all")).toBeUndefined();
  expect(model.acquireSummaryScopes).toBeTypeOf("function");
  const release = model.acquireSummaryScopes!(["all", "filtered"]);
  const held = model.getState().snapshot;
  expect(held.getSummary!("all")?.values).toEqual({
    n: 40,
    average: 20,
    count: 2,
  });
  expect(held.getSummary!("all")).toBe(held.getSummary!("all"));
  await model.setQuery({
    filters: [{ columnId: "id", operator: "gte", value: 2 }],
    sort: [],
    rowGroups: [],
  }).finished;
  const filtered = model.getState().snapshot;
  expect(filtered.getSummary!("filtered")?.values).toEqual({
    n: 30,
    average: 30,
    count: 1,
  });
  expect(filtered.getSummary!("all")?.values.n).toBe(40);
  expect(filtered.range(0, 10)).toHaveLength(1);
  expect(held.getSummary!("filtered")?.values.n).toBe(40);
  release();
  release();
  expect(model.getState().snapshot.getSummary!("all")).toBeUndefined();
  model.dispose();
  release();
});

test("leases share roots, streaming mutations and replacements update both scopes atomically", async () => {
  const model = createLocalRowModel({
    columns,
    rows: [
      { id: 1, n: 10 },
      { id: 2, n: 30 },
    ],
    transitionClock: () => 0,
  });
  const one = model.acquireSummaryScopes!(["all", "filtered"]);
  const two = model.acquireSummaryScopes!(["all"]);
  one();
  expect(model.getState().snapshot.getSummary!("all")?.values.n).toBe(40);
  expect(model.getState().snapshot.getSummary!("filtered")).toBeUndefined();
  model.applyTransaction({
    update: [{ id: 1, changes: { n: 50 } }],
    remove: [2],
    add: [{ id: 3, n: 20 }],
  });
  expect(model.getState().snapshot.getSummary!("all")?.values).toEqual({
    n: 70,
    average: 35,
    count: 2,
  });
  model.setRows([{ id: 4, n: 9 }]);
  expect(model.getState().snapshot.getSummary!("all")?.values.n).toBe(9);
  two();
  model.dispose();
});

test("empty and invalid numeric/date values retain aggregate empty semantics", () => {
  const h = createColumnHelper<{
    id: number;
    n: number | null;
    date: string | null;
  }>();
  const cols = [
    h.accessor("n", { type: "number", aggregate: "sum" }),
    h.accessor("avg", (r) => r.n, { type: "number", aggregate: "avg" }),
    h.accessor("count", (r) => r.n, { type: "number", aggregate: "count" }),
    h.accessor("date", { type: "date", aggregate: "min" }),
  ] as const;
  const model = createLocalRowModel({
    columns: cols,
    rows: [],
    transitionClock: () => 0,
  });
  model.acquireSummaryScopes!(["all"]);
  expect(model.getState().snapshot.getSummary!("all")?.values).toEqual({
    n: null,
    avg: null,
    count: null,
    date: null,
  });
  model.setRows([
    { id: 1, n: NaN, date: "2026-02-30" },
    { id: 2, n: null, date: null },
    { id: 3, n: 6, date: "2026-11-13" },
  ]);
  expect(model.getState().snapshot.getSummary!("all")?.values).toEqual({
    n: 6,
    avg: 6,
    count: 3,
    date: "2026-11-13",
  });
  model.dispose();
});

test("group collapse and expansion do no aggregate work; weighted averages use source rows", async () => {
  const h = createColumnHelper<{
    id: number;
    group: string;
    sub: string;
    n: number;
  }>();
  let folds = 0;
  const cols = [
    h.accessor("group", { type: "text" }),
    h.accessor("sub", { type: "text" }),
    h.accessor("n", { type: "number", aggregate: "avg" }),
    h.accessor("fold", (r) => r.n, {
      type: "number",
      aggregate: {
        init: () => 0,
        accumulate: (a: number, v: number) => {
          folds++;
          return a + v;
        },
        merge: (a: number, b: number) => a + b,
        finalize: (a: number) => a,
      },
    }),
  ] as const;
  const model = createLocalRowModel({
    columns: cols,
    rows: [
      { id: 1, group: "a", sub: "x", n: 10 },
      { id: 2, group: "b", sub: "x", n: 30 },
      { id: 3, group: "b", sub: "y", n: 50 },
    ],
    query: {
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "group" }, { columnId: "sub" }],
    },
    transitionClock: () => 0,
  });
  model.acquireSummaryScopes!(["all", "filtered"]);
  const result = model.getState().snapshot.getSummary!("filtered");
  expect(result?.values.n).toBe(30);
  const before = folds;
  model.collapseAll();
  model.expandAll();
  for (let i = 0; i < 50; i++)
    expect(model.getState().snapshot.getSummary!("filtered")).toBe(result);
  expect(folds).toBe(before);
  await model.setQuery({
    filters: [{ columnId: "n", operator: "gt", value: 100 }],
    sort: [],
    rowGroups: [{ columnId: "group" }],
  }).finished;
  expect(
    model.getState().snapshot.getSummary!("filtered")?.values.n,
  ).toBeNull();
  expect(model.getState().snapshot.getSummary!("all")?.values.n).toBe(30);
  model.dispose();
});

test("a failing summary transaction preserves live slot ownership and the previous result", () => {
  const h = createColumnHelper<{ id: number; n: number }>();
  const cols = [
    h.accessor("n", {
      type: "number",
      aggregate: {
        init: () => 0,
        accumulate: (a: number, v: number) => {
          if (v === 99) throw new Error("bad value");
          return a + v;
        },
        merge: (a: number, b: number) => a + b,
        finalize: (a: number) => a,
      },
    }),
  ] as const;
  const model = createLocalRowModel({
    columns: cols,
    rows: [
      { id: 1, n: 10 },
      { id: 2, n: 20 },
    ],
    transitionClock: () => 0,
  });
  model.acquireSummaryScopes!(["all"]);
  const held = model.getState().snapshot;
  expect(() =>
    model.applyTransaction({ remove: [1], add: [{ id: 3, n: 99 }] }),
  ).toThrow();
  expect(model.getState().snapshot).toBe(held);
  model.applyTransaction({ add: [{ id: 4, n: 40 }] });
  const next = model.getState().snapshot;
  expect(next.ɵslotOfRowId!(1)).not.toBe(next.ɵslotOfRowId!(4));
  expect(next.getSummary!("all")?.values.n).toBe(70);
  model.dispose();
});

function scheduled() {
  const tasks = new Set<() => void>();
  return {
    scheduler: {
      schedule(task: () => void) {
        tasks.add(task);
        return () => {
          tasks.delete(task);
        };
      },
    },
    tick() {
      const task = tasks.values().next().value;
      if (task) {
        tasks.delete(task);
        task();
      }
    },
    drain() {
      let remaining = 100000;
      while (tasks.size && remaining-- > 0) this.tick();
      expect(tasks.size).toBe(0);
    },
    get size() {
      return tasks.size;
    },
  };
}

test("pending query, scope acquisition/release and mutations commit coherent generations", async () => {
  const clock = scheduled();
  const model = createLocalRowModel({
    columns,
    rows: [
      { id: 1, n: 10 },
      { id: 2, n: 30 },
    ],
    transitionClock: () => 0,
    transitionMaxUnitsPerSlice: 1,
    transitionScheduler: clock.scheduler,
  });
  const query = model.setQuery({
    filters: [{ columnId: "id", operator: "gte", value: 2 }],
    sort: [],
    rowGroups: [],
  });
  const release = model.acquireSummaryScopes!(["all", "filtered"]);
  expect(model.getState().snapshot.getSummary!("all")).toBeUndefined();
  model.applyTransaction({
    update: [{ id: 2, changes: { n: 50 } }],
    add: [{ id: 3, n: 70 }],
  });
  clock.tick();
  const second = model.acquireSummaryScopes!(["filtered"]);
  release();
  clock.drain();
  await query.finished;
  const snapshot = model.getState().snapshot;
  expect(snapshot.getSummary!("all")).toBeUndefined();
  expect(snapshot.getSummary!("filtered")?.values.n).toBe(120);
  expect(
    snapshot.range(0, 10).map((r) => (r.kind === "data" ? r.rowId : undefined)),
  ).toEqual([2, 3]);
  second();
  model.dispose();
  expect(clock.size).toBe(0);
});

test("cancelling a query preserves committed summaries and disposal cancels acquisition", async () => {
  const clock = scheduled();
  const model = createLocalRowModel({
    columns,
    rows: [
      { id: 1, n: 10 },
      { id: 2, n: 30 },
    ],
    transitionClock: () => 0,
    transitionMaxUnitsPerSlice: 1,
    transitionScheduler: clock.scheduler,
  });
  const release = model.acquireSummaryScopes!(["all", "filtered"]);
  clock.drain();
  const held = model.getState().snapshot;
  const transition = model.setQuery({
    filters: [{ columnId: "id", operator: "gte", value: 2 }],
    sort: [],
    rowGroups: [],
  });
  transition.cancel();
  clock.drain();
  await expect(transition.finished).rejects.toThrow();
  expect(model.getState().snapshot).toBe(held);
  release();
  const late = model.acquireSummaryScopes!(["all"]);
  model.dispose();
  late();
  expect(clock.size).toBe(0);
});

test("custom folds follow local sort and external source order; overrides rebuild results", async () => {
  const h = createColumnHelper<{ id: number; n: number }>();
  const cols = [
    h.accessor("id", { type: "number" }),
    h.accessor("n", { type: "number", aggregate: "sum" }),
    h.accessor("ordered", (r) => String(r.n), {
      type: "text",
      aggregate: {
        init: () => "",
        accumulate: (a: string, v: string) => a + v + ",",
        merge: (a: string, b: string) => a + b,
        finalize: (a: string) => a,
      },
    }),
  ] as const;
  const model = createLocalRowModel({
    columns: cols,
    rows: [
      { id: 1, n: 10 },
      { id: 2, n: 30 },
    ],
    transitionClock: () => 0,
  });
  model.acquireSummaryScopes!(["all", "filtered"]);
  expect(model.getState().snapshot.getSummary!("all")?.values.ordered).toBe(
    "10,30,",
  );
  await model.setQuery({
    filters: [],
    sort: [{ columnId: "n", direction: "desc" }],
    rowGroups: [],
  }).finished;
  expect(model.getState().snapshot.getSummary!("all")?.values.ordered).toBe(
    "30,10,",
  );
  ɵsetLocalRowModelSortAuthority(model, "external");
  expect(model.getState().snapshot.getSummary!("all")?.values.ordered).toBe(
    "10,30,",
  );
  await model.setDerivations(
    mergeColumnAggregateOverrides(cols, { n: "count" }),
  ).finished;
  expect(model.getState().snapshot.getSummary!("all")?.values.n).toBe(2);
  await model.setQuery({
    filters: [{ columnId: "id", operator: "gte", value: 2 }],
    sort: [],
    rowGroups: [],
  }).finished;
  expect(model.getState().snapshot.getSummary!("filtered")?.values.n).toBe(1);
  ɵsetLocalRowModelFilterAuthority(model, "external");
  expect(model.getState().snapshot.getSummary!("filtered")?.values.n).toBe(2);
  model.dispose();
});

test("summary delta work is bounded and disabled models allocate no summary roots", async () => {
  const { createInstrumentedLocalRowModel } = await import("../diagnostics");
  const { getLocalRowModelSlotInternalsForTesting } =
    await import("../create-local-row-model");
  const h = createColumnHelper<{ id: number; n: number }>();
  const cols = [
    h.accessor("n", { type: "number", aggregate: "sum" }),
    h.accessor("min", (r) => r.n, { type: "number", aggregate: "min" }),
  ] as const;
  const rows = Array.from({ length: 2048 }, (_, id) => ({ id, n: id }));
  const enabled = createInstrumentedLocalRowModel({
    columns: cols,
    rows,
    transitionClock: () => 0,
    transitionMaxUnitsPerSlice: 10000,
  });
  const disabled = createInstrumentedLocalRowModel({
    columns: cols,
    rows,
    transitionClock: () => 0,
  });
  const release = enabled.model.acquireSummaryScopes!(["all", "filtered"]);
  enabled.diagnostics.resetWork();
  disabled.diagnostics.resetWork();
  const tx = { update: [{ id: 100, changes: { n: 9999 } }] };
  enabled.model.applyTransaction(tx);
  disabled.model.applyTransaction(tx);
  const work = enabled.diagnostics.read().work;
  expect(work.summaryRowsVisited).toBe(4);
  expect(work.summaryCellsUpdated).toBe(8);
  expect(work.aggregateMerges).toBeLessThan(200);
  expect(disabled.diagnostics.read().work.summaryCellsUpdated).toBe(0);
  expect(
    getLocalRowModelSlotInternalsForTesting(disabled.model).root.summaries,
  ).toBeUndefined();
  enabled.diagnostics.resetWork();
  for (let i = 0; i < 100; i++)
    enabled.model.getState().snapshot.getSummary!("all");
  expect(enabled.diagnostics.read().work.summaryCellsUpdated).toBe(0);
  release();
  expect(
    getLocalRowModelSlotInternalsForTesting(enabled.model).root.summaries,
  ).toBeUndefined();
  enabled.model.dispose();
  disabled.model.dispose();
});

test("pending acquisition survives accepted same-reference replacements", () => {
  const clock = scheduled();
  const rows = [Object.preventExtensions({ id: 1, n: 10 }), { id: 2, n: 30 }];
  const model = createLocalRowModel({
    columns,
    rows,
    transitionClock: () => 0,
    transitionMaxUnitsPerSlice: 1,
    transitionScheduler: clock.scheduler,
  });
  model.acquireSummaryScopes!(["all"]);
  rows[0]!.n = 70;
  model.setRows(rows);
  clock.drain();
  expect(model.getState().snapshot.getSummary!("all")?.values.n).toBe(100);
  model.dispose();
});

test("summary publication does not invalidate data change history", () => {
  const model = createLocalRowModel({
    columns,
    rows: [{ id: 1, n: 10 }],
    transitionClock: () => 0,
  });
  const revision = model.getState().snapshot.revision;
  model.acquireSummaryScopes!(["all"]);
  expect(model.changesSince(revision).kind).toBe("changes");
  model.dispose();
});

test("grouped summary failures preserve the committed revision and live slots", () => {
  const h = createColumnHelper<{ id: number; group: string; n: number }>();
  const cols = [
    h.accessor("group", { type: "text" }),
    h.accessor("n", {
      type: "number",
      aggregate: {
        init: () => 0,
        accumulate: (a: number, v: number) => {
          if (v === 99) throw new Error("bad value");
          return a + v;
        },
        merge: (a: number, b: number) => a + b,
        finalize: (a: number) => a,
      },
    }),
  ] as const;
  const model = createLocalRowModel({
    columns: cols,
    rows: [
      { id: 1, group: "a", n: 10 },
      { id: 2, group: "b", n: 20 },
    ],
    query: { filters: [], sort: [], rowGroups: [{ columnId: "group" }] },
    transitionClock: () => 0,
  });
  model.acquireSummaryScopes!(["all"]);
  const held = model.getState().snapshot;
  expect(() => model.setRows([{ id: 3, group: "a", n: 99 }])).toThrow();
  expect(model.getState().snapshot).toBe(held);
  model.applyTransaction({ add: [{ id: 4, group: "c", n: 40 }] });
  expect(model.getState().snapshot.getSummary!("all")?.values.n).toBe(70);
  model.dispose();
});

test("failed acquisition rolls back its lease and forbids reentrant mutation", () => {
  const h = createColumnHelper<{ id: number; n: number }>();
  let mutate = () => {};
  const cols = [
    h.accessor("n", {
      type: "number",
      aggregate: {
        init: () => 0,
        accumulate: (a: number, v: number) => a + v,
        merge: (a: number, b: number) => a + b,
        finalize: (a: number) => {
          mutate();
          return a;
        },
      },
    }),
  ] as const;
  const model = createLocalRowModel({
    columns: cols,
    rows: [{ id: 1, n: 10 }],
    transitionClock: () => 0,
  });
  const held = model.getState().snapshot;
  mutate = () => {
    model.applyTransaction({ add: [{ id: 2, n: 20 }] });
  };
  expect(() => model.acquireSummaryScopes!(["all"])).toThrow();
  expect(model.getState().snapshot).toBe(held);
  mutate = () => {};
  const release = model.acquireSummaryScopes!(["all"]);
  expect(model.getState().snapshot.getSummary!("all")?.values.n).toBe(10);
  release();
  expect(model.getState().snapshot.getSummary!("all")).toBeUndefined();
  model.dispose();
});

test("a failed new consumer preserves another consumer's pending acquisition; release runs no aggregates", () => {
  const clock = scheduled();
  let fail = false;
  const h = createColumnHelper<{ id: number; n: number }>();
  const cols = [
    h.accessor("n", {
      type: "number",
      aggregate: {
        init: () => {
          if (fail) throw new Error("init failed");
          return 0;
        },
        accumulate: (a: number, v: number) => a + v,
        merge: (a: number, b: number) => a + b,
        finalize: (a: number) => a,
      },
    }),
  ] as const;
  const model = createLocalRowModel({
    columns: cols,
    rows: [
      { id: 1, n: 10 },
      { id: 2, n: 30 },
    ],
    transitionClock: () => 0,
    transitionMaxUnitsPerSlice: 1,
    transitionScheduler: clock.scheduler,
  });
  const a = model.acquireSummaryScopes!(["filtered"]);
  fail = true;
  expect(() => model.acquireSummaryScopes!(["all"])).toThrow("init failed");
  fail = false;
  clock.drain();
  expect(model.getState().snapshot.getSummary!("filtered")?.values.n).toBe(40);
  const b = model.acquireSummaryScopes!(["all"]);
  fail = true;
  expect(() => b()).not.toThrow();
  a();
  model.dispose();
});

test("releasing a failed pending scope restarts remaining requested computation", () => {
  const clock = scheduled();
  const h = createColumnHelper<{ id: number; n: number }>();
  const cols = [
    h.accessor("n", {
      type: "number",
      aggregate: {
        init: () => 0,
        accumulate: (a: number, v: number) => {
          if (v === 99) throw new Error("bad");
          return a + v;
        },
        merge: (a: number, b: number) => a + b,
        finalize: (a: number) => a,
      },
    }),
  ] as const;
  const model = createLocalRowModel({
    columns: cols,
    rows: [
      { id: 1, n: 10 },
      { id: 2, n: 99 },
    ],
    query: {
      filters: [{ columnId: "n", operator: "lt", value: 99 }],
      sort: [],
      rowGroups: [],
    },
    transitionClock: () => 0,
    transitionMaxUnitsPerSlice: 1,
    transitionScheduler: clock.scheduler,
  });
  const a = model.acquireSummaryScopes!(["filtered"]);
  const b = model.acquireSummaryScopes!(["all"]);
  clock.drain();
  b();
  clock.drain();
  expect(model.getState().snapshot.getSummary!("filtered")?.values.n).toBe(10);
  a();
  model.dispose();
});

test("summary initialization failure settles a superseding transition without stranding rebuilding status", async () => {
  const clock = scheduled();
  let fail = false;
  const h = createColumnHelper<{ id: number; n: number }>();
  const cols = [
    h.accessor("n", {
      type: "number",
      aggregate: {
        init: () => {
          if (fail) throw new Error("init failed");
          return 0;
        },
        accumulate: (a: number, v: number) => a + v,
        merge: (a: number, b: number) => a + b,
        finalize: (a: number) => a,
      },
    }),
  ] as const;
  const model = createLocalRowModel({
    columns: cols,
    rows: [
      { id: 1, n: 10 },
      { id: 2, n: 30 },
    ],
    transitionClock: () => 0,
    transitionMaxUnitsPerSlice: 1,
    transitionScheduler: clock.scheduler,
  });
  model.acquireSummaryScopes!(["all"]);
  clock.drain();
  const held = model.getState().snapshot;
  const old = model.setQuery({
    filters: [{ columnId: "n", operator: "gte", value: 20 }],
    sort: [],
    rowGroups: [],
  });
  expect(model.getState().status.kind).toBe("rebuilding");
  fail = true;
  let next: ReturnType<typeof model.setQuery> | undefined;
  expect(() => {
    next = model.setQuery({
      filters: [],
      sort: [{ columnId: "n", direction: "desc" }],
      rowGroups: [],
    });
  }).not.toThrow();
  await expect(next!.finished).rejects.toThrow();
  await expect(old.finished).rejects.toThrow();
  expect(model.getState().status.kind).toBe("error");
  expect(model.getState().snapshot).toBe(held);
  expect(clock.size).toBe(0);
  model.dispose();
});

test("rebasing a pending acquisition does not execute custom initialization during row publication", () => {
  const clock = scheduled();
  let fail = false;
  const h = createColumnHelper<{ id: number; n: number }>();
  const cols = [
    h.accessor("n", {
      type: "number",
      aggregate: {
        init: () => {
          if (fail) throw new Error("init failed");
          return 0;
        },
        accumulate: (a: number, v: number) => a + v,
        merge: (a: number, b: number) => a + b,
        finalize: (a: number) => a,
      },
    }),
  ] as const;
  const rows = [Object.preventExtensions({ id: 1, n: 10 }), { id: 2, n: 30 }];
  const model = createLocalRowModel({
    columns: cols,
    rows,
    transitionClock: () => 0,
    transitionMaxUnitsPerSlice: 1,
    transitionScheduler: clock.scheduler,
  });
  model.acquireSummaryScopes!(["all"]);
  rows[0]!.n = 70;
  fail = true;
  expect(() => model.setRows(rows)).not.toThrow();
  expect(model.getState().snapshot.sourceRowCount).toBe(2);
  clock.drain();
  expect(model.getState().status.kind).toBe("error");
  model.dispose();
});
