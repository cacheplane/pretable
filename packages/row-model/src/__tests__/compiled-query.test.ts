import { describe, expect, test, vi } from "vitest";

import {
  compileQuery,
  createColumnHelper,
  type CompiledAggregateLeaf,
  type PretableAggregator,
  type PretableQueryFor,
} from "../index";

interface Holding {
  id: number;
  sector: string | null;
  quantity: number | null;
  label: string;
  ignored: string;
}

const totalLabel: PretableAggregator<
  Holding,
  string,
  readonly string[],
  string
> = {
  init: () => [],
  accumulate: (accumulator, value) => [...accumulator, value],
  merge: (left, right) => [...left, ...right],
  finalize: (accumulator) => accumulator.join("|"),
};

function setup() {
  const calls = {
    sector: vi.fn((row: Holding) => row.sector),
    quantity: vi.fn((row: Holding) => row.quantity),
    label: vi.fn((row: Holding) => row.label),
    ignored: vi.fn((row: Holding) => row.ignored),
  };
  const column = createColumnHelper<Holding>();
  const columns = [
    column.accessor("sector", calls.sector, { type: "text" }),
    column.accessor("quantity", calls.quantity, {
      type: "number",
      aggregate: "sum",
    }),
    column.accessor("label", calls.label, {
      type: "text",
      aggregate: totalLabel,
    }),
    column.accessor("ignored", calls.ignored, { type: "text" }),
  ] as const;
  return { calls, columns };
}

function queryFor<TColumns>(
  value: PretableQueryFor<TColumns>,
): PretableQueryFor<TColumns> {
  return value;
}

