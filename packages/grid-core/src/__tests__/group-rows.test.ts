import { describe, expect, test } from "vitest";

import { deriveVisibleRows, type SourceRow } from "../derived-rows";
import { buildGroupedRows } from "../group-rows";
import { makeGroupId } from "../group-id";
import type {
  PretableColumn,
  PretableDataRow,
  PretableGroupRow,
  PretableRow,
  PretableSortEntry,
  PretableVisibleRow,
} from "../types";

interface Holding extends PretableRow {
  id: string;
  sector: string | null;
  analyst: string;
  qty: number;
}

/**
 * Deliberately UNEVEN groups. Tech splits 3 + 1, so the average of all four
 * Tech leaves (40) differs from the average of its two child-group averages
 * (60) — the number a naive rollup would produce. Energy splits 2 + 2 as a
 * control where the two agree.
 */
const HOLDINGS: Holding[] = [
  { id: "h1", sector: "Tech", analyst: "Ada", qty: 10 },
  { id: "h2", sector: "Tech", analyst: "Ada", qty: 20 },
  { id: "h3", sector: "Tech", analyst: "Ada", qty: 30 },
  { id: "h4", sector: "Tech", analyst: "Bob", qty: 100 },
  { id: "h5", sector: "Energy", analyst: "Ada", qty: 1 },
  { id: "h6", sector: "Energy", analyst: "Ada", qty: 2 },
  { id: "h7", sector: "Energy", analyst: "Bob", qty: 7 },
  { id: "h8", sector: "Energy", analyst: "Bob", qty: 8 },
];

const columns: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector" },
  { id: "analyst", header: "Analyst" },
  { id: "qty", header: "Qty", type: "number", aggregate: "sum" },
];

function withQtyAggregate(
  aggregate: PretableColumn<Holding>["aggregate"],
): PretableColumn<Holding>[] {
  return columns.map((column) =>
    column.id === "qty" ? { ...column, aggregate } : column,
  );
}

function toSourceRows(rows: Holding[]): SourceRow<Holding>[] {
  return rows.map((row, index) => ({ id: row.id, row, sourceIndex: index }));
}

const SOURCE = toSourceRows(HOLDINGS);

function build(
  overrides: Partial<Parameters<typeof buildGroupedRows<Holding>>[0]> = {},
): PretableVisibleRow<Holding>[] {
  return buildGroupedRows<Holding>({
    rows: SOURCE,
    columns,
    rowGroups: [],
    sort: [],
    groupExpansionOverrides: new Set<string>(),
    defaultExpanded: true,
    ...overrides,
  });
}

function shape(entries: PretableVisibleRow<Holding>[]): string[] {
  return entries.map((entry) =>
    entry.kind === "group"
      ? `${"  ".repeat(entry.depth)}[${entry.columnId}=${String(entry.value)}] x${entry.childCount}`
      : `${"  ".repeat(entry.depth)}${entry.id}`,
  );
}

function groupById(
  entries: PretableVisibleRow<Holding>[],
  id: string,
): PretableGroupRow {
  const found = entries.find(
    (entry): entry is PretableGroupRow =>
      entry.kind === "group" && entry.id === id,
  );
  if (!found) throw new Error(`no group row with id ${id}`);
  return found;
}

const SECTOR_TECH = makeGroupId([{ columnId: "sector", value: "Tech" }]);
const SECTOR_ENERGY = makeGroupId([{ columnId: "sector", value: "Energy" }]);
const TECH_ADA = makeGroupId([
  { columnId: "sector", value: "Tech" },
  { columnId: "analyst", value: "Ada" },
]);
const TECH_BOB = makeGroupId([
  { columnId: "sector", value: "Tech" },
  { columnId: "analyst", value: "Bob" },
]);

