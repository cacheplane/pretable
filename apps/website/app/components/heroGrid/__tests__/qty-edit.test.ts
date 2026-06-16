import { describe, expect, it } from "vitest";
import { parseQty, sanityCheckQty, breachesGuardrail, isDeskRejected, GUARDRAIL_PCT } from "../qty-edit";

describe("qty-edit", () => {
  it("parseQty strips commas/spaces to an integer", () => {
    expect(parseQty("12,500")).toBe(12500);
    expect(parseQty(" 4200 ")).toBe(4200);
  });
  it("parseQty returns NaN for non-integers", () => {
    expect(Number.isNaN(parseQty("12.5"))).toBe(true);
    expect(Number.isNaN(parseQty("abc"))).toBe(true);
  });
  it("sanityCheckQty rejects non-positive and >10x current", () => {
    expect(sanityCheckQty(0, 100)).toMatch(/whole number/i);
    expect(sanityCheckQty(-5, 100)).toMatch(/whole number/i);
    expect(sanityCheckQty(1001, 100)).toMatch(/10×/);
    expect(sanityCheckQty(900, 100)).toBe(true);
  });
  it("breachesGuardrail compares the new single-name weight against NAV", () => {
    expect(breachesGuardrail({ newMktValue: 50, otherMktValue: 100 })).toBe(true);
    expect(breachesGuardrail({ newMktValue: 5, otherMktValue: 200 })).toBe(false);
    expect(GUARDRAIL_PCT).toBe(7);
  });
  it("isDeskRejected is deterministic per symbol+qty", () => {
    const a = isDeskRejected("NVDA", 14000);
    expect(isDeskRejected("NVDA", 14000)).toBe(a);
    expect(typeof a).toBe("boolean");
  });
});
