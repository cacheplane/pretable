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
    expect(first.columns).toHaveLength(4);
    expect(first.rows).toHaveLength(24);
    expect(first.seed).toBe(101);
    expect(first.rows[0]).toMatchObject({
      id: "S1-row-0",
      message: expect.any(String),
      owner: expect.any(String),
      status: expect.any(String),
      score: expect.any(Number),
    });
  });
});
