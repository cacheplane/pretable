// packages/react/src/__tests__/filter-operators.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  menuOperators,
  operatorsForType,
  operatorValueShape,
  isComplete,
  toColumnFilter,
  fromColumnFilter,
  OPERATOR_LABELS,
  resolveColumnOptions,
  type FilterDraft,
} from "../filter-menu/filter-operators";
import { resetDevWarnings } from "../dev-warn";

// The emitted-key set is module state: without this, the second test to assert
// a given warning sees nothing.
afterEach(() => {
  resetDevWarnings();
});

describe("operatorsForType", () => {
  it("lists the operators for each type incl. shared empties", () => {
    expect(operatorsForType("text")).toEqual([
      "contains",
      "notContains",
      "equals",
      "notEquals",
      "startsWith",
      "endsWith",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(operatorsForType("number")).toEqual([
      "equals",
      "notEquals",
      "gt",
      "gte",
      "lt",
      "lte",
      "between",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(operatorsForType("date")).toEqual([
      "on",
      "before",
      "after",
      "dateBetween",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(operatorsForType("enum")).toEqual([
      "isAnyOf",
      "isNoneOf",
      "isEmpty",
      "isNotEmpty",
    ]);
  });
  it("every operator has a label", () => {
    for (const t of ["text", "number", "date", "enum"] as const)
      for (const op of operatorsForType(t))
        expect(OPERATOR_LABELS[op]).toBeTruthy();
  });

  it("prunes to the declared allow-list, in the per-type order", () => {
    expect(operatorsForType("text", ["equals", "contains"])).toEqual([
      "contains",
      "equals",
    ]);
  });

  it("drops isEmpty/isNotEmpty when they are not allowed", () => {
    expect(operatorsForType("enum", ["isAnyOf", "isNoneOf"])).toEqual([
      "isAnyOf",
      "isNoneOf",
    ]);
  });

  it("falls back to the full set and warns when the allow-list matches nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(operatorsForType("number", ["isAnyOf"])).toEqual([
      "equals",
      "notEquals",
      "gt",
      "gte",
      "lt",
      "lte",
      "between",
      "isEmpty",
      "isNotEmpty",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe("menuOperators", () => {
  it("returns the permitted set when it already holds the applied operator", () => {
    expect(
      menuOperators("text", "contains", ["contains", "startsWith"]),
    ).toEqual(["contains", "startsWith"]);
  });

  it("keeps an applied operator the allow-list excludes, in the per-type order", () => {
    expect(
      menuOperators("text", "isEmpty", ["startsWith", "contains"]),
    ).toEqual(["contains", "startsWith", "isEmpty"]);
  });

  it("appends an applied operator the column type does not offer", () => {
    expect(menuOperators("text", "gt", ["contains"])).toEqual([
      "contains",
      "gt",
    ]);
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
    expect(toColumnFilter("text", d)).toEqual({
      operator: "contains",
      value: "ab",
    });
    expect(isComplete("text", { operator: "contains", text: "" })).toBe(false);
    expect(
      toColumnFilter("text", { operator: "contains", text: "" }),
    ).toBeNull();
  });
  it("number single + parses", () => {
    expect(toColumnFilter("number", { operator: "gt", text: "5" })).toEqual({
      operator: "gt",
      value: 5,
    });
    expect(toColumnFilter("number", { operator: "gt", text: "x" })).toBeNull();
  });
  it("between needs both bounds", () => {
    expect(
      isComplete("number", { operator: "between", min: "1", max: "" }),
    ).toBe(false);
    expect(
      toColumnFilter("number", { operator: "between", min: "1", max: "" }),
    ).toBeNull();
    expect(
      toColumnFilter("number", { operator: "between", min: "1", max: "10" }),
    ).toEqual({ operator: "between", value: [1, 10] });
  });
  it("dateBetween needs both ISO bounds", () => {
    expect(
      toColumnFilter("date", {
        operator: "dateBetween",
        min: "2026-01-01",
        max: "",
      }),
    ).toBeNull();
    expect(
      toColumnFilter("date", {
        operator: "dateBetween",
        min: "2026-01-01",
        max: "2026-02-01",
      }),
    ).toEqual({ operator: "dateBetween", value: ["2026-01-01", "2026-02-01"] });
    for (const [min, max] of [
      ["2026-1-01", "2026-02-01"],
      ["2026-01-01", "2026-02-30"],
      [" 2026-01-01", "2026-02-01"],
      ["2026-01-01T00:00:00Z", "2026-02-01"],
    ]) {
      expect(
        toColumnFilter("date", { operator: "dateBetween", min, max }),
      ).toBeNull();
    }
  });
  it("date single", () => {
    expect(
      toColumnFilter("date", { operator: "before", text: "2026-06-18" }),
    ).toEqual({ operator: "before", value: "2026-06-18" });
    for (const text of [
      "",
      "2026-6-18",
      "2026-02-30",
      " 2026-06-18",
      "2026-06-18 ",
      "2026-06-18T00:00:00Z",
    ]) {
      expect(toColumnFilter("date", { operator: "before", text })).toBeNull();
    }
  });
  it("enum set; empty selection is incomplete", () => {
    expect(isComplete("enum", { operator: "isAnyOf", selected: [] })).toBe(
      false,
    );
    expect(
      toColumnFilter("enum", { operator: "isAnyOf", selected: [] }),
    ).toBeNull();
    expect(
      toColumnFilter("enum", { operator: "isAnyOf", selected: ["a", "b"] }),
    ).toEqual({ operator: "isAnyOf", value: ["a", "b"] });
  });
  it("none-shape ops are always complete with no value", () => {
    expect(isComplete("text", { operator: "isEmpty" })).toBe(true);
    expect(toColumnFilter("text", { operator: "isEmpty" })).toEqual({
      operator: "isEmpty",
    });
  });
});

describe("fromColumnFilter (hydrate)", () => {
  it("round-trips each shape", () => {
    expect(
      fromColumnFilter("text", { operator: "contains", value: "ab" }),
    ).toEqual({ operator: "contains", text: "ab" });
    expect(
      fromColumnFilter("number", { operator: "between", value: [1, 10] }),
    ).toEqual({ operator: "between", min: "1", max: "10" });
    expect(
      fromColumnFilter("enum", { operator: "isAnyOf", value: ["a"] }),
    ).toEqual({ operator: "isAnyOf", selected: ["a"] });
    expect(fromColumnFilter("text", { operator: "isEmpty" })).toEqual({
      operator: "isEmpty",
    });
  });
  it("returns a default draft for null", () => {
    expect(fromColumnFilter("text", null)).toEqual({
      operator: "contains",
      text: "",
    });
    expect(fromColumnFilter("enum", null)).toEqual({
      operator: "isAnyOf",
      selected: [],
    });
  });

  it("seeds the null draft from the allow-list", () => {
    expect(fromColumnFilter("text", null, ["startsWith"])).toEqual({
      operator: "startsWith",
      text: "",
    });
  });

  it("keeps an applied operator the allow-list excludes", () => {
    // Rewriting it here would leave the draft naming one operator while the
    // engine filters by another; `menuOperators` widens the select instead.
    expect(
      fromColumnFilter("text", { operator: "isEmpty" }, ["contains"]),
    ).toEqual({ operator: "isEmpty" });
  });
});

describe("boolean menu mapping", () => {
  it("boolean columns get enum operators", () => {
    expect(operatorsForType("boolean")).toEqual([
      "isAnyOf",
      "isNoneOf",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  it("boolean columns get implicit True/False options", () => {
    expect(
      resolveColumnOptions({ id: "flag", type: "boolean" }, () => ["x"]),
    ).toEqual([
      { value: "true", label: "True" },
      { value: "false", label: "False" },
    ]);
  });

  it("enum columns prefer declared options, else distinct values", () => {
    expect(
      resolveColumnOptions(
        { id: "status", type: "enum", options: [{ value: "a" }] },
        () => ["b"],
      ),
    ).toEqual([{ value: "a" }]);
    expect(
      resolveColumnOptions({ id: "status", type: "enum" }, () => ["b"]),
    ).toEqual([{ value: "b" }]);
  });
});

describe("resolveColumnOptions refinements", () => {
  it("lets a boolean column override the implicit labels", () => {
    expect(
      resolveColumnOptions(
        {
          id: "flag",
          type: "boolean",
          options: [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ],
        },
        () => [],
      ),
    ).toEqual([
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ]);
  });

  it("skips the distinct-value scan for types without a checklist", () => {
    const distinct = vi.fn(() => ["a", "b"]);
    expect(
      resolveColumnOptions({ id: "note", type: "text" }, distinct),
    ).toEqual([]);
    expect(
      resolveColumnOptions({ id: "qty", type: "number" }, distinct),
    ).toEqual([]);
    expect(distinct).not.toHaveBeenCalled();
  });
});

describe("resolveColumnOptions under external filter authority", () => {
  it("warns once that the offered universe is only the loaded window", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const enumColumn = { id: "status", type: "enum" } as const;

    expect(
      resolveColumnOptions(enumColumn, () => ["open"], { filter: "external" }),
    ).toEqual([{ value: "open" }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('Column "status"');

    resolveColumnOptions(enumColumn, () => ["open"], { filter: "external" });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("stays quiet when the column declares the universe itself", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveColumnOptions(
      { id: "status", type: "enum", options: [{ value: "open" }] },
      () => ["open"],
      { filter: "external" },
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("stays quiet when the engine owns filtering", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveColumnOptions({ id: "status", type: "enum" }, () => ["open"], {
      filter: "engine",
    });
    resolveColumnOptions({ id: "status", type: "enum" }, () => ["open"]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
