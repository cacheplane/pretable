import { mergeModelPresentationColumnsForTesting } from "../use-pretable";
import { expect, it, vi } from "vitest";
import {
  compileValueFormatters,
  formatSummaryValue,
} from "../value-formatting";
import type { PretableColumn } from "../types";
import type { PretableResolvedSummary } from "../summary";
const summary = {
  caption: "All input rows",
  dataScope: "all",
  scope: "all",
  authority: "engine",
  completeness: "complete",
  state: "ready",
  values: { amount: 1234.5 },
} as const;
const column: PretableColumn<{ id: string }> = {
  id: "amount",
  numberFormat: { minimumFractionDigits: 2 },
};
const format = (
  result: PretableResolvedSummary = summary,
  col = column,
  locale = "en-US",
) =>
  formatSummaryValue({
    summary: result,
    column: col,
    valueFormatters: compileValueFormatters([col], locale),
    fallback: (value) => String(value),
    unavailable: "—",
  });
it("uses summary callback before native formatting and preserves explicit null", () => {
  const callback = vi.fn(({ value }) => `summary:${String(value)}`);
  expect(format(summary, { ...column, formatSummary: callback })).toBe(
    "summary:1234.5",
  );
  expect(callback.mock.calls[0]?.[0]).toMatchObject({
    summary: {
      scope: "all",
      authority: "engine",
      completeness: "complete",
      state: "ready",
    },
  });
  expect(
    format(
      { ...summary, values: { amount: null } },
      {
        ...column,
        formatSummary: callback,
      },
    ),
  ).toBe("summary:null");
});
it("uses native locale formatting and generic fallback", () => {
  expect(format()).toBe("1,234.50");
  expect(format(summary, column, "de-DE")).toBe("1.234,50");
  expect(format(summary, { id: "amount" })).toBe("1234.5");
  expect(
    format(
      { ...summary, values: { amount: "2026-11-13" } },
      {
        id: "amount",
        dateFormat: { year: "numeric", month: "2-digit", day: "2-digit" },
      },
    ),
  ).toBe("11/13/2026");
});
it("bypasses every callback for omitted and status cells", () => {
  const callback = vi.fn(() => "bad");
  for (const result of [
    { ...summary, values: {} },
    { ...summary, state: "loading" } as const,
    { ...summary, state: "error" } as const,
    { ...summary, state: "unavailable" } as const,
  ])
    expect(format(result, { ...column, formatSummary: callback })).toBe("—");
  expect(callback).not.toHaveBeenCalled();
});

it("preserves schema summary formatting through presentation merging", () => {
  const formatSummary = () => "schema";
  const merged = mergeModelPresentationColumnsForTesting(
    [
      {
        id: "amount",
        accessor: (row: { id: string }) => row.id,
        value: (row: { id: string }) => row.id,
        formatSummary,
      },
    ],
    [{ id: "amount", header: "Amount" }],
  );
  expect(merged[0]?.formatSummary).toBe(formatSummary);
});
