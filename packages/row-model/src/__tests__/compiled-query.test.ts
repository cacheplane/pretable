import { describe, expect, test, vi } from "vitest";

import {
  CompiledQueryComparatorError,
  CompiledQueryValidationError,
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
    const first = compileQuery<typeof columns>({ derivations: columns, query });
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

  test.each([
    ["asc", "first", [2, 7, 1, 8, 6, 4, 5, 3]],
    ["asc", "last", [2, 7, 1, 8, 6, 4, 5, 3]],
    ["desc", "first", [7, 1, 8, 2, 6, 4, 5, 3]],
    ["desc", "last", [7, 1, 8, 2, 6, 4, 5, 3]],
  ] as const)(
    "orders valid calendar dates first for %s/nulls-%s and lets terminal values fall through",
    (direction, nulls, expected) => {
      interface DatedRow {
        id: number;
        asOf: string | null;
        tie: number;
      }
      const column = createColumnHelper<DatedRow>();
      const columns = [
        column.accessor("asOf", { type: "date" }),
        column.accessor("tie", { type: "number" }),
      ] as const;
      const plan = compileQuery<typeof columns>({
        derivations: columns,
        query: {
          filters: [],
          rowGroups: [],
          sort: [
            { columnId: "asOf", direction, nulls },
            { columnId: "tie", direction: "asc" },
          ],
        },
      });
      const rows = [
        { id: 1, asOf: "2026-08-06", tie: 0 },
        { id: 2, asOf: "2025-12-31", tie: 0 },
        { id: 3, asOf: "2026-02-30", tie: 2 },
        { id: 4, asOf: null, tie: 1 },
        { id: 5, asOf: { date: "2026-08-05" }, tie: 1 },
        { id: 6, asOf: undefined, tie: 0 },
        { id: 7, asOf: "2026-08-06", tie: -1 },
        { id: 8, asOf: "2026-08-06", tie: 0 },
      ];
      const metadata = rows.map((row, sourceOrder) =>
        plan.evaluate({
          rowId: row.id,
          sourceOrder,
          row: row as never,
        }),
      );

      expect(metadata.sort(plan.compareRows).map((row) => row.rowId)).toEqual(
        expected,
      );
    },
  );

  test.each(["asc", "desc"] as const)(
    "uses the same terminal calendar-date rank for sibling groups in %s order",
    (direction) => {
      const column = createColumnHelper<{ id: number; asOf: string | null }>();
      const columns = [column.accessor("asOf", { type: "date" })] as const;
      const plan = compileQuery<typeof columns>({
        derivations: columns,
        query: {
          filters: [],
          sort: [],
          rowGroups: [{ columnId: "asOf", direction, nulls: "first" }],
        },
      });
      const evaluate = (id: number, asOf: unknown) =>
        plan.evaluate({
          rowId: id,
          sourceOrder: id,
          row: { id, asOf } as never,
        }).groupPath[0];
      const early = evaluate(1, "2025-12-31");
      const late = evaluate(2, "2026-08-06");
      const invalid = evaluate(3, "2026-02-30");
      const missing = evaluate(4, null);

      expect(plan.compareGroupKeys(0, late, invalid)).toBeLessThan(0);
      expect(plan.compareGroupKeys(0, invalid, missing)).toBe(0);
      expect(Math.sign(plan.compareGroupKeys(0, early, late))).toBe(
        direction === "asc" ? -1 : 1,
      );
    },
  );

  test("keeps a custom date comparator authoritative over the default terminal rank", () => {
    const column = createColumnHelper<{ id: number; asOf: string }>();
    const columns = [
      column.accessor("asOf", {
        type: "date",
        compare: (left, right) =>
          left === "invalid" ? -1 : right === "invalid" ? 1 : 0,
      }),
    ] as const;
    const plan = compileQuery<typeof columns>({
      derivations: columns,
      query: {
        filters: [],
        rowGroups: [],
        sort: [{ columnId: "asOf", direction: "asc" }],
      },
    });
    const invalid = plan.evaluate({
      rowId: 1,
      sourceOrder: 0,
      row: { id: 1, asOf: "invalid" },
    });
    const valid = plan.evaluate({
      rowId: 2,
      sourceOrder: 1,
      row: { id: 2, asOf: "2026-08-06" },
    });

    expect(plan.compareRows(invalid, valid)).toBeLessThan(0);
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

  test("owns immutable query/derivation snapshots without cloning domain rows", () => {
    const { columns } = setup();
    const aggregateOption = { label: "stable" };
    const mutableAggregate = { ...totalLabel, option: aggregateOption };
    const mutableColumns = [
      columns[0],
      columns[1],
      { ...columns[2], aggregate: mutableAggregate },
      columns[3],
    ] as const;
    const operand = [1, 3];
    const inputQuery = {
      filters: [{ columnId: "quantity", operator: "between", value: operand }],
      rowGroups: [],
      sort: [],
    } as never;
    const plan = compileQuery<typeof mutableColumns>({
      derivations: mutableColumns,
      query: inputQuery,
    });
    const row: Holding = {
      id: 1,
      sector: "Tech",
      quantity: 2,
      label: "x",
      ignored: "",
    };
    const metadata = plan.evaluate({ rowId: 1, row, sourceOrder: 0 });

    operand[0] = 100;
    aggregateOption.label = "mutated";
    (
      mutableAggregate as unknown as {
        finalize: (value: readonly string[]) => string;
      }
    ).finalize = () => "mutated";

    expect(plan.query).not.toBe(inputQuery);
    expect(plan.derivations).not.toBe(mutableColumns);
    expect(Object.isFrozen(plan.query)).toBe(true);
    expect(Object.isFrozen(plan.query.filters)).toBe(true);
    expect(Object.isFrozen(plan.derivations)).toBe(true);
    expect(metadata.filterPasses).toBe(true);
    expect(metadata.row).toBe(row);
    expect(metadata.aggregateLeaves[0].allLeaf.row).toBe(row);
    const label = metadata.aggregateLeaves.find(
      (leaf) => leaf.columnId === "label",
    );
    if (label?.columnId !== "label") throw new Error("missing label leaf");
    expect(label.aggregate.finalize(["a", "b"])).toBe("a|b");
    const capturedAggregate = label.aggregate as typeof mutableAggregate;
    expect(capturedAggregate.option).toEqual({ label: "stable" });
    expect(Object.isFrozen(capturedAggregate.option)).toBe(true);
    expect(label.aggregate).not.toBe(mutableAggregate);
    expect(Object.isFrozen(label.aggregate)).toBe(true);
  });

  test.each([
    ["on", "2026-08-06", "2026-08-06", true],
    ["on", "2026-08-06", "2026-08-07", false],
    ["before", "2026-08-06", "2026-08-05", true],
    ["after", "2026-08-06", "2026-08-07", true],
    ["dateBetween", ["2026-08-01", "2026-08-31"], "2026-08-06", true],
    ["dateBetween", ["2026-08-31", "2026-08-01"], "2026-08-06", true],
  ] as const)(
    "evaluates canonical calendar-date operator %s without coercion",
    (operator, value, asOf, expected) => {
      interface DatedRow {
        id: number;
        asOf: string | null;
      }
      const column = createColumnHelper<DatedRow>();
      const columns = [column.accessor("asOf", { type: "date" })] as const;
      const plan = compileQuery<typeof columns>({
        derivations: columns,
        query: {
          filters: [{ columnId: "asOf", operator, value }],
          rowGroups: [],
          sort: [],
        } as never,
      });

      expect(
        plan.evaluate({ rowId: 1, sourceOrder: 0, row: { id: 1, asOf } })
          .filterPasses,
      ).toBe(expected);
    },
  );

  test.each([
    ["isEmpty", null, true],
    ["isEmpty", "2026-08-06", false],
    ["isNotEmpty", null, false],
    ["isNotEmpty", "2026-08-06", true],
  ] as const)(
    "evaluates calendar-date operator %s",
    (operator, asOf, expected) => {
      const column = createColumnHelper<{ id: number; asOf: string | null }>();
      const columns = [column.accessor("asOf", { type: "date" })] as const;
      const plan = compileQuery<typeof columns>({
        derivations: columns,
        query: {
          filters: [{ columnId: "asOf", operator }],
          rowGroups: [],
          sort: [],
        },
      });

      expect(
        plan.evaluate({ rowId: 1, sourceOrder: 0, row: { id: 1, asOf } })
          .filterPasses,
      ).toBe(expected);
    },
  );

  test.each([
    ["Date", "on", new Date("2026-08-06T00:00:00Z")],
    ["number", "on", 0],
    ["array", "on", ["2026-08-06"]],
    ["object", "on", { date: "2026-08-06" }],
    ["short range", "dateBetween", ["2026-08-06"]],
    ["long range", "dateBetween", ["2026-08-01", "2026-08-06", "2026-08-31"]],
    ["non-array range", "dateBetween", "2026-08-06"],
    ["non-string range member", "dateBetween", ["2026-08-01", 0]],
  ])(
    "rejects a shape-invalid calendar-date operand with structured context: %s",
    (_label, operator, value) => {
      interface DatedRow {
        id: number;
        asOf: string | null;
      }
      const column = createColumnHelper<DatedRow>();
      const columns = [column.accessor("asOf", { type: "date" })] as const;
      let caught: unknown;
      try {
        compileQuery({
          derivations: columns,
          query: {
            filters: [{ columnId: "asOf", operator, value }],
            rowGroups: [],
            sort: [],
          },
        } as never);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CompiledQueryValidationError);
      expect(caught).toMatchObject({
        code: "invalid-query",
        path: "query.filters[0].value",
        columnId: "asOf",
      });
    },
  );

  test("retains semantic-invalid date strings as controlled state but zero-matches", () => {
    interface DatedRow {
      id: number;
      asOf: string | null;
    }
    const column = createColumnHelper<DatedRow>();
    const columns = [column.accessor("asOf", { type: "date" })] as const;
    const query = {
      filters: [{ columnId: "asOf", operator: "on", value: "2026-02-30" }],
      rowGroups: [],
      sort: [],
    } as const satisfies PretableQueryFor<typeof columns>;
    const plan = compileQuery<typeof columns>({ derivations: columns, query });

    expect(
      plan.evaluate({
        rowId: 1,
        sourceOrder: 0,
        row: { id: 1, asOf: "2026-02-28" },
      }).filterPasses,
    ).toBe(false);
    expect(plan.query.filters).toEqual(query.filters);
  });

  test.each([
    [["2026-02-30", "2026-08-31"]],
    [["2026-08-01", "2026-13-01"]],
  ] as const)(
    "zero-matches when either dateBetween bound is invalid",
    (value) => {
      const column = createColumnHelper<{ id: number; asOf: string }>();
      const columns = [column.accessor("asOf", { type: "date" })] as const;
      const plan = compileQuery<typeof columns>({
        derivations: columns,
        query: {
          filters: [{ columnId: "asOf", operator: "dateBetween", value }],
          rowGroups: [],
          sort: [],
        },
      });

      expect(
        plan.evaluate({
          rowId: 1,
          sourceOrder: 0,
          row: { id: 1, asOf: "2026-08-06" },
        }).filterPasses,
      ).toBe(false);
    },
  );

  test.each([
    null,
    undefined,
    "",
    "   ",
    "2026-02-30",
    "2026-08-06T00:00:00Z",
    0,
    new Date("2026-08-06T00:00:00Z"),
    [],
    {},
  ])("date comparisons reject a non-date cell value %#", (asOf) => {
    const column = createColumnHelper<{ id: number; asOf: string | null }>();
    const columns = [column.accessor("asOf", { type: "date" })] as const;
    const plan = compileQuery<typeof columns>({
      derivations: columns,
      query: {
        filters: [{ columnId: "asOf", operator: "on", value: "2026-08-06" }],
        rowGroups: [],
        sort: [],
      },
    });

    expect(
      plan.evaluate({
        rowId: 1,
        sourceOrder: 0,
        row: { id: 1, asOf } as never,
      }).filterPasses,
    ).toBe(false);
  });

  test("treats conjunctive filter order and equivalent aggregator wrappers semantically", () => {
    const { columns } = setup();
    const query = queryFor<typeof columns>({
      filters: [
        { columnId: "quantity", operator: "gte", value: 10 },
        { columnId: "sector", operator: "contains", value: "tech" },
      ],
      rowGroups: [],
      sort: [],
    });
    const first = compileQuery<typeof columns>({ derivations: columns, query });
    const equivalentColumns = [
      columns[0],
      columns[1],
      { ...columns[2], aggregate: { ...totalLabel } },
      columns[3],
    ] as const;

    const equivalent = compileQuery({
      derivations: equivalentColumns,
      query: {
        ...query,
        filters: [query.filters[1], query.filters[0]],
      },
      previous: first,
    });

    expect(equivalent).toBe(first);
  });

  test.each([
    ["number string", "number", "gte", "2"],
    ["number NaN", "number", "gte", Number.NaN],
    ["number range member", "number", "between", [1, "2"]],
    ["text number", "text", "contains", 2],
    ["enum non-string member", "enum", "isAnyOf", [1]],
    ["boolean number member", "boolean", "isAnyOf", [1]],
  ])(
    "rejects runtime operand/type mismatches with structured context: %s",
    (_label, type, operator, value) => {
      const column = createColumnHelper<{ id: number; value: string }>();
      const columns = [
        column.accessor("value", { type: type as never }),
      ] as const;
      let caught: unknown;
      try {
        compileQuery({
          derivations: columns,
          query: {
            filters: [{ columnId: "value", operator, value }],
            rowGroups: [],
            sort: [],
          },
        } as never);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CompiledQueryValidationError);
      expect(caught).toMatchObject({
        code: "invalid-query",
        columnId: "value",
        path: "query.filters[0].value",
      });
    },
  );

  test.each([
    ["a real boolean", [true]],
    ["the documented string literal", ["true"]],
  ])(
    "accepts a boolean isAnyOf/isNoneOf operand of %s and evaluates it correctly",
    (_label, operand) => {
      interface Flagged {
        id: number;
        active: boolean;
      }
      const column = createColumnHelper<Flagged>();
      const columns = [column.accessor("active", { type: "boolean" })] as const;

      // Should not throw: this is the compiled-query half of the boundary
      // the funnel's toColumnFilter() output must clear.
      const isAnyOf = compileQuery<typeof columns>({
        derivations: columns,
        query: {
          filters: [
            { columnId: "active", operator: "isAnyOf", value: operand },
          ],
          rowGroups: [],
          sort: [],
        } as never,
      });
      const isNoneOf = compileQuery<typeof columns>({
        derivations: columns,
        query: {
          filters: [
            { columnId: "active", operator: "isNoneOf", value: operand },
          ],
          rowGroups: [],
          sort: [],
        } as never,
      });

      const trueRow: Flagged = { id: 1, active: true };
      const falseRow: Flagged = { id: 2, active: false };

      // The operand always coerces to `true`, so isAnyOf must match the true
      // row and exclude the false row, and isNoneOf must do the reverse.
      expect(
        isAnyOf.evaluate({ rowId: 1, row: trueRow, sourceOrder: 0 })
          .filterPasses,
      ).toBe(true);
      expect(
        isAnyOf.evaluate({ rowId: 2, row: falseRow, sourceOrder: 0 })
          .filterPasses,
      ).toBe(false);
      expect(
        isNoneOf.evaluate({ rowId: 1, row: trueRow, sourceOrder: 0 })
          .filterPasses,
      ).toBe(false);
      expect(
        isNoneOf.evaluate({ rowId: 2, row: falseRow, sourceOrder: 0 })
          .filterPasses,
      ).toBe(true);
    },
  );

  test("boolean isAnyOf accepts a mix of real booleans and the documented string literals", () => {
    interface Flagged {
      id: number;
      active: boolean;
    }
    const column = createColumnHelper<Flagged>();
    const columns = [column.accessor("active", { type: "boolean" })] as const;
    const plan = compileQuery<typeof columns>({
      derivations: columns,
      query: {
        filters: [
          { columnId: "active", operator: "isAnyOf", value: [true, "false"] },
        ],
        rowGroups: [],
        sort: [],
      } as never,
    });

    // Both states are in the operand set, so every row matches.
    expect(
      plan.evaluate({ rowId: 1, row: { id: 1, active: true }, sourceOrder: 0 })
        .filterPasses,
    ).toBe(true);
    expect(
      plan.evaluate({ rowId: 2, row: { id: 2, active: false }, sourceOrder: 0 })
        .filterPasses,
    ).toBe(true);
  });

  test("boolean isAnyOf with only the false operand matches the false row, not the true row", () => {
    interface Flagged {
      id: number;
      active: boolean;
    }
    const column = createColumnHelper<Flagged>();
    const columns = [column.accessor("active", { type: "boolean" })] as const;
    const plan = compileQuery<typeof columns>({
      derivations: columns,
      query: {
        filters: [
          { columnId: "active", operator: "isAnyOf", value: ["false"] },
        ],
        rowGroups: [],
        sort: [],
      } as never,
    });

    expect(
      plan.evaluate({
        rowId: 1,
        row: { id: 1, active: false },
        sourceOrder: 0,
      }).filterPasses,
    ).toBe(true);
    expect(
      plan.evaluate({
        rowId: 2,
        row: { id: 2, active: true },
        sourceOrder: 0,
      }).filterPasses,
    ).toBe(false);
  });

  test("rejects cyclic and unsupported operands explicitly", () => {
    const { columns } = setup();
    const cycle: unknown[] = [];
    cycle.push(cycle);

    expect(() =>
      compileQuery({
        derivations: columns,
        query: {
          filters: [{ columnId: "sector", operator: "contains", value: cycle }],
          rowGroups: [],
          sort: [],
        },
      } as never),
    ).toThrow(CompiledQueryValidationError);
  });

  test("reports comparator column and both row IDs without reevaluating accessors", () => {
    const calls = vi.fn((row: { id: number; value: number }) => row.value);
    const column = createColumnHelper<{ id: number; value: number }>();
    const columns = [
      column.accessor("value", calls, {
        type: "number",
        compare: () => {
          throw new Error("broken compare");
        },
      }),
    ] as const;
    const plan = compileQuery<typeof columns>({
      derivations: columns,
      query: {
        filters: [],
        rowGroups: [],
        sort: [{ columnId: "value", direction: "asc" }],
      },
    });
    const left = plan.evaluate({
      rowId: 11,
      sourceOrder: 0,
      row: { id: 11, value: 1 },
    });
    const right = plan.evaluate({
      rowId: 22,
      sourceOrder: 1,
      row: { id: 22, value: 2 },
    });
    let caught: unknown;
    try {
      plan.compareRows(left, right);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CompiledQueryComparatorError);
    expect(caught).toMatchObject({
      code: "comparator-failed",
      columnId: "value",
      rowId: 11,
      rowIds: [11, 22],
    });
    expect(calls).toHaveBeenCalledTimes(2);
  });

  test("captures every caller-owned query, derivation, and aggregator property once", () => {
    const reads = new Map<string, number>();
    const record = (name: string) =>
      reads.set(name, (reads.get(name) ?? 0) + 1);
    const counted = (name: string, value: unknown) => ({
      enumerable: true,
      get() {
        record(name);
        return value;
      },
    });
    const countedArray = (name: string, entries: unknown[]) =>
      new Proxy(entries, {
        get(target, property, receiver) {
          if (property === "length" || /^\d+$/.test(String(property))) {
            record(`${name}.${String(property)}`);
          }
          return Reflect.get(target, property, receiver);
        },
      });
    const init = () => ({ total: 0 });
    const accumulate = (accumulator: { total: number }, value: number) => ({
      total: accumulator.total + value,
    });
    const merge = (left: { total: number }, right: { total: number }) => ({
      total: left.total + right.total,
    });
    const finalize = (accumulator: { total: number }) => accumulator.total;
    const snapshotAccumulator = (accumulator: { total: number }) => ({
      total: accumulator.total,
    });
    const aggregator = Object.defineProperties(
      {},
      {
        init: counted("aggregate.init", init),
        accumulate: counted("aggregate.accumulate", accumulate),
        merge: counted("aggregate.merge", merge),
        finalize: counted("aggregate.finalize", finalize),
        snapshotAccumulator: counted(
          "aggregate.snapshotAccumulator",
          snapshotAccumulator,
        ),
        option: counted("aggregate.option", { precision: 2 }),
      },
    );
    const accessor = (row: { id: number; value: number }) => row.value;
    const derivation = Object.defineProperties(
      {},
      {
        id: counted("derivation.id", "value"),
        type: counted("derivation.type", "number"),
        accessor: counted("derivation.accessor", accessor),
        value: counted("derivation.value", accessor),
        compare: counted("derivation.compare", undefined),
        aggregate: counted("derivation.aggregate", aggregator),
      },
    );
    const filter = Object.defineProperties(
      {},
      {
        columnId: counted("filter.columnId", "value"),
        operator: counted("filter.operator", "gte"),
        value: counted("filter.value", 2),
      },
    );
    const query = Object.defineProperties(
      {},
      {
        filters: counted("query.filters", countedArray("filters", [filter])),
        sort: counted("query.sort", countedArray("sort", [])),
        rowGroups: counted("query.rowGroups", countedArray("rowGroups", [])),
      },
    );
    const input = Object.defineProperties(
      {},
      {
        derivations: counted(
          "input.derivations",
          countedArray("derivations", [derivation]),
        ),
        query: counted("input.query", query),
        previous: counted("input.previous", undefined),
      },
    );

    const plan = compileQuery(input as never);
    plan.evaluate({ rowId: 1, sourceOrder: 0, row: { id: 1, value: 3 } });

    expect(Object.fromEntries(reads)).toEqual({
      "input.derivations": 1,
      "input.query": 1,
      "input.previous": 1,
      "derivations.length": 1,
      "derivations.0": 1,
      "derivation.id": 1,
      "derivation.type": 1,
      "derivation.accessor": 1,
      "derivation.value": 1,
      "derivation.compare": 1,
      "derivation.aggregate": 1,
      "aggregate.init": 1,
      "aggregate.accumulate": 1,
      "aggregate.merge": 1,
      "aggregate.finalize": 1,
      "aggregate.snapshotAccumulator": 1,
      "aggregate.option": 1,
      "query.filters": 1,
      "query.sort": 1,
      "query.rowGroups": 1,
      "filters.length": 1,
      "filters.0": 1,
      "sort.length": 1,
      "rowGroups.length": 1,
      "filter.columnId": 1,
      "filter.operator": 1,
      "filter.value": 1,
    });
  });

  test.each(["derivations", "filters", "sort", "rowGroups"] as const)(
    "wraps a throwing %s array index with its exact capture path",
    (area) => {
      const { input, path } = arrayCaptureInput(area, "throwing-index");
      let caught: unknown;
      try {
        compileQuery(input as never);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CompiledQueryValidationError);
      expect(caught).toMatchObject({ path });
      expect((caught as Error).cause).toBeInstanceOf(Error);
    },
  );

  test.each(["derivations", "filters", "sort", "rowGroups"] as const)(
    "rejects a sparse %s array at its missing index",
    (area) => {
      const { input, path } = arrayCaptureInput(area, "sparse");

      expect(() => compileQuery(input as never)).toThrowError(
        expect.objectContaining({
          name: "CompiledQueryValidationError",
          detail: "array index is missing",
          path,
        }),
      );
    },
  );

  test.each(["derivations", "filters", "sort", "rowGroups"] as const)(
    "wraps a throwing %s proxy length read with its exact capture path",
    (area) => {
      const { input, path } = arrayCaptureInput(area, "throwing-length");
      let caught: unknown;
      try {
        compileQuery(input as never);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CompiledQueryValidationError);
      expect(caught).toMatchObject({ path });
      expect((caught as Error).cause).toBeInstanceOf(Error);
    },
  );

  test.each(["derivations", "filters", "sort", "rowGroups"] as const)(
    "wraps a throwing %s proxy index-presence trap with its exact capture path",
    (area) => {
      const { input, path } = arrayCaptureInput(area, "throwing-presence");
      let caught: unknown;
      try {
        compileQuery(input as never);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(CompiledQueryValidationError);
      expect(caught).toMatchObject({ path });
      expect((caught as Error).cause).toBeInstanceOf(Error);
    },
  );

  test.each([
    [
      "query value",
      () => {
        const { columns } = setup();
        const filter = Object.defineProperties(
          {},
          {
            columnId: { enumerable: true, value: "quantity" },
            operator: { enumerable: true, value: "gte" },
            value: {
              enumerable: true,
              get() {
                throw new Error("value getter");
              },
            },
          },
        );
        return {
          input: {
            derivations: columns,
            query: { filters: [filter], sort: [], rowGroups: [] },
          },
          path: "query.filters[0].value",
          columnId: "quantity",
        };
      },
    ],
    [
      "derivation accessor",
      () => {
        const derivation = Object.defineProperties(
          {},
          {
            id: { enumerable: true, value: "value" },
            type: { enumerable: true, value: "number" },
            accessor: {
              enumerable: true,
              get() {
                throw new Error("accessor getter");
              },
            },
            value: { enumerable: true, value: () => 1 },
            compare: { enumerable: true, value: undefined },
            aggregate: { enumerable: true, value: undefined },
          },
        );
        return {
          input: {
            derivations: [derivation],
            query: { filters: [], sort: [], rowGroups: [] },
          },
          path: "derivations[0].accessor",
          columnId: "value",
        };
      },
    ],
    [
      "aggregator callback",
      () => {
        const aggregator = Object.defineProperties(
          {},
          {
            init: {
              enumerable: true,
              get() {
                throw new Error("init getter");
              },
            },
            accumulate: { enumerable: true, value: () => 0 },
            merge: { enumerable: true, value: () => 0 },
            finalize: { enumerable: true, value: () => 0 },
          },
        );
        return throwingAggregateInput(aggregator, "aggregate.init");
      },
    ],
    [
      "aggregator option",
      () => {
        const aggregator = Object.defineProperties(
          {
            init: () => 0,
            accumulate: () => 0,
            merge: () => 0,
            finalize: () => 0,
          },
          {
            option: {
              enumerable: true,
              get() {
                throw new Error("option getter");
              },
            },
          },
        );
        return throwingAggregateInput(aggregator, "aggregate.option");
      },
    ],
  ])(
    "wraps throwing capture getters with structured context: %s",
    (_label, make) => {
      const { input, path, columnId } = make();
      let caught: unknown;
      try {
        compileQuery(input as never);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CompiledQueryValidationError);
      expect(caught).toMatchObject({ path, columnId });
    },
  );

  test(
    "captures one aggregator object per plan across 100,000 row evaluations",
    { timeout: 30_000 },
    () => {
      let optionReads = 0;
      const aggregate = Object.defineProperties(
        {
          init: () => 0,
          accumulate: (accumulator: number, value: number) =>
            accumulator + value,
          merge: (left: number, right: number) => left + right,
          finalize: (accumulator: number) => accumulator,
        },
        {
          option: {
            enumerable: true,
            get() {
              optionReads += 1;
              return { precision: 2 };
            },
          },
        },
      );
      const column = createColumnHelper<{ id: number; value: number }>();
      const columns = [
        column.accessor("value", {
          type: "number",
          aggregate,
        }),
      ] as const;
      const plan = compileQuery<typeof columns>({
        derivations: columns,
        query: { filters: [], sort: [], rowGroups: [] },
      });
      let captured: object | undefined;

      for (let index = 0; index < 100_000; index += 1) {
        const metadata = plan.evaluate({
          rowId: index,
          sourceOrder: index,
          row: { id: index, value: index },
        });
        const current = metadata.aggregateLeaves[0].aggregate;
        captured ??= current;
        expect(current).toBe(captured);
      }

      expect(optionReads).toBe(1);
    },
  );

  test("rejects non-number and NaN row comparator results but accepts Infinity", () => {
    let result: unknown = "invalid";
    const column = createColumnHelper<{ id: number; value: number }>();
    const columns = [
      column.accessor("value", {
        type: "number",
        compare: () => result as number,
      }),
    ] as const;
    const plan = compileQuery<typeof columns>({
      derivations: columns,
      query: {
        filters: [],
        rowGroups: [],
        sort: [{ columnId: "value", direction: "asc" }],
      },
    });
    const left = plan.evaluate({
      rowId: 1,
      sourceOrder: 0,
      row: { id: 1, value: 1 },
    });
    const right = plan.evaluate({
      rowId: 2,
      sourceOrder: 1,
      row: { id: 2, value: 2 },
    });

    for (const invalid of ["invalid", Number.NaN]) {
      result = invalid;
      expect(() => plan.compareRows(left, right)).toThrowError(
        expect.objectContaining({
          name: "CompiledQueryComparatorError",
          columnId: "value",
          rowIds: [1, 2],
        }),
      );
    }
    result = Number.POSITIVE_INFINITY;
    expect(plan.compareRows(left, right)).toBe(Number.POSITIVE_INFINITY);
  });

  test("includes group values when a custom group comparator returns NaN", () => {
    const column = createColumnHelper<{ id: number; group: string }>();
    const columns = [
      column.accessor("group", {
        type: "text",
        compare: () => Number.NaN,
      }),
    ] as const;
    const plan = compileQuery<typeof columns>({
      derivations: columns,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "group" }],
      },
    });
    const left = plan.evaluate({
      rowId: 1,
      sourceOrder: 0,
      row: { id: 1, group: "a" },
    });
    const right = plan.evaluate({
      rowId: 2,
      sourceOrder: 1,
      row: { id: 2, group: "b" },
    });
    let caught: unknown;
    try {
      plan.compareGroupKeys(0, left.groupPath[0], right.groupPath[0]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(CompiledQueryComparatorError);
    expect(caught).toMatchObject({
      columnId: "group",
      rowIds: undefined,
      groupValues: ["a", "b"],
    });
  });
});

function throwingAggregateInput(aggregator: object, suffix: string) {
  const derivation = {
    id: "value",
    type: "number",
    accessor: () => 1,
    value: () => 1,
    compare: undefined,
    aggregate: aggregator,
  };
  return {
    input: {
      derivations: [derivation],
      query: { filters: [], sort: [], rowGroups: [] },
    },
    path: `derivations[0].${suffix}`,
    columnId: "value",
  };
}

type ArrayCaptureArea = "derivations" | "filters" | "sort" | "rowGroups";
type ArrayCaptureFailure =
  "throwing-index" | "sparse" | "throwing-length" | "throwing-presence";

function arrayCaptureInput(
  area: ArrayCaptureArea,
  failure: ArrayCaptureFailure,
): { input: object; path: string } {
  const column = createColumnHelper<{ id: number; value: number }>();
  const derivation = column.accessor("value", { type: "number" });
  const entries = {
    derivations: derivation,
    filters: { columnId: "value", operator: "gte", value: 1 },
    sort: { columnId: "value", direction: "asc" },
    rowGroups: { columnId: "value" },
  } as const;
  const array = arrayWithCaptureFailure(entries[area], failure);
  const query = {
    filters: area === "filters" ? array : [],
    sort: area === "sort" ? array : [],
    rowGroups: area === "rowGroups" ? array : [],
  };
  const input = {
    derivations: area === "derivations" ? array : [derivation],
    query,
  };
  const prefix = area === "derivations" ? "derivations" : `query.${area}`;
  return {
    input,
    path: failure === "throwing-length" ? `${prefix}.length` : `${prefix}[0]`,
  };
}

function arrayWithCaptureFailure(
  entry: unknown,
  failure: ArrayCaptureFailure,
): unknown[] {
  if (failure === "sparse") return new Array(1) as unknown[];
  const array = [entry];
  if (failure === "throwing-index") {
    Object.defineProperty(array, 0, {
      configurable: true,
      get() {
        throw new Error("index getter");
      },
    });
    return array;
  }
  return new Proxy(array, {
    get(target, property, receiver) {
      if (failure === "throwing-length" && property === "length") {
        throw new Error("length trap");
      }
      return Reflect.get(target, property, receiver);
    },
    getOwnPropertyDescriptor(target, property) {
      if (failure === "throwing-presence" && property === "0") {
        throw new Error("presence trap");
      }
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
}
