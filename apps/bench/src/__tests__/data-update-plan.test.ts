import { describe, expect, test } from "vitest";

import { createScenarioDataset } from "@pretable-internal/scenario-data";

import {
  BENCH_RESIDENT_CAP_ROWS,
  BENCH_WINDOW_ROWS,
  createBenchDataUpdatePlan,
} from "../data-update-plan";

const dataset = createScenarioDataset("S1", { scale: "dev" });

describe("createBenchDataUpdatePlan", () => {
  test("replace hands back one window of the same ids with new payloads", () => {
    const { plan } = createBenchDataUpdatePlan(dataset, "replace");

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
    // EVERY column changes, not just the probe: a poll-refresh returns a whole new
    // payload, and rewriting one cell would time the engine diffing 1 value out of N.
    for (const [index, row] of plan!.nextRows.entries()) {
      const before = plan!.initialRows[index]!;

      for (const column of dataset.columns) {
        expect(row[column.id]).not.toBe(before[column.id]);
      }
    }
  });

  test("replace preserves each column's value type, so the surface formats the same thing", () => {
    const { plan } = createBenchDataUpdatePlan(dataset, "replace");
    const before = plan!.initialRows[0]!;
    const after = plan!.nextRows[0]!;

    // S1 mixes string columns with a numeric score column; coercing the number to a
    // string would measure a type change rather than a value change.
    expect(
      dataset.columns.some((column) => typeof before[column.id] === "number"),
    ).toBe(true);

    for (const column of dataset.columns) {
      expect(typeof after[column.id]).toBe(typeof before[column.id]);
    }
  });

  test("append extends the resident set to the 1 000-row cap without disturbing it", () => {
    const { plan } = createBenchDataUpdatePlan(dataset, "append");

    expect(plan).not.toBeNull();
    expect(plan?.mode).toBe("append");
    expect(plan?.initialRows).toHaveLength(800);
    expect(plan?.nextRows).toHaveLength(1_000);
    expect(plan?.resultRowCount).toBe(1_000);

    // The resident prefix must be untouched — an append that also rewrote the
    // rows already on screen would measure a replace wearing append's name.
    expect(plan?.nextRows.slice(0, 800)).toEqual(plan?.initialRows);
  });

  test("append probes the LAST resident row, so the viewport parks where the new page lands", () => {
    const { plan } = createBenchDataUpdatePlan(dataset, "append");

    // Controlled focus scrolls the probe into view. Anywhere but the tail leaves the
    // appended rows below the fold, and blank-gap frames, anchor shift and row-height
    // error are then computed over rows the append never touched.
    expect(plan?.focusedRowId).toBe(
      plan!.initialRows[plan!.initialRows.length - 1]!.id,
    );
  });

  test("both modes probe a row that is resident before the measured update", () => {
    for (const mode of ["replace", "append"] as const) {
      const { plan } = createBenchDataUpdatePlan(dataset, mode);
      const residentIds = new Set(plan?.initialRows.map((row) => row.id));

      expect(plan?.focusedRowId).toBe(plan?.selectedRowId);
      expect(plan?.focusedRowId).toBeTruthy();
      expect(residentIds.has(plan!.focusedRowId!)).toBe(true);
    }
  });

  test("probes a column that is neither wrapped nor pinned, on a scenario where column 0 is both", () => {
    // S2 sets wrapped_columns and pinned_left, so `columns[0]` is a pinned, wrapped
    // cell. A wrapped cell re-measures its row height after the new text paints, which
    // the change detector would race; a pinned cell sits outside the scrollable track
    // the sampler walks.
    //
    // `hypothesis`, not `dev`: S2/dev holds 750 rows and cannot host the resident
    // window at all — only S1 reaches 1 200 rows at dev scale.
    const wrapped = createScenarioDataset("S2", { scale: "hypothesis" });
    const probeColumn = wrapped.columns.find(
      (column) =>
        column.id ===
        createBenchDataUpdatePlan(wrapped, "replace").plan!.probeColumnId,
    );

    expect(wrapped.columns[0]!.wrap).toBe(true);
    expect(wrapped.columns[0]!.pinned).toBe("left");
    expect(probeColumn?.wrap).toBe(false);
    expect(probeColumn?.pinned).toBeUndefined();
    expect(typeof wrapped.rows[0]![probeColumn!.id]).toBe("string");
  });

  test("refuses a dataset too small to express either shape, and says why", () => {
    const smoke = createScenarioDataset("S1", { scale: "smoke" });

    expect(smoke.rows.length).toBeLessThan(
      BENCH_RESIDENT_CAP_ROWS + BENCH_WINDOW_ROWS,
    );

    for (const mode of ["replace", "append"] as const) {
      const result = createBenchDataUpdatePlan(smoke, mode);

      expect(result.plan).toBeNull();
      // The caller publishes this verbatim, so it has to name the real cause rather
      // than restate one of the two gates as a guess.
      expect(result.reason).toContain(`holds ${smoke.rows.length} rows`);
      expect(result.reason).toContain(
        String(BENCH_RESIDENT_CAP_ROWS + BENCH_WINDOW_ROWS),
      );
    }
  });

  test("refuses a dataset with no string column, and says so rather than blaming row count", () => {
    const numericOnly = {
      ...dataset,
      columns: [{ id: "col_9", header: "Score", wrap: false }],
      rows: dataset.rows.map((row) => ({ id: row.id, col_9: 1 })),
    };
    const result = createBenchDataUpdatePlan(numericOnly, "replace");

    expect(result.plan).toBeNull();
    expect(result.reason).toContain("no string-valued column");
    expect(result.reason).not.toContain("rows, fewer than");
  });
});