describe("ungrouped short-circuit", () => {
  test("rowGroups: [] reproduces the flat derived-rows output exactly", () => {
    const sort: PretableSortEntry[] = [{ columnId: "qty", direction: "desc" }];
    const expected = deriveVisibleRows<Holding>({
      columns,
      filters: {},
      rows: SOURCE,
      sort,
    }).rows;

    expect(build({ sort })).toEqual(expected);
  });

  test("every entry is a data row at depth 0", () => {
    const entries = build();

    expect(entries).toHaveLength(HOLDINGS.length);
    expect(entries.every((entry) => entry.kind === "data")).toBe(true);
    expect(entries.every((entry) => entry.depth === 0)).toBe(true);
    expect(entries.map((entry) => entry.id)).toEqual(
      HOLDINGS.map((row) => row.id),
    );
  });

  test("unknown group column ids are dropped, and an all-unknown list is ungrouped", () => {
    expect(build({ rowGroups: ["nope"] })).toEqual(build({ rowGroups: [] }));
    expect(shape(build({ rowGroups: ["nope", "sector"] }))).toEqual(
      shape(build({ rowGroups: ["sector"] })),
    );
  });
});

describe("single-level grouping", () => {
  test("interleaves group rows with their children in key order", () => {
    expect(shape(build({ rowGroups: ["sector"] }))).toEqual([
      "[sector=Energy] x4",
      "  h5",
      "  h6",
      "  h7",
      "  h8",
      "[sector=Tech] x4",
      "  h1",
      "  h2",
      "  h3",
      "  h4",
    ]);
  });

  test("group rows carry a stable path-derived id, columnId, value and depth", () => {
    const entries = build({ rowGroups: ["sector"] });
    const tech = groupById(entries, SECTOR_TECH);

    expect(tech).toMatchObject({
      kind: "group",
      id: SECTOR_TECH,
      depth: 0,
      columnId: "sector",
      value: "Tech",
      childCount: 4,
    });
  });

  test("data rows keep their id, row reference and sourceIndex", () => {
    const entries = build({ rowGroups: ["sector"] });
    const first = entries[1] as PretableDataRow<Holding>;

    expect(first.kind).toBe("data");
    expect(first.id).toBe("h5");
    expect(first.row).toBe(HOLDINGS[4]);
    expect(first.sourceIndex).toBe(4);
    expect(first.depth).toBe(1);
  });
});

describe("multi-level grouping", () => {
  test("nests levels in order with data rows at the deepest depth", () => {
    expect(shape(build({ rowGroups: ["sector", "analyst"] }))).toEqual([
      "[sector=Energy] x4",
      "  [analyst=Ada] x2",
      "    h5",
      "    h6",
      "  [analyst=Bob] x2",
      "    h7",
      "    h8",
      "[sector=Tech] x4",
      "  [analyst=Ada] x3",
      "    h1",
      "    h2",
      "    h3",
      "  [analyst=Bob] x1",
      "    h4",
    ]);
  });

  test("childCount on a parent counts all descendant leaves", () => {
    const entries = build({ rowGroups: ["sector", "analyst"] });

    expect(groupById(entries, SECTOR_TECH).childCount).toBe(4);
    expect(groupById(entries, TECH_ADA).childCount).toBe(3);
    expect(groupById(entries, TECH_BOB).childCount).toBe(1);
  });
});

