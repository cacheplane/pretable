import { describe, expect, test } from "vitest";

import {
  createScenarioDataset,
  getScenarioById,
  listScenarios,
} from "../index";

describe("scenario-data registry", () => {
  test("lists all benchmark scenarios in stable benchmark-plan order", () => {
    expect(listScenarios().map((scenario) => scenario.id)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
    ]);
  });

  test("preserves scenario-defining benchmark-plan fields", () => {
    expect(getScenarioById("S2")).toMatchObject({
      id: "S2",
      corpus: "multilingual",
      row_height_mode: "variable",
      wrapped_columns: 3,
      update_stream: "none",
    });

    expect(getScenarioById("S4")).toMatchObject({
      id: "S4",
      autosize_all_columns: true,
      row_height_mode: "mixed",
    });

    expect(getScenarioById("S6")).toMatchObject({
      id: "S6",
      rich_cells_percent: 10,
      pinned_left: 1,
    });
  });

  test("creates deterministic dataset fixtures for runnable scenarios", () => {
    const first = createScenarioDataset("S1");
    const second = createScenarioDataset("S1");

    expect(first).toEqual(second);
    expect(first.scenario.id).toBe("S1");
    expect(first.columns).toHaveLength(50);
    expect(first.rows).toHaveLength(24);
    expect(first.seed).toBe(101);
    expect(first.rows[0]).toMatchObject({
      id: "S1-row-0",
      col_0: expect.any(String),
      col_1: expect.any(String),
      col_2: expect.any(String),
      col_3: expect.any(Number),
    });
  });

  test("models wrapped columns and full column count for the wedge scenario", () => {
    const dataset = createScenarioDataset("S2");

    expect(dataset.columns).toHaveLength(40);
    expect(dataset.columns.slice(0, 3)).toEqual([
      expect.objectContaining({ id: "col_0", wrap: true }),
      expect.objectContaining({ id: "col_1", wrap: true }),
      expect.objectContaining({ id: "col_2", wrap: true }),
    ]);
    expect(dataset.columns[3]).toEqual(
      expect.objectContaining({ id: "col_3", wrap: false }),
    );
    expect(String(dataset.rows[0]?.col_0 ?? "")).not.toEqual(
      String(dataset.rows[1]?.col_0 ?? ""),
    );
  });
});
