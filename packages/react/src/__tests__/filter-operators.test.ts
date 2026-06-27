// packages/react/src/__tests__/filter-operators.test.ts
import { describe, expect, it } from "vitest";
import {
  operatorsForType,
  operatorValueShape,
  isComplete,
  toColumnFilter,
  fromColumnFilter,
  OPERATOR_LABELS,
  type FilterDraft,
} from "../filter-menu/filter-operators";

describe("operatorsForType", () => {
  it("lists the operators for each type incl. shared empties", () => {
    expect(operatorsForType("text")).toEqual([
      "contains", "notContains", "equals", "notEquals",
      "startsWith", "endsWith", "isEmpty", "isNotEmpty",
    ]);
    expect(operatorsForType("number")).toEqual([
      "equals", "notEquals", "gt", "gte", "lt", "lte",
      "between", "isEmpty", "isNotEmpty",
    ]);
    expect(operatorsForType("date")).toEqual([
      "on", "before", "after", "dateBetween", "isEmpty", "isNotEmpty",
    ]);
    expect(operatorsForType("enum")).toEqual([
      "isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty",
    ]);
  });
  it("every operator has a label", () => {
    for (const t of ["text", "number", "date", "enum"] as const)
      for (const op of operatorsForType(t))
        expect(OPERATOR_LABELS[op]).toBeTruthy();
  });
});

describe("operatorValueShape", () => {
  it("classifies operators", () => {
    expect(operatorValueShape("contains")).toBe("single");
    expect(operatorValueShape("between")).toBe("range");
    expect(operatorValueShape("dateBetween")).toBe("range");
    expect(operatorValueShape("isAnyOf")).toBe("set");
    expect(operatorValueShape("isEmpty")).toBe("none");
    expect(operatorValueShape("isNotEmpty")).toBe("none");
  });
});

describe("isComplete + toColumnFilter (gating)", () => {
  it("text single value", () => {
    const d: FilterDraft = { operator: "contains", text: "ab" };
    expect(isComplete("text", d)).toBe(true);
    expect(toColumnFilter("text", d)).toEqual({ operator: "contains", value: "ab" });
    expect(isComplete("text", { operator: "contains", text: "" })).toBe(false);
    expect(toColumnFilter("text", { operator: "contains", text: "" })).toBeNull();
  });
  it("number single + parses", () => {
    expect(toColumnFilter("number", { operator: "gt", text: "5" }))
      .toEqual({ operator: "gt", value: 5 });
    expect(toColumnFilter("number", { operator: "gt", text: "x" })).toBeNull();
  });
  it("between needs both bounds", () => {
    expect(isComplete("number", { operator: "between", min: "1", max: "" })).toBe(false);
    expect(toColumnFilter("number", { operator: "between", min: "1", max: "" })).toBeNull();
    expect(toColumnFilter("number", { operator: "between", min: "1", max: "10" }))
      .toEqual({ operator: "between", value: [1, 10] });
  });
  it("dateBetween needs both ISO bounds", () => {
    expect(toColumnFilter("date", { operator: "dateBetween", min: "2026-01-01", max: "" })).toBeNull();
    expect(toColumnFilter("date", { operator: "dateBetween", min: "2026-01-01", max: "2026-02-01" }))
      .toEqual({ operator: "dateBetween", value: ["2026-01-01", "2026-02-01"] });
  });
  it("date single", () => {
    expect(toColumnFilter("date", { operator: "before", text: "2026-06-18" }))
      .toEqual({ operator: "before", value: "2026-06-18" });
  });
  it("enum set; empty selection is incomplete", () => {
    expect(isComplete("enum", { operator: "isAnyOf", selected: [] })).toBe(false);
    expect(toColumnFilter("enum", { operator: "isAnyOf", selected: [] })).toBeNull();
    expect(toColumnFilter("enum", { operator: "isAnyOf", selected: ["a", "b"] }))
      .toEqual({ operator: "isAnyOf", value: ["a", "b"] });
  });
  it("none-shape ops are always complete with no value", () => {
    expect(isComplete("text", { operator: "isEmpty" })).toBe(true);
    expect(toColumnFilter("text", { operator: "isEmpty" })).toEqual({ operator: "isEmpty" });
  });
});

describe("fromColumnFilter (hydrate)", () => {
  it("round-trips each shape", () => {
    expect(fromColumnFilter("text", { operator: "contains", value: "ab" }))
      .toEqual({ operator: "contains", text: "ab" });
    expect(fromColumnFilter("number", { operator: "between", value: [1, 10] }))
      .toEqual({ operator: "between", min: "1", max: "10" });
    expect(fromColumnFilter("enum", { operator: "isAnyOf", value: ["a"] }))
      .toEqual({ operator: "isAnyOf", selected: ["a"] });
    expect(fromColumnFilter("text", { operator: "isEmpty" }))
      .toEqual({ operator: "isEmpty" });
  });
  it("returns a default draft for null", () => {
    expect(fromColumnFilter("text", null)).toEqual({ operator: "contains", text: "" });
    expect(fromColumnFilter("enum", null)).toEqual({ operator: "isAnyOf", selected: [] });
  });
});
