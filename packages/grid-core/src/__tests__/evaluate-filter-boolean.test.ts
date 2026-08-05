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
