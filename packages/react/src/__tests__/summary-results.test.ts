import { describe, expect, it } from "vitest";
import { resolveSummaries, type PretableServerSummaryResult } from "../summary";
const ready = {
  state: "ready",
  requestKey: "q1",
  aggregateDefinitionKey: "sum-v1",
  completeness: "complete",
  values: { amount: null, unknown: 99 },
} as const;
const resolve = (
  result: PretableServerSummaryResult,
  requestKey = "q1",
  aggregateDefinitionKey = "sum-v1",
) =>
  resolveSummaries({
    summaries: {
      filtered: {
        authority: "server",
        requestKey,
        aggregateDefinitionKey,
        result,
      },
    },
    columns: [{ id: "amount" }, { id: "missing" }],
  }).filtered;
describe("summary provenance", () => {
  it("preserves null, omits unavailable cells and ignores unknown columns", () =>
    expect(resolve(ready)).toMatchObject({
      state: "ready",
      values: { amount: null },
    }));
  it("rejects older requests, aggregate overrides and order-sensitive sort identities", () => {
    expect(resolve(ready, "q2-sort")).toMatchObject({ state: "unavailable" });
    expect(resolve(ready, "q1", "avg-v2")).toMatchObject({
      state: "unavailable",
    });
  });
  it("allows explicitly labelled stale answers only with compatible definitions", () => {
    const stale = {
      ...ready,
      state: "stale",
      label: "Before refresh",
    } as const;
    expect(resolve(stale, "q2")).toMatchObject({
      state: "stale",
      requestKey: "q1",
      label: "Before refresh",
    });
    expect(resolve(stale, "q2", "avg-v2")).toMatchObject({
      state: "unavailable",
    });
  });
  it("never retains values in loading or error states", () => {
    for (const state of ["loading", "error", "unavailable"] as const)
      expect(resolve({ ...ready, state })).not.toHaveProperty("values");
  });
  it("resolves mixed authorities independently and labels external engine results loaded", () => {
    const result = resolveSummaries({
      summaries: {
        filtered: {
          authority: "server",
          requestKey: "q1",
          aggregateDefinitionKey: "sum-v1",
          result: ready,
        },
        all: { authority: "engine" },
      },
      columns: [{ id: "amount" }],
      processing: { filter: "external" },
      snapshot: { getSummary: (scope) => ({ scope, values: { amount: 4 } }) },
    });
    expect(result.filtered).toMatchObject({
      state: "ready",
      authority: "server",
      completeness: "complete",
    });
    expect(result.all).toMatchObject({
      state: "ready",
      authority: "engine",
      completeness: "partial",
      dataScope: "loaded",
    });
  });
  it("supports server answers without optional engine capability", () => {
    expect(
      resolveSummaries({
        summaries: { all: { authority: "engine" } },
        columns: [],
        snapshot: {},
      }).all,
    ).toMatchObject({ state: "unavailable" });
    expect(resolve(ready)).toMatchObject({ state: "ready" });
  });
});
it("does not call a partial server population loaded rows", () => {
  expect(resolve({ ...ready, completeness: "partial" })).toMatchObject({
    caption: "Matching rows",
    completeness: "partial",
    dataScope: "partial",
  });
});
it("keeps known partial local input loaded regardless of population count", () => {
  for (const summaries of [
    { all: { authority: "engine", completeness: "partial" } },
    { all: { authority: "engine" } },
  ] as const) {
    expect(
      resolveSummaries({
        summaries,
        columns: [{ id: "amount" }],
        loadedOnly: true,
        snapshot: { getSummary: (scope) => ({ scope, values: { amount: 2 } }) },
      }).all,
    ).toMatchObject({ completeness: "partial", caption: "All loaded rows" });
  }
});
