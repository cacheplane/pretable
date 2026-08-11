import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import { createBenchDataUpdatePlan } from "../data-update-plan";

const dataset = createScenarioDataset("S1", { scale: "dev" });

describe("createBenchDataUpdatePlan", () => {
  test("replace hands back one window of the same ids with new payloads", () => {
    const plan = createBenchDataUpdatePlan(dataset, "replace");

    expect(plan).not.toBeNull();
    expect(plan?.mode).toBe("replace");
    expect(plan?.initialRows).toHaveLength(200);
    expect(plan?.nextRows).toHaveLength(200);
    expect(plan?.resultRowCount).toBe(200);

    // Identity preserved: this is what lets the engine keep selection, focus and
    // measured heights across the replacement.
    expect(plan?.nextRows.map((row) => row.id)).toEqual(
      plan?.initialRows.map((row) => row.id),
    );
    // Payload changed on every row, or the run would measure a no-op.
    const probeColumnId = plan!.probeColumnId;
    for (const [index, row] of plan!.nextRows.entries()) {
      expect(row[probeColumnId]).not.toBe(
        plan!.initialRows[index]![probeColumnId],
      );
    }
  });

  test("append extends the resident set to the 1 000-row cap without disturbing it", () => {
    const plan = createBenchDataUpdatePlan(dataset, "append");

    expect(plan).not.toBeNull();
    expect(plan?.mode).toBe("append");
    expect(plan?.initialRows).toHaveLength(800);
    expect(plan?.nextRows).toHaveLength(1_000);
    expect(plan?.resultRowCount).toBe(1_000);

    // The resident prefix must be untouched — an append that also rewrote the
    // rows already on screen would measure a replace wearing append's name.
    expect(plan?.nextRows.slice(0, 800)).toEqual(plan?.initialRows);
  });

  test("both modes probe a row that is resident before the measured update", () => {
    for (const mode of ["replace", "append"] as const) {
      const plan = createBenchDataUpdatePlan(dataset, mode);
      const residentIds = new Set(plan?.initialRows.map((row) => row.id));

      expect(plan?.focusedRowId).toBe(plan?.selectedRowId);
      expect(plan?.focusedRowId).toBeTruthy();
      expect(residentIds.has(plan!.focusedRowId!)).toBe(true);
    }
  });

  test("refuses a dataset too small to express either shape", () => {
    const smoke = createScenarioDataset("S1", { scale: "smoke" });

    expect(smoke.rows.length).toBeLessThan(1_200);
    expect(createBenchDataUpdatePlan(smoke, "replace")).toBeNull();
    expect(createBenchDataUpdatePlan(smoke, "append")).toBeNull();
  });
});