describe("compileQuery", () => {
  test("compiles only active dependencies and evaluates each active accessor once", () => {
    const { calls, columns } = setup();
    const plan = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [{ columnId: "quantity", operator: "gte", value: 10 }],
        rowGroups: [{ columnId: "sector", direction: "asc" }],
        sort: [
          { columnId: "quantity", direction: "desc" },
          { columnId: "label", direction: "asc" },
        ],
      }),
    });
    const row: Holding = {
      id: 7,
      sector: "Tech",
      quantity: 20,
      label: "item 2",
      ignored: "never",
    };

    const metadata = plan.evaluate({ rowId: 7, row, sourceOrder: 3 });

    expect(metadata).toMatchObject({
      rowId: 7,
      row,
      sourceOrder: 3,
      filterPasses: true,
      groupPath: [{ columnId: "sector", value: "Tech" }],
      sortKeys: [
        { columnId: "quantity", value: 20 },
        { columnId: "label", value: "item 2" },
      ],
    });
    expect(metadata.aggregateLeaves.map((leaf) => leaf.columnId)).toEqual([
      "quantity",
      "label",
    ]);
    expect(calls.sector).toHaveBeenCalledTimes(1);
    expect(calls.quantity).toHaveBeenCalledTimes(1);
    expect(calls.label).toHaveBeenCalledTimes(1);
    expect(calls.ignored).not.toHaveBeenCalled();
    expect(plan.activeColumnIds).toEqual(["sector", "quantity", "label"]);
  });

  test("returns stable cached metadata for an identical row evaluation", () => {
    const { calls, columns } = setup();
    const plan = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({ filters: [], rowGroups: [], sort: [] }),
    });
    const row: Holding = {
      id: 1,
      sector: "Tech",
      quantity: 2,
      label: "x",
      ignored: "z",
    };

    const first = plan.evaluate({ rowId: 1, row, sourceOrder: 0 });
    const second = plan.evaluate({ rowId: 1, row, sourceOrder: 0 });

    expect(second).toBe(first);
    expect(calls.quantity).toHaveBeenCalledTimes(1);
    expect(calls.label).toHaveBeenCalledTimes(1);
  });

  test("reuses the previous plan for semantically equivalent query values", () => {
    const { columns } = setup();
    const query = queryFor<typeof columns>({
      filters: [{ columnId: "quantity", operator: "gte", value: 10 }],
      rowGroups: [{ columnId: "sector", direction: "asc" }],
      sort: [{ columnId: "label", direction: "asc", nulls: "last" }],
    });
    const first = compileQuery({ derivations: columns, query });
    const equivalent = compileQuery({
      derivations: [...columns],
      query: {
        filters: [{ columnId: "quantity", operator: "gte", value: 10 }],
        rowGroups: [{ columnId: "sector", direction: "asc" }],
        sort: [{ columnId: "label", direction: "asc", nulls: "last" }],
      },
      previous: first,
    });

    expect(equivalent).toBe(first);
    expect(
      compileQuery({
        derivations: columns,
        query: {
          ...query,
          rowGroups: [{ columnId: "sector" }],
          sort: [{ columnId: "label", direction: "asc" }],
        },
        previous: first,
      }),
    ).toBe(first);
    const changedInactive = [
      columns[0],
      columns[1],
      columns[2],
      { ...columns[3], accessor: (row: Holding) => row.ignored.toUpperCase() },
    ] as const;
    expect(
      compileQuery({
        derivations: changedInactive,
        query,
        previous: first,
      }),
    ).toBe(first);
    const changedActive = [
      columns[0],
      columns[1],
      { ...columns[2], accessor: (row: Holding) => row.label.toUpperCase() },
      columns[3],
    ] as const;
    expect(
      compileQuery({ derivations: changedActive, query, previous: first }),
    ).not.toBe(first);
    expect(
      compileQuery({
        derivations: columns,
        query: { ...query, sort: [{ columnId: "label", direction: "desc" }] },
        previous: first,
      }),
    ).not.toBe(first);
  });

  test("orders nullish/NaN explicitly, uses numeric and collator policies, then source order", () => {
    const { columns } = setup();
    const quantityPlan = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        rowGroups: [],
        sort: [{ columnId: "quantity", direction: "asc", nulls: "last" }],
      }),
    });
    const make = (id: number, quantity: number | null, sourceOrder: number) =>
      quantityPlan.evaluate({
        rowId: id,
        sourceOrder,
        row: { id, sector: null, quantity, label: "same", ignored: "" },
      });
    const numeric = [
      make(1, Number.NaN, 0),
      make(2, 10, 1),
      make(3, 2, 2),
      make(4, null, 3),
    ];

    expect(
      numeric.sort(quantityPlan.compareRows).map((row) => row.rowId),
    ).toEqual([3, 2, 1, 4]);

    const labelPlan = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        rowGroups: [],
        sort: [{ columnId: "label", direction: "asc" }],
      }),
    });
    const labels = ["item 10", "Item 2", "item 2"].map((label, sourceOrder) =>
      labelPlan.evaluate({
        rowId: sourceOrder,
        sourceOrder,
        row: { id: sourceOrder, sector: null, quantity: 1, label, ignored: "" },
      }),
    );
    expect(
      labels.sort(labelPlan.compareRows).map((row) => row.row.label),
    ).toEqual(["Item 2", "item 2", "item 10"]);
  });

  test("keeps explicit/default null placement absolute for descending rows and groups", () => {
    const { columns } = setup();
    const defaultLast = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        rowGroups: [{ columnId: "sector", direction: "desc" }],
        sort: [{ columnId: "quantity", direction: "desc" }],
      }),
    });
    const nullFirst = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [],
        rowGroups: [{ columnId: "sector", direction: "desc", nulls: "first" }],
        sort: [{ columnId: "quantity", direction: "desc", nulls: "first" }],
      }),
    });
    const defined = defaultLast.evaluate({
      rowId: 1,
      sourceOrder: 0,
      row: { id: 1, sector: "Tech", quantity: 10, label: "", ignored: "" },
    });
    const missing = defaultLast.evaluate({
      rowId: 2,
      sourceOrder: 1,
      row: { id: 2, sector: null, quantity: null, label: "", ignored: "" },
    });
    const firstDefined = nullFirst.evaluate({
      rowId: 1,
      sourceOrder: 0,
      row: { id: 1, sector: "Tech", quantity: 10, label: "", ignored: "" },
    });
    const firstMissing = nullFirst.evaluate({
      rowId: 2,
      sourceOrder: 1,
      row: { id: 2, sector: null, quantity: null, label: "", ignored: "" },
    });

    expect(defaultLast.compareRows(defined, missing)).toBeLessThan(0);
    expect(nullFirst.compareRows(firstDefined, firstMissing)).toBeGreaterThan(
      0,
    );
    expect(
      defaultLast.compareGroupKeys(
        0,
        defined.groupPath[0],
        missing.groupPath[0],
      ),
    ).toBeLessThan(0);
    expect(
      nullFirst.compareGroupKeys(
        0,
        firstDefined.groupPath[0],
        firstMissing.groupPath[0],
      ),
    ).toBeGreaterThan(0);
  });

  test("applies typed filters and emits both all and filtered aggregate leaves", () => {
    const { columns } = setup();
    const plan = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({
        filters: [{ columnId: "quantity", operator: "gte", value: 10 }],
        rowGroups: [],
        sort: [],
      }),
    });
    const hidden = plan.evaluate({
      rowId: 1,
      sourceOrder: 0,
      row: { id: 1, sector: null, quantity: 5, label: "a", ignored: "" },
    });
    const visible = plan.evaluate({
      rowId: 2,
      sourceOrder: 1,
      row: { id: 2, sector: null, quantity: 10, label: "b", ignored: "" },
    });

    expect(hidden.filterPasses).toBe(false);
    expect(
      hidden.aggregateLeaves.every((leaf) => leaf.allLeaf !== undefined),
    ).toBe(true);
    expect(
      hidden.aggregateLeaves.every((leaf) => leaf.filteredLeaf === undefined),
    ).toBe(true);
    expect(
      visible.aggregateLeaves.every(
        (leaf) => leaf.filteredLeaf === leaf.allLeaf,
      ),
    ).toBe(true);
  });

  test("retains exact built-in and custom aggregate leaf inference", () => {
    const { columns } = setup();
    const metadata = compileQuery({
      derivations: columns,
      query: queryFor<typeof columns>({ filters: [], rowGroups: [], sort: [] }),
    }).evaluate({
      rowId: 1,
      sourceOrder: 0,
      row: { id: 1, sector: "Tech", quantity: 2, label: "x", ignored: "" },
    });

    const quantity = metadata.aggregateLeaves.find(
      (leaf) => leaf.columnId === "quantity",
    );
    if (quantity?.columnId === "quantity") {
      const value: number | null = quantity.allLeaf.value;
      const aggregate: "sum" = quantity.aggregate;
      void value;
      void aggregate;
    }
    const label = metadata.aggregateLeaves.find(
      (leaf) => leaf.columnId === "label",
    );
    if (label?.columnId === "label") {
      const value: string = label.allLeaf.value;
      const aggregate: typeof totalLabel = label.aggregate;
      void value;
      void aggregate;
    }
    const typed: readonly CompiledAggregateLeaf<typeof columns, number>[] =
      metadata.aggregateLeaves;
    expect(typed).toHaveLength(2);
  });

  test.each([
    [
      "unknown query column",
      (columns: ReturnType<typeof setup>["columns"]) => ({
        derivations: columns,
        query: {
          filters: [],
          rowGroups: [],
          sort: [{ columnId: "missing", direction: "asc" }],
        },
      }),
    ],
    [
      "invalid direction",
      (columns: ReturnType<typeof setup>["columns"]) => ({
        derivations: columns,
        query: {
          filters: [],
          rowGroups: [],
          sort: [{ columnId: "label", direction: "sideways" }],
        },
      }),
    ],
    [
      "wrong operator for column",
      (columns: ReturnType<typeof setup>["columns"]) => ({
        derivations: columns,
        query: {
          filters: [{ columnId: "quantity", operator: "contains", value: 2 }],
          rowGroups: [],
          sort: [],
        },
      }),
    ],
    [
      "missing filter operand",
      (columns: ReturnType<typeof setup>["columns"]) => ({
        derivations: columns,
        query: {
          filters: [{ columnId: "quantity", operator: "gte" }],
          rowGroups: [],
          sort: [],
        },
      }),
    ],
  ])(
    "rejects invalid runtime descriptors when types are bypassed: %s",
    (_label, makeInput) => {
      const { columns } = setup();
      expect(() => compileQuery(makeInput(columns) as never)).toThrow(
        TypeError,
      );
    },
  );

  test("negative control accepts valid runtime descriptors through the same bypass", () => {
    const { columns } = setup();
    expect(() =>
      compileQuery({
        derivations: columns,
        query: {
          filters: [{ columnId: "quantity", operator: "gte", value: 2 }],
          rowGroups: [{ columnId: "sector", direction: "asc" }],
          sort: [{ columnId: "label", direction: "desc", nulls: "first" }],
        },
      } as never),
    ).not.toThrow();
  });
});
