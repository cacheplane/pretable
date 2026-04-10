import { describe, expect, test } from "vitest";

import { parseBenchQuery } from "../query-state";

describe("parseBenchQuery", () => {
  test("uses deterministic P0a defaults", () => {
    expect(parseBenchQuery("")).toEqual({
      adapterId: "pretable",
      scenarioId: "S1",
      profile: "default",
      scriptName: "initial",
      autorun: false,
    });
  });

  test("falls back to safe defaults for unsupported params", () => {
    expect(
      parseBenchQuery(
        "?adapter=gridgamma&scenario=S6&profile=tuned&script=autosize&autorun=1",
      ),
    ).toEqual({
      adapterId: "pretable",
      scenarioId: "S1",
      profile: "default",
      scriptName: "initial",
      autorun: true,
    });
  });

  test("accepts a supported competitor adapter without relaxing other defaults", () => {
    expect(parseBenchQuery("?adapter=gridalpha&scenario=S2&script=scroll")).toEqual({
      adapterId: "gridalpha",
      scenarioId: "S2",
      profile: "default",
      scriptName: "scroll",
      autorun: false,
    });
  });
});
