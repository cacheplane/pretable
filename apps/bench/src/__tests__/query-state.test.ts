import { describe, expect, test } from "vitest";

import { parseBenchQuery } from "../query-state";

describe("parseBenchQuery", () => {
  test("accepts only positive finite transition budgets", () => {
    expect(
      parseBenchQuery(
        "?adapter=pretable&diagnostics=row-model&transitionBudgetMs=1",
      ).transitionBudgetMs,
    ).toBe(1);
    for (const raw of ["0", "-1", "Infinity", "NaN"]) {
      expect(
        parseBenchQuery(`?transitionBudgetMs=${raw}`).transitionBudgetMs,
      ).toBeUndefined();
    }
    expect(parseBenchQuery("").transitionBudgetMs).toBeUndefined();
  });

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
      diagnostics: false,
      seed: 505,
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
      diagnostics: false,
      seed: 505,
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
      diagnostics: false,
      seed: 505,
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
      diagnostics: false,
      seed: 505,
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
      diagnostics: false,
      seed: 505,
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
      diagnostics: false,
      seed: 505,
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
      diagnostics: false,
      seed: 505,
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
      diagnostics: false,
      seed: 505,
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
      diagnostics: false,
      seed: 505,
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

  test("accepts the grouped-updates script", () => {
    expect(
      parseBenchQuery(
        "?adapter=pretable&scenario=S5&scale=target&script=updates-grouped",
      ),
    ).toMatchObject({
      adapterId: "pretable",
      scenarioId: "S5",
      scale: "target",
      scriptName: "updates-grouped",
    });
  });

  test("accepts local-max and explicit row-model diagnostics metadata", () => {
    expect(
      parseBenchQuery(
        "?scenario=S5&scale=local-max&script=updates-grouped&diagnostics=row-model&seed=91337",
      ),
    ).toMatchObject({
      scale: "local-max",
      diagnostics: true,
      seed: 91_337,
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

  test("parses script=filter-keystrokes", () => {
    expect(parseBenchQuery("script=filter-keystrokes").scriptName).toBe(
      "filter-keystrokes",
    );
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

  test("accepts the row-grouping scripts", () => {
    for (const script of ["group", "group-expand"]) {
      expect(
        parseBenchQuery(`?scenario=S2&scale=hypothesis&script=${script}`),
      ).toMatchObject({
        scenarioId: "S2",
        scale: "hypothesis",
        scriptName: script,
      });
    }

    for (const script of ["group-updates", "group-updates-stable-keys"]) {
      expect(
        parseBenchQuery(`?scenario=S5&scale=hypothesis&script=${script}`),
      ).toMatchObject({
        scenarioId: "S5",
        scale: "hypothesis",
        scriptName: script,
      });
    }
  });

  test("accepts the row-set change scripts", () => {
    for (const script of ["replace", "append"]) {
      expect(
        parseBenchQuery(`?scenario=S1&scale=hypothesis&script=${script}`),
      ).toMatchObject({
        scenarioId: "S1",
        scale: "hypothesis",
        scriptName: script,
      });
    }
  });
});
