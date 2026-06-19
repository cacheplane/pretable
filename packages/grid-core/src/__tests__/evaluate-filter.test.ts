import { describe, expect, it } from "vitest";
import { evaluateFilter, isFilterActive } from "../evaluate-filter";
import type { ColumnFilter } from "../types";

const ev = (
  cell: unknown,
  filterType: "text" | "number" | "date" | "enum",
  f: ColumnFilter,
) => evaluateFilter(cell, filterType, f.operator, f.value);

describe("evaluateFilter — text", () => {
  it("contains / notContains are case-insensitive", () => {
    expect(ev("Hello", "text", { operator: "contains", value: "ell" })).toBe(
      true,
    );
    expect(ev("Hello", "text", { operator: "contains", value: "ELL" })).toBe(
      true,
    );
    expect(ev("Hello", "text", { operator: "notContains", value: "xyz" })).toBe(
      true,
    );
    expect(ev("Hello", "text", { operator: "notContains", value: "ell" })).toBe(
      false,
    );
  });
  it("equals / notEquals / startsWith / endsWith", () => {
    expect(ev("abc", "text", { operator: "equals", value: "ABC" })).toBe(true);
    expect(ev("abc", "text", { operator: "notEquals", value: "abd" })).toBe(
      true,
    );
    expect(ev("abcdef", "text", { operator: "startsWith", value: "ABC" })).toBe(
      true,
    );
    expect(ev("abcdef", "text", { operator: "endsWith", value: "DEF" })).toBe(
      true,
    );
  });
});

describe("evaluateFilter — number", () => {
  it("comparisons", () => {
    expect(ev(5, "number", { operator: "gt", value: 4 })).toBe(true);
    expect(ev(5, "number", { operator: "gte", value: 5 })).toBe(true);
    expect(ev(5, "number", { operator: "lt", value: 4 })).toBe(false);
    expect(ev(5, "number", { operator: "lte", value: 5 })).toBe(true);
    expect(ev(5, "number", { operator: "equals", value: 5 })).toBe(true);
    expect(ev(5, "number", { operator: "notEquals", value: 6 })).toBe(true);
  });
  it("between is inclusive and tolerates reversed bounds", () => {
    expect(ev(5, "number", { operator: "between", value: [1, 10] })).toBe(true);
    expect(ev(5, "number", { operator: "between", value: [10, 1] })).toBe(true);
    expect(ev(11, "number", { operator: "between", value: [1, 10] })).toBe(
      false,
    );
  });
  it("non-numeric cell fails comparisons (but not isEmpty)", () => {
    expect(ev("oops", "number", { operator: "gt", value: 1 })).toBe(false);
    expect(ev(null, "number", { operator: "isEmpty" })).toBe(true);
  });
});

describe("evaluateFilter — enum", () => {
  it("isAnyOf / isNoneOf; empty selection = no constraint", () => {
    expect(ev("a", "enum", { operator: "isAnyOf", value: ["a", "b"] })).toBe(
      true,
    );
    expect(ev("c", "enum", { operator: "isAnyOf", value: ["a", "b"] })).toBe(
      false,
    );
    expect(ev("c", "enum", { operator: "isNoneOf", value: ["a", "b"] })).toBe(
      true,
    );
    expect(ev("a", "enum", { operator: "isAnyOf", value: [] })).toBe(true);
  });
});

describe("evaluateFilter — date", () => {
  it("on / before / after / dateBetween (inclusive)", () => {
    expect(
      ev("2026-06-18", "date", { operator: "on", value: "2026-06-18" }),
    ).toBe(true);
    expect(
      ev("2026-06-18", "date", { operator: "before", value: "2026-06-19" }),
    ).toBe(true);
    expect(
      ev("2026-06-18", "date", { operator: "after", value: "2026-06-17" }),
    ).toBe(true);
    expect(
      ev("2026-06-18", "date", {
        operator: "dateBetween",
        value: ["2026-06-01", "2026-06-30"],
      }),
    ).toBe(true);
    expect(
      ev("2026-07-01", "date", {
        operator: "dateBetween",
        value: ["2026-06-01", "2026-06-30"],
      }),
    ).toBe(false);
  });
  it("unparseable cell fails (but not isEmpty)", () => {
    expect(
      ev("not-a-date", "date", { operator: "before", value: "2026-06-19" }),
    ).toBe(false);
    expect(ev("", "date", { operator: "isEmpty" })).toBe(true);
  });
});

describe("evaluateFilter — shared empty semantics", () => {
  it("isEmpty / isNotEmpty across types", () => {
    expect(ev(null, "text", { operator: "isEmpty" })).toBe(true);
    expect(ev("", "text", { operator: "isEmpty" })).toBe(true);
    expect(ev("  ", "text", { operator: "isEmpty" })).toBe(true);
    expect(ev("x", "text", { operator: "isNotEmpty" })).toBe(true);
    expect(ev(undefined, "number", { operator: "isEmpty" })).toBe(true);
    expect(ev(Number.NaN, "number", { operator: "isEmpty" })).toBe(true);
  });
});

describe("isFilterActive", () => {
  it("blank values are inactive (no constraint)", () => {
    expect(isFilterActive({ operator: "contains", value: "" })).toBe(false);
    expect(isFilterActive({ operator: "isAnyOf", value: [] })).toBe(false);
    expect(isFilterActive({ operator: "gt", value: undefined })).toBe(false);
    expect(isFilterActive({ operator: "between", value: [1, 2] })).toBe(true);
    expect(isFilterActive({ operator: "isEmpty" })).toBe(true);
  });
});
