import { describe, expect, test } from "vitest";

import {
  createScenarioDataset,
  createInspectionDataset,
  getScenarioById,
  inspectionColumns,
  inspectionFilterableColumnIds,
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
      "S7",
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
    expect(first.scale).toBe("smoke");
    expect(first.columns).toHaveLength(50);
    expect(first.rows).toHaveLength(250);
    expect(first.rowCount).toBe(250);
    expect(first.seed).toBe(101);
    expect(first.rows[0]).toMatchObject({
      id: "S1-row-0",
      col_0: expect.any(String),
      col_1: expect.any(String),
      col_2: expect.any(String),
      col_3: expect.any(Number),
    });
  });

  test("supports larger deterministic scales for benchmark-bearing runs", () => {
    const dataset = createScenarioDataset("S2", { scale: "dev" });

    expect(dataset.scale).toBe("dev");
    expect(dataset.rowCount).toBe(750);
    expect(dataset.rows).toHaveLength(750);
    expect(dataset.rows[749]).toMatchObject({
      id: "S2-row-749",
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

  test("models pinned-inspection scenario with 3 pinned columns and variable-height wrapped text", () => {
    const dataset = createScenarioDataset("S7");

    expect(getScenarioById("S7")).toMatchObject({
      id: "S7",
      name: "pinned-inspection",
      cols: 40,
      row_height_mode: "variable",
      wrapped_columns: 3,
      pinned_left: 3,
      corpus: "multilingual",
      update_stream: "none",
    });
    expect(dataset.columns).toHaveLength(40);
    expect(dataset.columns[0]).toMatchObject({ pinned: "left", wrap: true });
    expect(dataset.columns[1]).toMatchObject({ pinned: "left", wrap: true });
    expect(dataset.columns[2]).toMatchObject({ pinned: "left", wrap: true });
    expect(dataset.columns[3]).toMatchObject({
      wrap: false,
      pinned: undefined,
    });
    expect(dataset.columns[4]).toMatchObject({
      wrap: false,
      pinned: undefined,
    });
    expect(dataset.columns[5]).toMatchObject({
      wrap: false,
      pinned: undefined,
    });
    expect(dataset.seed).toBe(707);
    expect(dataset.scale).toBe("smoke");
    expect(dataset.rowCount).toBe(120);
    expect(dataset.rows).toHaveLength(120);
  });

  test("models many-columns scenario S3 with 500 columns and 2 pinned", () => {
    const dataset = createScenarioDataset("S3");

    expect(getScenarioById("S3")).toMatchObject({
      id: "S3",
      name: "many-columns",
      cols: 500,
      row_height_mode: "fixed",
      wrapped_columns: 0,
      pinned_left: 2,
      update_stream: "none",
    });
    expect(dataset.columns).toHaveLength(500);
    expect(dataset.columns[0]).toMatchObject({ pinned: "left" });
    expect(dataset.columns[1]).toMatchObject({ pinned: "left" });
    expect(dataset.columns[2]).toMatchObject({ pinned: undefined });
    expect(dataset.seed).toBe(303);
    expect(dataset.scale).toBe("smoke");
    expect(dataset.rowCount).toBe(120);
  });

  test("supports all scale levels for S7 with same row counts as S2", () => {
    expect(createScenarioDataset("S7", { scale: "smoke" }).rowCount).toBe(120);
    expect(createScenarioDataset("S7", { scale: "dev" }).rowCount).toBe(750);
    expect(createScenarioDataset("S7", { scale: "hypothesis" }).rowCount).toBe(
      3_000,
    );
    expect(createScenarioDataset("S7", { scale: "target" }).rowCount).toBe(
      50_000,
    );
  });

  test("creates deterministic inspection datasets across tiny, dev, and stress scales", () => {
    const tiny = createInspectionDataset("tiny");
    const dev = createInspectionDataset("dev");
    const stress = createInspectionDataset("stress");

    expect(createInspectionDataset("dev")).toEqual(dev);
    expect(tiny.scale).toBe("tiny");
    expect(dev.scale).toBe("dev");
    expect(stress.scale).toBe("stress");
    expect(tiny.rows).toHaveLength(7);
    expect(dev.rows).toHaveLength(250);
    expect(stress.rows).toHaveLength(2_500);
    expect(tiny.columns).toEqual(inspectionColumns);
    expect(dev.columns).toEqual(inspectionColumns);
    expect(stress.columns).toEqual(inspectionColumns);
    expect(inspectionFilterableColumnIds).toEqual([
      "timestamp",
      "severity",
      "source",
      "message",
    ]);
    expect(dev.rows[0]).toMatchObject({
      id: "evt-dev-0000",
      severity: expect.any(String),
      message: expect.any(String),
    });
    expect(stress.rows[2_499]).toMatchObject({
      id: "evt-stress-2499",
    });
  });
});
