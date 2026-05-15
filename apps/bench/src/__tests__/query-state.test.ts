import { describe, expect, test } from "vitest";

import { parseBenchQuery } from "../query-state";

describe("parseBenchQuery", () => {
  test("uses deterministic P0a defaults", () => {
    expect(parseBenchQuery("")).toEqual({
      adapterId: "pretable",
      scenarioId: "S1",
      profile: "default",
      scale: "dev",
      scriptName: "initial",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
    });
  });

  test("falls back to safe defaults for unsupported params", () => {
    expect(
      parseBenchQuery(
        "?adapter=glide&scenario=S6&profile=tuned&script=bogus&autorun=1",
      ),
    ).toEqual({
      adapterId: "pretable",
      scenarioId: "S1",
      profile: "default",
      scale: "dev",
      scriptName: "initial",
      autorun: true,
      updateRatePerSec: 1000,
      waitForTrigger: false,
    });
  });

  test("accepts the ag-grid competitor adapter without relaxing other defaults", () => {
    expect(
      parseBenchQuery(
        "?adapter=ag-grid&scenario=S2&scale=hypothesis&script=scroll",
      ),
    ).toEqual({
      adapterId: "ag-grid",
      scenarioId: "S2",
      profile: "default",
      scale: "hypothesis",
      scriptName: "scroll",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
    });
  });

  test("accepts the tanstack competitor adapter without relaxing other defaults", () => {
    expect(
      parseBenchQuery(
        "?adapter=tanstack&scenario=S2&scale=hypothesis&script=scroll",
      ),
    ).toEqual({
      adapterId: "tanstack",
      scenarioId: "S2",
      profile: "default",
      scale: "hypothesis",
      scriptName: "scroll",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
    });
  });

  test("accepts the mui competitor adapter without relaxing other defaults", () => {
    expect(
      parseBenchQuery(
        "?adapter=mui&scenario=S2&scale=hypothesis&script=scroll",
      ),
    ).toEqual({
      adapterId: "mui",
      scenarioId: "S2",
      profile: "default",
      scale: "hypothesis",
      scriptName: "scroll",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
    });
  });

  test("accepts S7 pinned-inspection scenario", () => {
    expect(parseBenchQuery("?scenario=S7&scale=dev&script=scroll")).toEqual({
      adapterId: "pretable",
      scenarioId: "S7",
      profile: "default",
      scale: "dev",
      scriptName: "scroll",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
    });
  });

  test("accepts S4 offscreen-autosize scenario", () => {
    expect(parseBenchQuery("?scenario=S4&scale=dev&script=scroll")).toEqual({
      adapterId: "pretable",
      scenarioId: "S4",
      profile: "default",
      scale: "dev",
      scriptName: "scroll",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
    });
  });

  test("accepts S3 many-columns scenario", () => {
    expect(parseBenchQuery("?scenario=S3&scale=dev&script=scroll")).toEqual({
      adapterId: "pretable",
      scenarioId: "S3",
      profile: "default",
      scale: "dev",
      scriptName: "scroll",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
    });
  });

  test("accepts S5 streaming-updates scenario", () => {
    expect(parseBenchQuery("?scenario=S5&scale=dev&script=scroll")).toEqual({
      adapterId: "pretable",
      scenarioId: "S5",
      profile: "default",
      scale: "dev",
      scriptName: "scroll",
      autorun: false,
      updateRatePerSec: 1000,
      waitForTrigger: false,
    });
  });

  test("accepts updates script", () => {
    expect(
      parseBenchQuery("?scenario=S5&scale=dev&script=updates"),
    ).toMatchObject({
      scenarioId: "S5",
      scale: "dev",
      scriptName: "updates",
    });
  });

  test("accepts supported interaction scripts without collapsing back to initial", () => {
    expect(parseBenchQuery("?scenario=S2&scale=dev&script=sort")).toMatchObject(
      {
        scenarioId: "S2",
        scale: "dev",
        scriptName: "sort",
      },
    );

    expect(
      parseBenchQuery("?scenario=S2&scale=dev&script=filter-metadata"),
    ).toMatchObject({
      scenarioId: "S2",
      scale: "dev",
      scriptName: "filter-metadata",
    });

    expect(
      parseBenchQuery("?scenario=S2&scale=dev&script=filter-text"),
    ).toMatchObject({
      scenarioId: "S2",
      scale: "dev",
      scriptName: "filter-text",
    });
  });

  test("accepts new selection-nav and cell-renderer scripts (Bench Slab 1)", () => {
    for (const script of [
      "select-range-extend",
      "keyboard-nav-row",
      "select-all",
      "scroll-with-format",
      "scroll-with-render",
      "scroll-with-heavy-render",
    ]) {
      expect(
        parseBenchQuery(`?scenario=S2&scale=hypothesis&script=${script}`),
      ).toMatchObject({
        scenarioId: "S2",
        scale: "hypothesis",
        scriptName: script,
      });
    }
  });
});
