import { describe, expect, it } from "vitest";
import { fmtPrice, fmtSignedUsd, fmtPct, fmtCompactUsd } from "../format";

describe("format helpers", () => {
  it("formats price with two decimals", () => {
    expect(fmtPrice(874.2)).toBe("874.20");
  });
  it("formats signed USD with sign and thousands", () => {
    expect(fmtSignedUsd(148500)).toBe("+$148,500");
    expect(fmtSignedUsd(-22400)).toBe("−$22,400");
    expect(fmtSignedUsd(0)).toBe("$0");
  });
  it("formats signed percent", () => {
    expect(fmtPct(1.38)).toBe("+1.38%");
    expect(fmtPct(-2.0)).toBe("−2.00%");
  });
  it("formats compact USD for large values", () => {
    expect(fmtCompactUsd(10_900_000)).toBe("$10.9M");
    expect(fmtCompactUsd(1_120_000)).toBe("$1.1M");
    expect(fmtCompactUsd(48_240_000)).toBe("$48.2M");
  });
});
