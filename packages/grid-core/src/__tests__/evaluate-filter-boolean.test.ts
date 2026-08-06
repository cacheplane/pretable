import { describe, expect, it } from "vitest";

import { evaluateFilter } from "../evaluate-filter";

describe("boolean filtering (enum semantics)", () => {
  it("matches boolean cells against string option values via isAnyOf", () => {
    expect(evaluateFilter(true, "boolean", "isAnyOf", ["true"])).toBe(true);
    expect(evaluateFilter(false, "boolean", "isAnyOf", ["true"])).toBe(false);
    expect(evaluateFilter(false, "boolean", "isNoneOf", ["true"])).toBe(true);
  });

  it("treats an empty selection as no constraint", () => {
    expect(evaluateFilter(true, "boolean", "isAnyOf", [])).toBe(true);
  });

  it("supports isEmpty/isNotEmpty", () => {
    expect(evaluateFilter(null, "boolean", "isEmpty", undefined)).toBe(true);
    expect(evaluateFilter(false, "boolean", "isNotEmpty", undefined)).toBe(
      true,
    );
  });
});

/**
 * Shared boolean-coercion case table. The twin lives in
 * `packages/react/src/__tests__/pretable-surface-boolean.test.tsx`, where the
 * same values are asserted against the checkbox's `aria-checked`. Display and
 * filtering coerce cells the same way — a cell holding `1` must both render
 * checked and match the "True" option — and the rule is deliberately
 * duplicated in both packages (grid-core must not depend on @pretable/react),
 * so these two tables must stay identical.
 */
const BOOL_CASES: { label: string; cell: unknown; bool: boolean }[] = [
  { label: "true", cell: true, bool: true },
  { label: '"true"', cell: "true", bool: true },
  { label: "1", cell: 1, bool: true },
  { label: '"1"', cell: "1", bool: true },
  { label: "false", cell: false, bool: false },
  { label: '"false"', cell: "false", bool: false },
  { label: "0", cell: 0, bool: false },
  { label: '"0"', cell: "0", bool: false },
  { label: "empty string", cell: "", bool: false },
  { label: "null", cell: null, bool: false },
  { label: "undefined", cell: undefined, bool: false },
  { label: "arbitrary truthy string", cell: "yes", bool: true },
  { label: "arbitrary object", cell: {}, bool: true },
];

describe("boolean filtering — value coercion (shared case table)", () => {
  for (const { label, cell, bool } of BOOL_CASES) {
    it(`${label} filters as ${bool}`, () => {
      const matching = String(bool);
      const other = String(!bool);
      expect(evaluateFilter(cell, "boolean", "isAnyOf", [matching])).toBe(true);
      expect(evaluateFilter(cell, "boolean", "isAnyOf", [other])).toBe(false);
      expect(evaluateFilter(cell, "boolean", "isNoneOf", [matching])).toBe(
        false,
      );
      expect(evaluateFilter(cell, "boolean", "isNoneOf", [other])).toBe(true);
      // Both options selected is the same as no constraint.
      expect(
        evaluateFilter(cell, "boolean", "isAnyOf", ["true", "false"]),
      ).toBe(true);
    });
  }

  it("still reads null/undefined as empty, not as false", () => {
    // Coercion happens in the type branch; the empty operators run before it.
    expect(evaluateFilter(null, "boolean", "isEmpty", undefined)).toBe(true);
    expect(evaluateFilter(undefined, "boolean", "isEmpty", undefined)).toBe(
      true,
    );
    expect(evaluateFilter(false, "boolean", "isEmpty", undefined)).toBe(false);
    expect(evaluateFilter(0, "boolean", "isEmpty", undefined)).toBe(false);
  });
});
