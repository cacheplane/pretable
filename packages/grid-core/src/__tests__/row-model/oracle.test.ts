import { describe, expect, test } from "vitest";

import { makeGroupId } from "../../group-id";
import type { SourceRow } from "../../row-utils";
import type { ColumnFilter, PretableSortEntry } from "../../types";
import {
  ORACLE_COLUMNS,
  ORACLE_HOLDINGS,
  type OracleHolding,
} from "./fixtures";
import { runLegacyOracle } from "./oracle";

function source(rows: readonly OracleHolding[] = ORACLE_HOLDINGS) {
  return rows.map((row, sourceIndex): SourceRow<OracleHolding> => ({
    id: row.id,
    row,
    sourceIndex,
  }));
}

function run(
  options: {
    readonly rows?: readonly OracleHolding[];
    readonly filters?: Record<string, ColumnFilter>;
    readonly sort?: PretableSortEntry[];
    readonly rowGroups?: string[];
    readonly aggregateFilteredRows?: boolean;
    readonly expansion?: Parameters<typeof runLegacyOracle>[0]["expansion"];
  } = {},
) {
  return runLegacyOracle({
    columns: [...ORACLE_COLUMNS],
    rows: source(options.rows),
    filters: options.filters ?? {},
    sort: options.sort ?? [],
    rowGroups: options.rowGroups ?? [],
    aggregateFilteredRows: options.aggregateFilteredRows,
    expansion: options.expansion,
  });
}

function dataIds(rows: ReturnType<typeof run>): string[] {
  return rows.flatMap((entry) =>
    entry.kind === "data" ? [entry.ref.rowId] : [],
  );
}

function group(rows: ReturnType<typeof run>, groupId: string) {
  const found = rows.find(
    (entry) => entry.kind === "group" && entry.ref.groupId === groupId,
  );
  if (found?.kind !== "group") throw new Error(`Missing group ${groupId}`);
  return found;
}

describe("legacy differential oracle", () => {
  test("normalizes group/data identity and preserves escaped IDs without collisions", () => {
    const rows = run({ rowGroups: ["sector", "analyst"] });
    const escapedId = makeGroupId([
      { columnId: "sector", value: "Tech/Growth" },
      { columnId: "analyst", value: "Ada=One" },
    ]);

    expect(group(rows, escapedId).ref).toEqual({
      kind: "group",
      groupId: "__group__:sector=s:Tech%2FGrowth/analyst=s:Ada%3DOne",
    });
    const outerGroupId = makeGroupId([
      { columnId: "sector", value: "Tech/Growth" },
    ]);
    expect(group(rows, outerGroupId).ref).toEqual({
      kind: "group",
      groupId: outerGroupId,
    });
    expect(
      rows.find(
        (entry) =>
          entry.kind === "data" &&
          entry.ref.rowId === "__group__:sector=s:Tech%2FGrowth",
      )?.ref,
    ).toEqual({ kind: "data", rowId: outerGroupId });
  });

  test("pins collator numeric ordering and stable source-order ties", () => {
    const rows = run({
      sort: [
        { columnId: "label", direction: "asc" },
        { columnId: "quantity", direction: "desc" },
      ],
    });

    expect(dataIds(rows)).toEqual([
      "h3",
      "h4",
      "h2",
      "h6",
      "__group__:sector=s:Tech%2FGrowth",
      "h5",
    ]);
    expect(
      dataIds(run({ sort: [{ columnId: "quantity", direction: "asc" }] })),
    ).toEqual([
      "h5",
      "h3",
      "__group__:sector=s:Tech%2FGrowth",
      "h2",
      "h4",
      "h6",
    ]);
  });

  test("pins filtered membership separately from all-row aggregation", () => {
    const filters = {
      quantity: { operator: "gte", value: 20 } as const,
    };
    const energyId = makeGroupId([
      { columnId: "sector", value: "Energy%Core" },
    ]);

    const filtered = run({ filters, rowGroups: ["sector"] });
    const all = run({
      filters,
      rowGroups: ["sector"],
      aggregateFilteredRows: true,
    });

    expect(group(filtered, energyId)).toMatchObject({
      childCount: 1,
      aggregates: { quantity: 40 },
    });
    expect(group(all, energyId)).toMatchObject({
      childCount: 1,
      aggregates: { quantity: 45 },
    });
  });

  test("pins missing-key merging, collapse policy, and group return", () => {
    const blankId = makeGroupId([{ columnId: "sector", value: null }]);
    const collapsed = run({
      rowGroups: ["sector"],
      expansion: {
        default: { kind: "expanded" },
        overrides: new Map([[blankId, false]]),
      },
    });
    expect(group(collapsed, blankId)).toMatchObject({
      childCount: 2,
      value: null,
      expanded: false,
    });
    expect(dataIds(collapsed)).not.toContain("h5");
    expect(dataIds(collapsed)).not.toContain("h6");

    const absent = run({
      rows: ORACLE_HOLDINGS.filter((row) => row.sector != null),
      rowGroups: ["sector"],
      expansion: {
        default: { kind: "expanded" },
        overrides: new Map([[blankId, false]]),
      },
    });
    expect(
      absent.some(
        (entry) => entry.kind === "group" && entry.ref.groupId === blankId,
      ),
    ).toBe(false);

    const returned = run({
      rowGroups: ["sector"],
      expansion: {
        default: { kind: "expanded" },
        overrides: new Map([[blankId, false]]),
      },
    });
    expect(group(returned, blankId).expanded).toBe(false);
  });

  test("pins collapsed-by-default with a sparse expanded override", () => {
    const techId = makeGroupId([{ columnId: "sector", value: "Tech/Growth" }]);
    const rows = run({
      rowGroups: ["sector", "analyst"],
      expansion: {
        default: { kind: "collapsed" },
        overrides: new Map([[techId, true]]),
      },
    });

    expect(group(rows, techId).expanded).toBe(true);
    expect(rows.filter((entry) => entry.kind === "group")).toHaveLength(4);
    expect(dataIds(rows)).toEqual([]);
  });

  test("normalizes the inclusive through-depth policy", () => {
    const rows = run({
      rowGroups: ["sector", "analyst"],
      expansion: { default: { kind: "through-depth", depth: 0 } },
    });

    const groups = rows.filter((entry) => entry.kind === "group");
    expect(
      groups
        .filter((entry) => entry.depth === 0)
        .every((entry) => entry.expanded),
    ).toBe(true);
    expect(
      groups
        .filter((entry) => entry.depth === 1)
        .every((entry) => !entry.expanded),
    ).toBe(true);
    expect(dataIds(rows)).toEqual([]);
  });
});
