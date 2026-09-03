import { describe, expect, test } from "vitest";

import {
  createScenarioDataset,
  legacyScenarioRoles,
} from "@pretable-internal/scenario-data";

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
        roles: dataset.roles,
      });
      const grouped = createDeterministicUpdatePlan({
        dataset,
        grouped: true,
        seed: 91_337,
        roles: dataset.roles,
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
      roles: legacyScenarioRoles,
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
      roles: legacyScenarioRoles,
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
      roles: legacyScenarioRoles,
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

  test("keeps the S5 uniform-cell schedule byte-identical (negative control)", () => {
    const plan = createDeterministicUpdatePlan({
      dataset: createScenarioDataset("S5", { scale: "target" }),
      grouped: false,
      seed: 505,
      roles: legacyScenarioRoles,
    });
    // Captured before the ripple mode existed. A change here means an S5
    // baseline moved; that is never a side effect, always its own PR.
    expect(plan.scheduleChecksum).toBe("fnv1a-7bf53b3a");
    expect(plan.ticks[0]!.patches[0]).toMatchObject({
      id: "S5-row-828",
      columnId: "col_26",
    });
    expect(plan.ticks[0]!.patches[0]!.changes).toEqual({
      col_26: plan.ticks[0]!.patches[0]!.value,
    });
  });

  describe("ripple stream", () => {
    const dataset = createScenarioDataset("S8", { scale: "dev" });
    const plan = createDeterministicUpdatePlan({
      dataset,
      grouped: true,
      seed: 808,
      roles: dataset.roles,
    });
    const patches = plan.ticks.flatMap((tick) => tick.patches);

    test("every patch moves lastPrice and recomputes exactly the derived columns", () => {
      expect(patches).toHaveLength(3_000);
      for (const patch of patches) {
        expect(patch.columnId).toBe("lastPrice");
        expect(Object.keys(patch.changes).sort()).toEqual([
          "dayChangePct",
          "dayPnl",
          "lastPrice",
          "marketValue",
          "unrealizedPnl",
        ]);
        expect(patch.changes.lastPrice).toBe(patch.value);
        expect(Number(patch.value)).toBeGreaterThan(0);
      }
    });

    test("never writes a group column", () => {
      for (const patch of patches) {
        expect("strategy" in patch.changes).toBe(false);
        expect("sector" in patch.changes).toBe(false);
      }
    });

    test("derived values are the formulas applied to the compounded row", () => {
      const working = new Map(
        dataset.rows.map((row) => [String(row.id), { ...row }]),
      );
      for (const patch of patches) {
        const row = working.get(patch.id)!;
        row.lastPrice = patch.changes.lastPrice!;
        const expected =
          dataset.roles.stream.mode === "ripple"
            ? dataset.roles.stream.derive(row)
            : {};
        expect(patch.changes).toEqual({
          lastPrice: patch.changes.lastPrice,
          ...expected,
        });
        Object.assign(row, patch.changes);
      }
    });

    test("price steps are daily-vol sized: every tick moves lastPrice by well under 2%", () => {
      const working = new Map(
        dataset.rows.map((row) => [String(row.id), Number(row.lastPrice)]),
      );
      let maxRelativeStep = 0;
      for (const patch of patches) {
        const previous = working.get(patch.id)!;
        const next = Number(patch.value);
        maxRelativeStep = Math.max(
          maxRelativeStep,
          Math.abs(next - previous) / previous,
        );
        working.set(patch.id, next);
      }
      // σ = 0.002 → a 5σ move is 1%; 3 000 draws never plausibly exceed 2%.
      // Rounding to cents on a $1 price can add up to 0.5%, hence the margin.
      expect(maxRelativeStep).toBeLessThan(0.02);
      expect(maxRelativeStep).toBeGreaterThan(0);
    });

    test("is deterministic and reads its grouping from roles", () => {
      const again = createDeterministicUpdatePlan({
        dataset,
        grouped: true,
        seed: 808,
        roles: dataset.roles,
      });
      expect(again.scheduleChecksum).toBe(plan.scheduleChecksum);
      expect(again.ticks).toEqual(plan.ticks);
      expect(plan.grouping).toEqual({
        initialExpansion: { kind: "expanded" },
        rowGroups: [{ columnId: "strategy" }, { columnId: "sector" }],
        aggregate: { columnId: "marketValue", operation: "sum" },
        sort: [{ columnId: "marketValue", direction: "asc" }],
      });
      expect(plan.rebuild?.sort).toEqual([
        { columnId: "marketValue", direction: "desc" },
      ]);
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