describe("aggregation", () => {
  test("sum and count over a single level", () => {
    const entries = build({
      rowGroups: ["sector"],
      columns: withQtyAggregate("sum"),
    });

    expect(groupById(entries, SECTOR_TECH).aggregates.qty).toBe(160);
    expect(groupById(entries, SECTOR_ENERGY).aggregates.qty).toBe(18);
  });

  test.each([
    ["min", 10, 1],
    ["max", 100, 8],
    ["count", 4, 4],
  ] as const)("%s", (name, tech, energy) => {
    const entries = build({
      rowGroups: ["sector"],
      columns: withQtyAggregate(name),
    });

    expect(groupById(entries, SECTOR_TECH).aggregates.qty).toBe(tech);
    expect(groupById(entries, SECTOR_ENERGY).aggregates.qty).toBe(energy);
  });

  test("a parent avg is the mean of ALL descendant leaves, not of its child groups' averages", () => {
    const entries = build({
      rowGroups: ["sector", "analyst"],
      columns: withQtyAggregate("avg"),
    });

    const techAda = groupById(entries, TECH_ADA).aggregates.qty;
    const techBob = groupById(entries, TECH_BOB).aggregates.qty;
    const tech = groupById(entries, SECTOR_TECH).aggregates.qty;

    // Child groups are deliberately different sizes: 3 rows vs 1 row.
    expect(techAda).toBe(20); // (10 + 20 + 30) / 3
    expect(techBob).toBe(100); // 100 / 1

    // Leaf-based: (10 + 20 + 30 + 100) / 4 === 40.
    expect(tech).toBe(40);
    // Naive rollup — the mean of the child means — would say 60. It must not.
    expect((Number(techAda) + Number(techBob)) / 2).toBe(60);
    expect(tech).not.toBe(60);
  });

  test("evenly split groups are the control case where both readings agree", () => {
    const entries = build({
      rowGroups: ["sector", "analyst"],
      columns: withQtyAggregate("avg"),
    });

    expect(groupById(entries, SECTOR_ENERGY).aggregates.qty).toBe(4.5);
  });

  test("a custom PretableAggregator is used verbatim and yields a scalar", () => {
    const entries = build({
      rowGroups: ["sector"],
      columns: withQtyAggregate({
        init: () => [] as number[],
        accumulate: (acc, value) => {
          if (typeof value === "number") (acc as number[]).push(value);
          return acc;
        },
        merge: (a, b) => [...(a as number[]), ...(b as number[])],
        finalize: (acc) => {
          const values = [...(acc as number[])].sort((x, y) => x - y);
          if (values.length === 0) return null;
          const mid = Math.floor(values.length / 2);
          return values.length % 2 === 1
            ? values[mid]
            : (values[mid - 1] + values[mid]) / 2;
        },
      }),
    });

    // Median of Tech (10, 20, 30, 100) is 25 — a statistic ag-grid's rollup
    // contract cannot express.
    expect(groupById(entries, SECTOR_TECH).aggregates.qty).toBe(25);
    expect(groupById(entries, SECTOR_ENERGY).aggregates.qty).toBe(4.5);
  });

  test("columns without an aggregate produce no entry", () => {
    const entries = build({ rowGroups: ["sector"] });
    const tech = groupById(entries, SECTOR_TECH);

    expect(tech.aggregates).toEqual({ qty: 160 });
    expect("analyst" in tech.aggregates).toBe(false);
  });

  test("a column value() accessor feeds the aggregate", () => {
    const entries = build({
      rowGroups: ["sector"],
      columns: [
        ...columns.slice(0, 2),
        {
          id: "doubled",
          value: (row: Holding) => row.qty * 2,
          aggregate: "sum",
        },
      ],
    });

    expect(groupById(entries, SECTOR_TECH).aggregates.doubled).toBe(320);
  });
});

