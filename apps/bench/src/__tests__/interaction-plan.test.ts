import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import {
  benchUpdatesExcludedColumnIds,
  createBenchInteractionPlan,
} from "../interaction-plan";

const groupKeyCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

describe("interaction plan reads column roles", () => {
  test("S5 plans are unchanged: col_3 sort, col_6/col_0 filters, col_5 grouping", () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    expect(createBenchInteractionPlan(dataset, "sort")?.sort).toEqual([
      { columnId: "col_3", direction: "desc" },
    ]);
    expect(
      createBenchInteractionPlan(dataset, "filter-metadata")?.probeColumnId,
    ).toBe("col_6");
    expect(createBenchInteractionPlan(dataset, "filter-text")?.probeColumnId).toBe(
      "col_0",
    );
    expect(createBenchInteractionPlan(dataset, "group")?.rowGroups).toEqual([
      "col_5",
    ]);
    expect(createBenchInteractionPlan(dataset, "group")?.resultRowCount).toBe(
      dataset.rows.length + 4,
    );
    expect(
      benchUpdatesExcludedColumnIds(dataset, "group-updates-stable-keys"),
    ).toEqual(["col_5"]);
    expect(benchUpdatesExcludedColumnIds(dataset, "updates")).toEqual([]);
  });

  // Negative control for the level-aware group counter: S5 has ONE grouping
  // level, so collapsing the first group hides no nested group rows and the
  // pre-roles formula (rows - collapsed + 4) must still hold exactly.
  test("S5 group-expand result count matches the pre-roles formula", () => {
    const dataset = createScenarioDataset("S5", { scale: "smoke" });
    const keys = [
      ...new Set(dataset.rows.map((row) => String(row.col_5 ?? ""))),
    ].sort(groupKeyCollator.compare);
    const collapsedRowCount = dataset.rows.filter(
      (row) => String(row.col_5 ?? "") === keys[0],
    ).length;
    const plan = createBenchInteractionPlan(dataset, "group-expand")!;

    expect(keys).toHaveLength(4);
    expect(plan.resultRowCount).toBe(
      dataset.rows.length - collapsedRowCount + 4,
    );
    expect(plan.collapsedGroupRowCount).toBe(collapsedRowCount);
    expect(plan.collapsedGroupKey).toBe(keys[0]);
  });

  test("S8 sort/filter plans use the finance columns", () => {
    const dataset = createScenarioDataset("S8", { scale: "dev" });
    expect(createBenchInteractionPlan(dataset, "sort")?.sort).toEqual([
      { columnId: "marketValue", direction: "desc" },
    ]);
    const meta = createBenchInteractionPlan(dataset, "filter-metadata")!;
    expect(meta.filters).toEqual({
      sector: { operator: "contains", value: "Technology" },
    });
    expect(meta.resultRowCount).toBe(
      dataset.rows.filter((row) => row.sector === "Technology").length,
    );
    const text = createBenchInteractionPlan(dataset, "filter-text")!;
    expect(text.resultRowCount).toBe(
      dataset.rows.filter((row) => String(row.notes).includes("earnings"))
        .length,
    );
    expect(text.resultRowCount).toBeGreaterThan(0);
  });

  test("S8 group plan counts one group row per strategy and per strategy×sector", () => {
    const dataset = createScenarioDataset("S8", { scale: "dev" });
    const plan = createBenchInteractionPlan(dataset, "group")!;
    expect(plan.rowGroups).toEqual(["strategy", "sector"]);
    expect(plan.resultRowCount).toBe(dataset.rows.length + 8 + 88);
  });

  test("S8 group-expand collapses the first strategy and its sectors", () => {
    const dataset = createScenarioDataset("S8", { scale: "dev" });
    const plan = createBenchInteractionPlan(dataset, "group-expand")!;
    const strategies = [
      ...new Set(dataset.rows.map((r) => String(r.strategy))),
    ].sort(groupKeyCollator.compare);
    const first = strategies[0]!;
    const collapsedRows = dataset.rows.filter((r) => r.strategy === first);
    const collapsedSectors = new Set(collapsedRows.map((r) => r.sector)).size;
    expect(collapsedSectors).toBe(11);
    expect(plan.resultRowCount).toBe(
      dataset.rows.length -
        collapsedRows.length +
        (8 + 88) -
        collapsedSectors,
    );
    const probe = dataset.rows.find((r) => String(r.id) === plan.focusedRowId)!;
    expect(probe.strategy).toBe(strategies[1]);
  });

  test("S8 stable-keys excludes both grouping levels", () => {
    const dataset = createScenarioDataset("S8", { scale: "smoke" });
    expect(
      benchUpdatesExcludedColumnIds(dataset, "group-updates-stable-keys"),
    ).toEqual(["strategy", "sector"]);
  });
});
