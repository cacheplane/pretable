import { expect, it } from "vitest";
import { readRemoteSummary } from "../summaries";
import {
  capabilities,
  groupedQuery,
  session,
  summary,
  aggregate,
} from "./fixtures/responses";

it("keeps filtered and all same-version answers keyed and server-authoritative", () => {
  const answers = [summary(0), { ...summary(20), scope: "all" as const }];
  expect(
    readRemoteSummary(groupedQuery, capabilities, session, answers, "filtered"),
  ).toMatchObject({
    state: "ready",
    summary: {
      resultToken: "token",
      values: {
        sum: {
          value: 0,
          aggregateDefinitionKey: aggregate().aggregateDefinitionKey,
        },
      },
    },
  });
  expect(
    readRemoteSummary(groupedQuery, capabilities, session, answers, "all"),
  ).toMatchObject({
    state: "ready",
    summary: { values: { sum: { value: 20 } } },
  });
});
it("never substitutes a cached total for unsupported base-dataset capability", () => {
  expect(
    readRemoteSummary(
      groupedQuery,
      {
        ...capabilities,
        summaries: { ...capabilities.summaries, all: "unavailable" },
      },
      session,
      [{ ...summary(), scope: "all" }],
      "all",
    ),
  ).toEqual({ state: "unavailable" });
});
it("rejects stale version and definition answers, but ignores presentation-only changes", () => {
  const answers = [summary()];
  expect(
    readRemoteSummary(
      groupedQuery,
      capabilities,
      { ...session, resultToken: "next" },
      answers,
      "filtered",
    ),
  ).toEqual({ state: "unavailable" });
  expect(
    readRemoteSummary(
      { ...groupedQuery, registryVersion: "2" },
      capabilities,
      session,
      answers,
      "filtered",
    ),
  ).toEqual({ state: "unavailable" });
  expect(
    readRemoteSummary(
      { ...groupedQuery, columnWidths: { value: 200 } } as typeof groupedQuery,
      capabilities,
      session,
      answers,
      "filtered",
    ).state,
  ).toBe("ready");
});
it("preserves failed aggregate and request errors separately from numeric zero", () => {
  const failed = {
    ...summary(),
    values: {
      sum: {
        ...aggregate(),
        state: "error" as const,
        error: { code: "timeout" as const },
      },
    },
  };
  expect(
    readRemoteSummary(
      groupedQuery,
      capabilities,
      session,
      [failed],
      "filtered",
    ),
  ).toMatchObject({
    state: "ready",
    summary: { values: { sum: { state: "error" } } },
  });
  expect(
    readRemoteSummary(groupedQuery, capabilities, session, [], "filtered", {
      code: "timeout",
    }),
  ).toEqual({ state: "error", error: { code: "timeout" } });
});
