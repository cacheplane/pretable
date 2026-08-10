import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableAggregator,
  type PretableGroupId,
} from "../index";

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

  test("keeps typed primitive and Date group identities collision-proof", () => {
    interface KeyRow {
      id: number;
      key: unknown;
    }
    const keyHelper = createColumnHelper<KeyRow>();
    const keyColumns = [
      keyHelper.accessor(
        "key",
        (row): string | number | boolean | Date | null | undefined =>
          row.key as string | number | boolean | Date | null | undefined,
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
        { id: 5, key: new Date(0) },
        { id: 6, key: null },
        { id: 7, key: undefined },
      ],
      columns: keyColumns,
      query: { filters: [], sort: [], rowGroups: [{ columnId: "key" }] },
    });
    const groups = model
      .getState()
      .snapshot.range(0, 20)
      .filter((row) => row.kind === "group");
    expect(groups).toHaveLength(6);
    expect(new Set(groups.map((row) => row.groupId)).size).toBe(6);
    expect(
      groups.find((row) => row.groupId.endsWith("key=~"))?.childCount,
    ).toBe(2);
  });

  test("bounds changed-path and indexed-read comparator work with high cardinality", () => {
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
  });
});
