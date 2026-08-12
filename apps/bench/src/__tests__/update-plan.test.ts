import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import {
  checksumScenarioRows,
  createDeterministicUpdatePlan,
  ROW_MODEL_BATCH_INTERVAL_MS,
  ROW_MODEL_PATCHES_PER_TICK,
  ROW_MODEL_PATCH_RATE_PER_SEC,
} from "../update-plan";

describe("deterministic row-model update plan", () => {
  test.each(["target", "local-max"] as const)(
    "replays the same row and column schedule for flat and grouped %s runs",
    (scale) => {
      const dataset = createScenarioDataset("S5", { scale });
      const flat = createDeterministicUpdatePlan({
        dataset,
        grouped: false,
        seed: 91_337,
      });
      const grouped = createDeterministicUpdatePlan({
        dataset,
        grouped: true,
        seed: 91_337,
      });

      expect(
        flat.ticks.flatMap((tick) =>
          tick.patches.map((patch) => [patch.id, patch.columnId]),
        ),
      ).toEqual(
        grouped.ticks.flatMap((tick) =>
          tick.patches.map((patch) => [patch.id, patch.columnId]),
        ),
      );
      expect(flat.scheduleChecksum).toBe(grouped.scheduleChecksum);
    },
  );

  test("holds the permanent producer cadence at 50 patches every 50ms", () => {
    const plan = createDeterministicUpdatePlan({
      dataset: createScenarioDataset("S5", { scale: "target" }),
      grouped: true,
      seed: 505,
    });

    expect(ROW_MODEL_PATCH_RATE_PER_SEC).toBe(1_000);
    expect(ROW_MODEL_BATCH_INTERVAL_MS).toBe(50);
    expect(ROW_MODEL_PATCHES_PER_TICK).toBe(50);
    expect(plan.ticks).toHaveLength(60);
    expect(plan.ticks.every((tick) => tick.patches.length === 50)).toBe(true);
    expect(plan.totalPatches).toBe(3_000);
  });

  test("uses unique text group churn and numeric aggregate changes", () => {
    const plan = createDeterministicUpdatePlan({
      dataset: createScenarioDataset("S5", { scale: "target" }),
      grouped: true,
      seed: 12_345,
    });
    const patches = plan.ticks.flatMap((tick) => tick.patches);
    const groupValues = patches
      .filter((patch) => patch.columnId === "col_1")
      .map((patch) => patch.value);
    const aggregateValues = patches
      .filter((patch) => patch.columnId === "col_3")
      .map((patch) => patch.value);

    expect(groupValues.length).toBeGreaterThan(0);
    expect(new Set(groupValues).size).toBe(groupValues.length);
    expect(groupValues.every((value) => typeof value === "string")).toBe(true);
    expect(aggregateValues.length).toBeGreaterThan(0);
    expect(aggregateValues.every((value) => typeof value === "number")).toBe(
      true,
    );
  });

  test("locks grouped expansion, aggregation, and catch-up rebuild metadata", () => {
    const plan = createDeterministicUpdatePlan({
      dataset: createScenarioDataset("S5", { scale: "local-max" }),
      grouped: true,
      seed: 505,
    });

    expect(plan.grouping).toEqual({
      initialExpansion: { kind: "expanded" },
      rowGroups: [{ columnId: "col_1" }],
      aggregate: { columnId: "col_3", operation: "sum" },
      sort: [{ columnId: "col_3", direction: "asc" }],
    });
    expect(plan.rebuild).toEqual({
      startAfterTick: 10,
      sort: [{ columnId: "col_3", direction: "desc" }],
      preservesSourceRowCount: true,
      preservesGroupCount: true,
    });
  });

  test("changes the final checksum when any planned mutable column changes", () => {
    const before = [
      { id: "row-2", col_1: "group-b", col_3: 3, col_7: "old" },
      { id: "row-1", col_1: "group-a", col_3: 1, col_7: "stable" },
    ];
    const after = [
      { ...before[0]!, col_7: "accepted-catch-up-patch" },
      before[1]!,
    ];

    expect(checksumScenarioRows(after)).not.toBe(checksumScenarioRows(before));
    expect(checksumScenarioRows([...after].reverse())).toBe(
      checksumScenarioRows(after),
    );
  });
});
