import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  isPretableGroupKey,
  type PretableAggregator,
  type PretableGroupId,
} from "../index";
import { getVisibleRangeDiagnosticsForTesting } from "../group-index";

interface Holding {
  id: string;
  sector: string | null;
  analyst: string | undefined;
  quantity: number;
  label: string;
}

const helper = createColumnHelper<Holding>();
const trace: PretableAggregator<Holding, string, string, string> = {
  init: () => "",
  accumulate: (accumulator, value) => `${accumulator}${value}`,
  merge: (left, right) => `${left}${right}`,
  finalize: (accumulator) => accumulator,
};
const columns = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("analyst", { type: "text" }),
  helper.accessor("quantity", { type: "number", aggregate: "sum" }),
  helper.accessor("label", { type: "text", aggregate: trace }),
] as const;
const rows: Holding[] = [
  {
    id: "a",
    sector: "Tech/Growth",
    analyst: "Ada=One",
    quantity: 10,
    label: "A",
  },
  { id: "b", sector: "Tech/Growth", analyst: "Bob", quantity: 20, label: "B" },
  {
    id: "c",
    sector: "Energy%Core",
    analyst: "Ada=One",
    quantity: 30,
    label: "C",
  },
  {
    id: "__group__:sector=s:Tech%2FGrowth",
    sector: null,
    analyst: undefined,
    quantity: 40,
    label: "D",
  },
];

function grouped(
  options: {
    readonly aggregateFilteredRows?: boolean;
    readonly filters?: readonly {
      readonly columnId: "quantity";
      readonly operator: "gte";
      readonly value: number;
    }[];
  } = {},
) {
  return createLocalRowModel({
    rows,
    columns,
    aggregateFilteredRows: options.aggregateFilteredRows,
    initialExpansion: { kind: "expanded" },
    query: {
      filters: options.filters ?? [],
      sort: [{ columnId: "quantity", direction: "desc" }],
      rowGroups: [
        { columnId: "sector", direction: "asc" },
        { columnId: "analyst", direction: "asc" },
      ],
    },
  });
}

function groupRows(model: ReturnType<typeof grouped>) {
  return model
    .getState()
    .snapshot.range(0, 100)
    .filter((row) => row.kind === "group");
}

