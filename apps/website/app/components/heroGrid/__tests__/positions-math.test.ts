import { describe, expect, it } from "vitest";
import { computeNav, withDerivedWeights } from "../positions-math";
import type { PositionRow } from "../types";

function row(p: Partial<PositionRow> & { id: string }): PositionRow {
  return {
    symbol: p.id,
    name: p.id,
    sector: "Technology",
    qty: 0,
    last: 0,
    mktValue: 0,
    dayPnl: 0,
    dayPnlPct: 0,
    weight: 0,
    analyst: "",
    flag: "hold",
    ...p,
  };
}

describe("positions-math", () => {
  it("computeNav sums market value", () => {
    expect(
      computeNav([
        row({ id: "A", mktValue: 30 }),
        row({ id: "B", mktValue: 10 }),
      ]),
    ).toBe(40);
  });
  it("withDerivedWeights sets each weight to mktValue / NAV percent", () => {
    const out = withDerivedWeights([
      row({ id: "A", mktValue: 30 }),
      row({ id: "B", mktValue: 10 }),
    ]);
    expect(out.find((r) => r.id === "A")!.weight).toBe(75);
    expect(out.find((r) => r.id === "B")!.weight).toBe(25);
  });
  it("withDerivedWeights returns 0 weights when NAV is 0", () => {
    const out = withDerivedWeights([row({ id: "A", mktValue: 0 })]);
    expect(out[0]!.weight).toBe(0);
  });
});