describe("aggregateFilteredRows (allRows)", () => {
  // Filter to qty >= 8: Tech keeps all four rows, Energy keeps only h8.
  const filtered = toSourceRows(HOLDINGS).filter((entry) => entry.row.qty >= 8);

  test("by default aggregates only the rows you can see", () => {
    const entries = buildGroupedRows<Holding>({
      rows: filtered,
      columns,
      rowGroups: ["sector"],
      sort: [],
      groupExpansionOverrides: new Set(),
      defaultExpanded: true,
    });

    expect(groupById(entries, SECTOR_ENERGY).aggregates.qty).toBe(8);
    expect(groupById(entries, SECTOR_ENERGY).childCount).toBe(1);
  });

  test("allRows folds over the pre-filter set while childCount stays post-filter", () => {
    const entries = buildGroupedRows<Holding>({
      rows: filtered,
      allRows: SOURCE,
      columns,
      rowGroups: ["sector"],
      sort: [],
      groupExpansionOverrides: new Set(),
      defaultExpanded: true,
    });

    expect(groupById(entries, SECTOR_ENERGY).aggregates.qty).toBe(18);
    expect(groupById(entries, SECTOR_ENERGY).childCount).toBe(1);
    expect(groupById(entries, SECTOR_TECH).aggregates.qty).toBe(160);
  });

  test("groups that exist only pre-filter are not materialized", () => {
    const techOnly = toSourceRows(HOLDINGS).filter(
      (entry) => entry.row.sector === "Tech",
    );
    const entries = buildGroupedRows<Holding>({
      rows: techOnly,
      allRows: SOURCE,
      columns,
      rowGroups: ["sector", "analyst"],
      sort: [],
      groupExpansionOverrides: new Set(),
      defaultExpanded: true,
    });

    expect(entries.some((entry) => entry.id === SECTOR_ENERGY)).toBe(false);
    expect(groupById(entries, SECTOR_TECH).aggregates.qty).toBe(160);
  });

  test("folds the pre-filter set in the same order as the post-filter one", () => {
    // `PretableAggregator` advertises order-sensitivity, so the fold order has
    // to be one thing. It used to be sort order without an active filter and
    // *source* order with one, because `allRows` was handed over unsorted.
    const trace: PretableColumn<Holding>[] = columns.map((column) =>
      column.id === "qty"
        ? {
            ...column,
            aggregate: {
              init: () => [] as string[],
              accumulate: (acc: string[], _value: unknown, row: Holding) => {
                acc.push(row.id);
                return acc;
              },
              merge: (a: string[], b: string[]) => [...a, ...b],
              finalize: (acc: string[]) => acc.join(","),
            },
          }
        : column,
    );
    const sort: PretableSortEntry[] = [{ columnId: "qty", direction: "desc" }];
    const args = {
      columns: trace,
      rowGroups: ["sector"],
      sort,
      groupExpansionOverrides: new Set<string>(),
      defaultExpanded: true,
    };

    const noFilter = buildGroupedRows<Holding>({ rows: SOURCE, ...args });
    const withFilter = buildGroupedRows<Holding>({
      rows: filtered,
      allRows: SOURCE,
      ...args,
    });

    expect(groupById(noFilter, SECTOR_TECH).aggregates.qty).toBe("h4,h3,h2,h1");
    expect(groupById(withFilter, SECTOR_TECH).aggregates.qty).toBe(
      "h4,h3,h2,h1",
    );
  });
});

describe("expand and collapse", () => {
  test("a collapsed group keeps its row but drops its descendants", () => {
    const entries = build({
      rowGroups: ["sector", "analyst"],
      groupExpansionOverrides: new Set([SECTOR_TECH]),
    });

    expect(shape(entries)).toEqual([
      "[sector=Energy] x4",
      "  [analyst=Ada] x2",
      "    h5",
      "    h6",
      "  [analyst=Bob] x2",
      "    h7",
      "    h8",
      "[sector=Tech] x4",
    ]);
    expect(groupById(entries, SECTOR_TECH).aggregates.qty).toBe(160);
  });

  test("collapsing an inner level only hides that level's rows", () => {
    const entries = build({
      rowGroups: ["sector", "analyst"],
      groupExpansionOverrides: new Set([TECH_ADA]),
    });

    // The Energy branch (group + 2 subgroups + 4 rows) is untouched.
    expect(shape(entries).slice(7)).toEqual([
      "[sector=Tech] x4",
      "  [analyst=Ada] x3",
      "  [analyst=Bob] x1",
      "    h4",
    ]);
  });

  test("a collapsed id that matches no group is ignored", () => {
    const entries = build({
      rowGroups: ["sector"],
      groupExpansionOverrides: new Set([
        makeGroupId([{ columnId: "sector", value: "Ghost" }]),
      ]),
    });

    expect(shape(entries)).toEqual(shape(build({ rowGroups: ["sector"] })));
  });

  test("defaultExpanded: false collapses everything absent an explicit id", () => {
    const entries = build({
      rowGroups: ["sector", "analyst"],
      defaultExpanded: false,
    });

    expect(shape(entries)).toEqual(["[sector=Energy] x4", "[sector=Tech] x4"]);
  });

  test("the id set overrides the default in both directions", () => {
    const entries = build({
      rowGroups: ["sector", "analyst"],
      defaultExpanded: false,
      groupExpansionOverrides: new Set([SECTOR_TECH]),
    });

    expect(shape(entries)).toEqual([
      "[sector=Energy] x4",
      "[sector=Tech] x4",
      "  [analyst=Ada] x3",
      "  [analyst=Bob] x1",
    ]);
  });
});