describe("incremental grouped row model", () => {
  test("builds one and multi-level typed paths with escaped collision-proof IDs", () => {
    const model = grouped();
    const visible = model.getState().snapshot.range(0, 100);
    const groups = visible.filter((row) => row.kind === "group");

    expect(groups.map((group) => group.groupId)).toContain(
      "__group__:sector=s:Tech%2FGrowth/analyst=s:Ada%3DOne",
    );
    expect(groups.find((group) => group.value === null)).toMatchObject({
      columnId: "sector",
      childCount: 1,
    });
    expect(
      visible.some(
        (row) =>
          row.kind === "data" &&
          row.rowId === "__group__:sector=s:Tech%2FGrowth",
      ),
    ).toBe(true);
    expect(
      model.getState().snapshot.indexOf({
        kind: "group",
        groupId: "__group__:sector=s:Tech%2FGrowth" as PretableGroupId,
      }),
    ).toBeGreaterThanOrEqual(0);
    expect(
      model.getState().snapshot.indexOf({
        kind: "data",
        rowId: "__group__:sector=s:Tech%2FGrowth",
      }),
    ).toBeGreaterThanOrEqual(0);
  });

  test("orders sibling groups by compiled group policy and leaves by active sort", () => {
    const model = grouped();
    const visible = model.getState().snapshot.range(0, 100);
    expect(
      visible.flatMap((row) =>
        row.kind === "group" && row.depth === 0 ? [row.value] : [],
      ),
    ).toEqual(["Energy%Core", "Tech/Growth", null]);
    expect(
      visible.filter((row) => row.kind === "data").map((row) => row.rowId),
    ).toEqual(["c", "a", "b", "__group__:sector=s:Tech%2FGrowth"]);
  });

  test("moves a changed row between paths, prunes empties, and preserves deterministic identity on return", () => {
    const model = grouped();
    const techId = "__group__:sector=s:Tech%2FGrowth" as PretableGroupId;
    const before = groupRows(model).find((row) => row.groupId === techId)!;

    model.applyTransaction({
      update: [
        { id: "a", changes: { sector: "Energy%Core" } },
        { id: "b", changes: { sector: "Energy%Core" } },
      ],
    });
    expect(groupRows(model).some((row) => row.groupId === techId)).toBe(false);

    model.applyTransaction({
      update: [{ id: "a", changes: { sector: "Tech/Growth" } }],
    });
    const returned = groupRows(model).find((row) => row.groupId === techId)!;
    expect(returned.groupId).toBe(before.groupId);
    expect(returned.childCount).toBe(1);
  });

  test("keeps filtered and all populations and selects aggregate output once per model", () => {
    const filtered = grouped({
      filters: [{ columnId: "quantity", operator: "gte", value: 20 }],
    });
    const all = grouped({
      aggregateFilteredRows: true,
      filters: [{ columnId: "quantity", operator: "gte", value: 20 }],
    });
    const techId = "__group__:sector=s:Tech%2FGrowth";
    const filteredTech = groupRows(filtered).find(
      (row) => row.groupId === techId,
    )!;
    const allTech = groupRows(all).find((row) => row.groupId === techId)!;

    expect(filteredTech).toMatchObject({
      childCount: 1,
      aggregates: { quantity: 20, label: "B" },
    });
    expect(allTech).toMatchObject({
      childCount: 1,
      aggregates: { quantity: 30, label: "BA" },
    });
  });

  test("reuses untouched group and aggregate objects while observable values stay equal", () => {
    const model = grouped();
    const energyId = "__group__:sector=s:Energy%25Core";
    const before = groupRows(model).find((row) => row.groupId === energyId)!;
    const aggregates = before.aggregates;

    model.applyTransaction({
      update: [{ id: "a", changes: { quantity: 11 } }],
    });
    const after = groupRows(model).find((row) => row.groupId === energyId)!;

    expect(after).toBe(before);
    expect(after.aggregates).toBe(aggregates);
  });

  test("reuses observable group identity across an authoritative equal replacement", () => {
    const model = grouped();
    const techId = "__group__:sector=s:Tech%2FGrowth";
    const before = groupRows(model).find((row) => row.groupId === techId)!;

    model.setRows(rows.map((row) => ({ ...row })));
    const after = groupRows(model).find((row) => row.groupId === techId)!;

    expect(after).toBe(before);
    expect(after.aggregates).toBe(before.aggregates);
  });

  test("reuses structurally equal custom aggregate outputs after a changed leaf", () => {
    const objectSum: PretableAggregator<
      Holding,
      number,
      { readonly total: number },
      { readonly total: number }
    > = {
      init: () => ({ total: 0 }),
      accumulate: (accumulator, value) => ({
        total: accumulator.total + value,
      }),
      merge: (left, right) => ({ total: left.total + right.total }),
      finalize: (accumulator) => ({ total: accumulator.total }),
    };
    const objectColumns = [
      helper.accessor("sector", { type: "text" }),
      helper.accessor("quantity", {
        type: "number",
        aggregate: objectSum,
      }),
    ] as const;
    const model = createLocalRowModel({
      rows,
      columns: objectColumns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "sector" }],
      },
    });
    const before = model
      .getState()
      .snapshot.range(0, 20)
      .find((row) => row.kind === "group" && row.value === "Tech/Growth");
    if (before?.kind !== "group") throw new Error("missing Tech group");
    const output = before.aggregates.quantity;

    model.applyTransaction({
      update: [{ id: "a", changes: { label: "renamed" } }],
    });
    const after = model
      .getState()
      .snapshot.range(0, 20)
      .find((row) => row.kind === "group" && row.value === "Tech/Growth");
    expect(after).toBe(before);
    expect(after?.kind === "group" && after.aggregates.quantity).toBe(output);
  });

  test("uses a custom aggregator's accumulator snapshot automatically", () => {
    class TotalAccumulator {
      constructor(readonly total: number) {}
      label(): string {
        return `total:${this.total}`;
      }
    }
    const snapshotCalls = vi.fn(
      (accumulator: TotalAccumulator) =>
        new TotalAccumulator(accumulator.total),
    );
    const classTotal: PretableAggregator<
      Holding,
      number,
      TotalAccumulator,
      string
    > = {
      init: () => new TotalAccumulator(0),
      accumulate: (accumulator, value) =>
        new TotalAccumulator(accumulator.total + value),
      merge: (left, right) => new TotalAccumulator(left.total + right.total),
      snapshotAccumulator: snapshotCalls,
      finalize: (accumulator) => accumulator.label(),
    };
    const classColumns = [
      helper.accessor("sector", { type: "text" }),
      helper.accessor("quantity", {
        type: "number",
        aggregate: classTotal,
      }),
    ] as const;
    const model = createLocalRowModel({
      rows,
      columns: classColumns,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "sector" }],
      },
    });
    const tech = model
      .getState()
      .snapshot.range(0, 10)
      .find((row) => row.kind === "group" && row.value === "Tech/Growth");

    expect(tech?.kind === "group" && tech.aggregates.quantity).toBe("total:30");
    expect(snapshotCalls).toHaveBeenCalled();
  });

  test("rolls back atomically when a grouped aggregate callback fails", () => {
    let armed = false;
    const fragile: PretableAggregator<Holding, number, number, number> = {
      init: () => 0,
      accumulate: (accumulator, value) => accumulator + value,
      merge: (left, right) => {
        if (armed) throw new Error("aggregate exploded");
        return left + right;
      },
      finalize: (accumulator) => accumulator,
    };
    const fragileColumns = [
      helper.accessor("sector", { type: "text" }),
      helper.accessor("quantity", { type: "number", aggregate: fragile }),
    ] as const;
    const model = createLocalRowModel({
      rows,
      columns: fragileColumns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "sector" }],
      },
    });
    const before = model.getState();
    armed = true;

    expect(() =>
      model.applyTransaction({
        update: [{ id: "a", changes: { label: "not-published" } }],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "aggregator-failed",
        operation: "apply-transaction",
        rowId: "a",
        columnId: "quantity",
      }),
    );
    expect(model.getState()).toBe(before);
    expect(
      before.snapshot
        .range(0, 20)
        .find((row) => row.kind === "data" && row.rowId === "a"),
    ).toMatchObject({ row: { label: "A" } });
  });

  test("navigates parents, data-only order, and nearest visible ancestors without flattening", () => {
    const model = grouped();
    const snapshot = model.getState().snapshot;
    const row = snapshot
      .range(0, 100)
      .find((entry) => entry.kind === "data" && entry.rowId === "a")!;
    const parent = snapshot.parentGroupOf({ kind: "data", rowId: "a" })!;
    expect(parent).toMatchObject({ depth: 1, value: "Ada=One" });
    expect(
      snapshot.parentGroupOf({ kind: "group", groupId: parent.groupId }),
    ).toMatchObject({ depth: 0, value: "Tech/Growth" });
    expect(
      snapshot.dataRowAt(snapshot.indexOf({ kind: "data", rowId: "a" })),
    ).not.toBe(row);
    expect(snapshot.firstDataRow()?.rowId).toBe("c");
    expect(snapshot.lastDataRow()?.rowId).toBe(
      "__group__:sector=s:Tech%2FGrowth",
    );
  });

  test("keeps typed primitive group identities collision-proof", () => {
    interface KeyRow {
      id: number;
      key: unknown;
    }
    const keyHelper = createColumnHelper<KeyRow>();
    const keyColumns = [
      keyHelper.accessor(
        "key",
        (row): string | number | bigint | boolean | null | undefined =>
          row.key as
            string | number | bigint | boolean | null | undefined,
        {
          type: "number",
          compare: (left, right) => String(left).localeCompare(String(right)),
        },
      ),
    ] as const;
    const model = createLocalRowModel({
      rows: [
        { id: 1, key: "1" },
        { id: 2, key: 1 },
        { id: 3, key: Number.NaN },
        { id: 4, key: true },
        { id: 6, key: null },
        { id: 7, key: undefined },
        { id: 8, key: -0 },
        { id: 9, key: 0 },
        { id: 10, key: Infinity },
        { id: 11, key: -Infinity },
        { id: 12, key: 1n },
      ],
      columns: keyColumns,
      query: { filters: [], sort: [], rowGroups: [{ columnId: "key" }] },
    });
    const groups = model
      .getState()
      // Wide enough for groups and their expanded children.
      .snapshot.range(0, 100)
      .filter((row) => row.kind === "group");
    expect(groups).toHaveLength(10);
    expect(new Set(groups.map((row) => row.groupId)).size).toBe(10);
    expect(
      groups.find((row) => row.groupId.endsWith("key=~"))?.childCount,
    ).toBe(2);
    expect(groups.map((row) => row.groupId)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/key=n:NaN$/),
        expect.stringMatching(/key=n:-0$/),
        expect.stringMatching(/key=n:0$/),
        expect.stringMatching(/key=n:Infinity$/),
        expect.stringMatching(/key=n:-Infinity$/),
        expect.stringMatching(/key=i:1$/),
      ]),
    );
  });

  test.each([
    ["object", { label: "same stringification" }],
    ["symbol", Symbol("unsupported")],
    ["function", () => "unsupported"],
  ])(
    "rejects a runtime-bypassed %s group key before publication",
    (_label, key) => {
      interface UnsupportedKeyRow {
        id: number;
        key: unknown;
      }
      const unsupportedHelper = createColumnHelper<UnsupportedKeyRow>();
      const unsupportedColumns = [
        unsupportedHelper.accessor("key", { type: "text" }),
      ] as const;
      expect(() =>
        createLocalRowModel({
          rows: [{ id: 7, key }],
          columns: unsupportedColumns,
          query: {
            filters: [],
            sort: [],
            rowGroups: [{ columnId: "key" }],
          } as never,
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "invalid-group-key",
          operation: "set-rows",
          rowId: 7,
          columnId: "key",
          value: key,
          cause: expect.any(TypeError),
        }),
      );
    },
  );

  test("rejects every object group key without triggering proxy traps", () => {
    const trap = new Error("brand trap");
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw trap;
        },
      },
    );
    const dateProxy = new Proxy(new Date(0), {});
    const dateSpoof = Object.create(Date.prototype);

    expect(isPretableGroupKey(new Date(0))).toBe(false);
    expect(isPretableGroupKey(dateProxy)).toBe(false);
    expect(isPretableGroupKey(dateSpoof)).toBe(false);
    expect(isPretableGroupKey({})).toBe(false);
    expect(isPretableGroupKey([])).toBe(false);
    expect(() => isPretableGroupKey(hostile)).not.toThrow();
    expect(isPretableGroupKey(hostile)).toBe(false);
  });

  test.each([
    ["asc", ["2025-12-31", "2026-08-06", "2026-02-30", null]],
    ["desc", ["2026-08-06", "2025-12-31", "2026-02-30", null]],
  ] as const)(
    "orders valid calendar-date sibling groups first in %s order",
    (direction, expected) => {
      interface DatedGroupRow {
        id: number;
        asOf: string | null;
      }
      const dated = createColumnHelper<DatedGroupRow>();
      const datedColumns = [
        dated.accessor("asOf", { type: "date" }),
      ] as const;
      const model = createLocalRowModel({
        rows: [
          { id: 1, asOf: "2026-02-30" },
          { id: 2, asOf: "2026-08-06" },
          { id: 3, asOf: null },
          { id: 4, asOf: "2025-12-31" },
        ],
        columns: datedColumns,
        query: {
          filters: [],
          sort: [],
          rowGroups: [{ columnId: "asOf", direction, nulls: "first" }],
        },
        initialExpansion: { kind: "collapsed" },
      });

      expect(
        model
          .getState()
          .snapshot.range(0, 10)
          .flatMap((row) => (row.kind === "group" ? [row.value] : [])),
      ).toEqual(expected);
    },
  );

  test.each([
    ["construction", "set-rows"],
    ["transaction", "apply-transaction"],
    ["query transition", "set-query"],
  ] as const)(
    "wraps a hostile Proxy group key during %s",
    async (scenario, operation) => {
      interface HostileKeyRow {
        id: number;
        key: unknown;
      }
      const trap = new Error(`${scenario} getPrototypeOf exploded`);
      const key = new Proxy(
        {},
        {
          getPrototypeOf: () => {
            throw trap;
          },
        },
      );
      const hostileHelper = createColumnHelper<HostileKeyRow>();
      const hostileColumns = [
        hostileHelper.accessor("key", { type: "text" }),
      ] as const;
      const groupedQuery = {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "key" }],
      } as never;
      let before: unknown;
      const listener = vi.fn<() => void>();
      let getState: (() => unknown) | undefined;
      const action = (() => {
        if (scenario === "construction") {
          return () =>
            createLocalRowModel({
              rows: [{ id: 7, key }],
              columns: hostileColumns,
              query: groupedQuery,
            });
        }
        const model = createLocalRowModel({
          rows: [{ id: 7, key: "supported" }],
          columns: hostileColumns,
          ...(scenario === "transaction" ? { query: groupedQuery } : {}),
        });
        before = model.getState();
        getState = () => model.getState();
        model.subscribe(listener);
        if (scenario === "transaction") {
          return () =>
            model.applyTransaction({
              update: [{ id: 7, changes: { key } }],
            });
        }
        model.setRows([{ id: 7, key }]);
        before = model.getState();
        listener.mockClear();
        return () => model.setQuery(groupedQuery);
      })();

      let caught: unknown;
      try {
        const result = action();
        if (scenario === "query transition") {
          await (result as { readonly finished: Promise<number> }).finished;
        }
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({
        code: "invalid-group-key",
        operation,
        rowId: 7,
        columnId: "key",
      });
      expect((caught as { readonly value?: unknown }).value).toBe(key);
      expect((caught as Error).cause).toBe(trap);
      if (scenario !== "construction") {
        if (scenario === "query transition") {
          expect(listener).toHaveBeenCalledTimes(1);
          expect(getState?.()).toMatchObject({
            snapshot: (before as { readonly snapshot: unknown }).snapshot,
            status: { kind: "error" },
          });
        } else {
          expect(listener).not.toHaveBeenCalled();
          expect(getState?.()).toBe(before);
        }
      }
    },
  );

  test(
    "bounds changed-path and indexed-read comparator work with high cardinality",
    { timeout: 30_000 },
    () => {
      interface LargeRow {
        id: number;
        group: number;
        score: number;
      }
      const compare = vi.fn((left: number, right: number) => left - right);
      const largeHelper = createColumnHelper<LargeRow>();
      const largeColumns = [
        largeHelper.accessor("group", { type: "number", compare }),
        largeHelper.accessor("score", { type: "number" }),
      ] as const;
      const model = createLocalRowModel({
        rows: Array.from({ length: 20_000 }, (_, id) => ({
          id,
          group: id,
          score: id,
        })),
        columns: largeColumns,
        initialExpansion: { kind: "expanded" },
        query: { filters: [], sort: [], rowGroups: [{ columnId: "group" }] },
      });
      compare.mockClear();

      model.applyTransaction({
        update: [{ id: 10_000, changes: { score: -1 } }],
      });
      expect(compare.mock.calls.length).toBeLessThan(300);
      compare.mockClear();
      expect(model.getState().snapshot.rowAt(39_999)).toMatchObject({
        kind: "data",
        rowId: 19_999,
      });
      expect(compare).not.toHaveBeenCalled();
      model.collapseAll();
      model.expandAll();
      expect(compare).not.toHaveBeenCalled();
    },
  );

  test("keeps a one-row authoritative replacement logarithmic at 100k unique groups", () => {
    interface LargeRow {
      id: number;
      group: number;
      score: number;
    }
    const groupAccessor = vi.fn((row: LargeRow) => row.group);
    const scoreAccessor = vi.fn((row: LargeRow) => row.score);
    const compareGroups = vi.fn((left: number, right: number) => left - right);
    const largeHelper = createColumnHelper<LargeRow>();
    const largeColumns = [
      largeHelper.accessor("group", groupAccessor, {
        type: "number",
        compare: compareGroups,
      }),
      largeHelper.accessor("score", scoreAccessor, { type: "number" }),
    ] as const;
    const input = Array.from({ length: 100_000 }, (_, id) => ({
      id,
      group: id,
      score: id,
    }));
    const model = createLocalRowModel({
      rows: input,
      columns: largeColumns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [{ columnId: "score", direction: "asc" }],
        rowGroups: [{ columnId: "group" }],
      },
    });
    const untouched = model.getState().snapshot.rowAt(20_000);
    groupAccessor.mockClear();
    scoreAccessor.mockClear();
    compareGroups.mockClear();
    const replacement = [...input];
    replacement[50_000] = { ...replacement[50_000]!, score: -1 };

    model.setRows(replacement);

    expect(groupAccessor).toHaveBeenCalledTimes(1);
    expect(scoreAccessor).toHaveBeenCalledTimes(1);
    expect(compareGroups.mock.calls.length).toBeLessThan(500);
    expect(model.getState().snapshot.rowAt(20_000)).toBe(untouched);
  }, 60_000);

  test("reads a 50-row window from 100k unique groups with one logarithmic seek", () => {
    interface LargeRow {
      id: number;
      group: number;
    }
    const largeHelper = createColumnHelper<LargeRow>();
    const largeColumns = [
      largeHelper.accessor("group", { type: "number" }),
    ] as const;
    const model = createLocalRowModel({
      rows: Array.from({ length: 100_000 }, (_, id) => ({ id, group: id })),
      columns: largeColumns,
      initialExpansion: { kind: "expanded" },
      query: { filters: [], sort: [], rowGroups: [{ columnId: "group" }] },
    });
    const snapshot = model.getState().snapshot;
    const start = 150_000;
    const window = snapshot.range(start, start + 50);

    expect(window).toEqual(
      Array.from({ length: 50 }, (_, offset) => snapshot.rowAt(start + offset)),
    );
    expect(window).toHaveLength(50);
    expect(getVisibleRangeDiagnosticsForTesting(window)).toMatchObject({
      measuredNodeVisits: expect.any(Number),
    });
    expect(
      getVisibleRangeDiagnosticsForTesting(window).measuredNodeVisits,
    ).toBeLessThan(100);
  }, 60_000);

  test("matches indexed rows for randomized nested windows and overrides", () => {
    interface NestedRow {
      id: number;
      region: number;
      team: number;
    }
    const nestedHelper = createColumnHelper<NestedRow>();
    const nestedColumns = [
      nestedHelper.accessor("region", { type: "number" }),
      nestedHelper.accessor("team", { type: "number" }),
    ] as const;
    const model = createLocalRowModel({
      rows: Array.from({ length: 1_000 }, (_, id) => ({
        id,
        region: id % 19,
        team: id % 41,
      })),
      columns: nestedColumns,
      initialExpansion: { kind: "through-depth", depth: 0 },
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "region" }, { columnId: "team" }],
      },
    });
    for (const region of [1, 5, 13]) {
      model.setGroupExpanded(
        `__group__:region=n:${region}` as PretableGroupId,
        false,
      );
    }
    let seed = 0x9e37_79b9;
    const random = () => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed;
    };
    const snapshot = model.getState().snapshot;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const start = (random() % (snapshot.visibleRowCount + 40)) - 20;
      const length = random() % 80;
      const expectedStart = Math.max(0, start);
      const expectedEnd = Math.min(
        snapshot.visibleRowCount,
        Math.max(0, start + length),
      );
      expect(snapshot.range(start, start + length)).toEqual(
        Array.from(
          { length: Math.max(0, expectedEnd - expectedStart) },
          (_, offset) => snapshot.rowAt(expectedStart + offset),
        ),
      );
    }
  });

  test("wraps finalize failures and preserves the exact grouped revision", async () => {
    let armed = false;
    const fragile: PretableAggregator<Holding, number, number, number> = {
      init: () => 0,
      accumulate: (accumulator, value) => accumulator + value,
      merge: (left, right) => left + right,
      finalize: (accumulator) => {
        if (armed) throw new Error("finalize exploded");
        return accumulator;
      },
    };
    const fragileColumns = [
      helper.accessor("sector", { type: "text" }),
      helper.accessor("quantity", { type: "number", aggregate: fragile }),
    ] as const;
    const model = createLocalRowModel({
      rows,
      columns: fragileColumns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "sector" }],
      },
    });
    const before = model.getState();
    armed = true;

    expect(() =>
      model.applyTransaction({
        update: [{ id: "a", changes: { label: "not-published" } }],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "aggregator-failed",
        operation: "apply-transaction",
        rowId: "a",
        columnId: "quantity",
        groupValues: ["Tech/Growth"],
        cause: expect.objectContaining({ message: "finalize exploded" }),
      }),
    );
    expect(model.getState()).toBe(before);

    expect(() =>
      model.setRows(
        rows.map((row) =>
          row.id === "a" ? { ...row, label: "still-not-published" } : row,
        ),
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "aggregator-failed",
        operation: "set-rows",
        rowId: "a",
        columnId: "quantity",
        groupValues: ["Tech/Growth"],
      }),
    );
    expect(model.getState()).toBe(before);

    await expect(
      model.setQuery({
        filters: [],
        sort: [{ columnId: "quantity", direction: "desc" }],
        rowGroups: [{ columnId: "sector" }],
      }).finished,
    ).rejects.toEqual(
      expect.objectContaining({
        code: "aggregator-failed",
        operation: "set-query",
        rowId: "a",
        columnId: "quantity",
        groupValues: ["Tech/Growth"],
      }),
    );
    expect(model.getState().snapshot).toBe(before.snapshot);
    expect(model.getState().status).toMatchObject({ kind: "error" });
  });

  test("wraps an initial grouped finalize failure with construction context", () => {
    const failing: PretableAggregator<Holding, number, number, number> = {
      init: () => 0,
      accumulate: (accumulator, value) => accumulator + value,
      merge: (left, right) => left + right,
      finalize: () => {
        throw new Error("initial finalize exploded");
      },
    };
    const failingColumns = [
      helper.accessor("sector", { type: "text" }),
      helper.accessor("quantity", { type: "number", aggregate: failing }),
    ] as const;

    expect(() =>
      createLocalRowModel({
        rows,
        columns: failingColumns,
        query: {
          filters: [],
          sort: [],
          rowGroups: [{ columnId: "sector" }],
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "aggregator-failed",
        operation: "set-rows",
        rowId: "a",
        columnId: "quantity",
        groupValues: ["Tech/Growth"],
        cause: expect.objectContaining({
          message: "initial finalize exploded",
        }),
      }),
    );
  });
});
