import { describe, expect, it } from "vitest";
import {
  cloneDenseMembership,
  clearDenseBit,
  createDenseMembership,
  setDenseBit,
  testDenseBit,
} from "../dense-membership";

describe("dense membership bitset", () => {
  it("round-trips set/clear/test across word boundaries", () => {
    const bits = createDenseMembership(100);
    for (const slot of [0, 31, 32, 63, 64, 99]) {
      expect(testDenseBit(bits, slot)).toBe(false);
      setDenseBit(bits, slot);
      expect(testDenseBit(bits, slot)).toBe(true);
    }
    clearDenseBit(bits, 32);
    expect(testDenseBit(bits, 32)).toBe(false);
    expect(testDenseBit(bits, 31)).toBe(true);
    expect(testDenseBit(bits, 63)).toBe(true);
  });

  it("clone is independent of the original", () => {
    const bits = createDenseMembership(64);
    setDenseBit(bits, 10);
    const copy = cloneDenseMembership(bits, 64);
    clearDenseBit(copy, 10);
    setDenseBit(copy, 20);
    expect(testDenseBit(bits, 10)).toBe(true);
    expect(testDenseBit(bits, 20)).toBe(false);
  });

  it("clone can grow capacity, preserving low bits", () => {
    const bits = createDenseMembership(32);
    setDenseBit(bits, 31);
    const grown = cloneDenseMembership(bits, 200);
    expect(testDenseBit(grown, 31)).toBe(true);
    setDenseBit(grown, 199);
    expect(testDenseBit(grown, 199)).toBe(true);
  });

  it("reads beyond a bitset's words answer false", () => {
    const bits = createDenseMembership(32);
    expect(testDenseBit(bits, 500)).toBe(false);
    expect(testDenseBit(createDenseMembership(0), 12345)).toBe(false);
  });
});