describe("sorting", () => {
  test("data rows sort within their group by the sort cascade", () => {
    const entries = build({
      rowGroups: ["sector", "analyst"],
      sort: [{ columnId: "qty", direction: "desc" }],
    });

    expect(shape(entries)).toEqual([
      "[sector=Energy] x4",
      "  [analyst=Ada] x2",
      "    h6",
      "    h5",
      "  [analyst=Bob] x2",
      "    h8",
      "    h7",
      "[sector=Tech] x4",
      "  [analyst=Ada] x3",
      "    h3",
      "    h2",
      "    h1",
      "  [analyst=Bob] x1",
      "    h4",
    ]);
  });

  test("groups sort among their siblings by value, ascending by default", () => {
    const entries = build({ rowGroups: ["sector"] });

    expect(
      entries
        .filter((entry) => entry.kind === "group")
        .map((entry) => (entry as PretableGroupRow).value),
    ).toEqual(["Energy", "Tech"]);
  });

  test("a sort on the grouping column sets the group order direction", () => {
    const entries = build({
      rowGroups: ["sector"],
      sort: [{ columnId: "sector", direction: "desc" }],
    });

    expect(
      entries
        .filter((entry) => entry.kind === "group")
        .map((entry) => (entry as PretableGroupRow).value),
    ).toEqual(["Tech", "Energy"]);
  });

  test("numeric group values sort numerically, not lexicographically", () => {
    const rows = toSourceRows([
      { id: "a", sector: "Tech", analyst: "Ada", qty: 2 },
      { id: "b", sector: "Tech", analyst: "Ada", qty: 10 },
      { id: "c", sector: "Tech", analyst: "Ada", qty: 1 },
    ]);
    const entries = buildGroupedRows<Holding>({
      rows,
      columns,
      rowGroups: ["qty"],
      sort: [],
      groupExpansionOverrides: new Set(),
      defaultExpanded: true,
    });

    expect(
      entries
        .filter((entry) => entry.kind === "group")
        .map((entry) => (entry as PretableGroupRow).value),
    ).toEqual([1, 2, 10]);
  });
});

describe("missing grouping values", () => {
  const rows = toSourceRows([
    { id: "n1", sector: null, analyst: "Ada", qty: 5 },
    { id: "n2", sector: undefined as unknown as null, analyst: "Bob", qty: 5 },
    { id: "n3", sector: "Tech", analyst: "Ada", qty: 5 },
  ]);

  test("null and undefined form a single deterministic group", () => {
    const entries = buildGroupedRows<Holding>({
      rows,
      columns,
      rowGroups: ["sector"],
      sort: [],
      groupExpansionOverrides: new Set(),
      defaultExpanded: true,
    });

    const groups = entries.filter(
      (entry): entry is PretableGroupRow => entry.kind === "group",
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].id).toBe(
      makeGroupId([{ columnId: "sector", value: null }]),
    );
    expect(groups[0].childCount).toBe(2);
    expect(groups[0].value).toBeNull();
    expect(groups[1].value).toBe("Tech");
  });

  test("values that stringify alike but differ in type stay in separate groups", () => {
    const mixed = toSourceRows([
      { id: "m1", sector: 1 as unknown as string, analyst: "Ada", qty: 1 },
      { id: "m2", sector: "1", analyst: "Ada", qty: 1 },
    ]);
    const entries = buildGroupedRows<Holding>({
      rows: mixed,
      columns,
      rowGroups: ["sector"],
      sort: [],
      groupExpansionOverrides: new Set(),
      defaultExpanded: true,
    });

    const groups = entries.filter((entry) => entry.kind === "group");

    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((entry) => entry.id)).size).toBe(2);
  });
});
