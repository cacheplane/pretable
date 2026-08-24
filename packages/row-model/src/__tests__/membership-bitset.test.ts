import { describe, expect, it } from "vitest";
import {
  EMPTY_MEMBERSHIP,
  cloneMembership,
  createMembership,
  clearMembershipBit,
  setMembershipBit,
  testMembershipBit,
} from "../membership-bitset";

describe("membership bitset", () => {
  it("round-trips set/clear/test across word boundaries", () => {
    const bits = createMembership(100);
    for (const slot of [0, 31, 32, 63, 64, 99]) {
      expect(testMembershipBit(bits, slot)).toBe(false);
      setMembershipBit(bits, slot);
      expect(testMembershipBit(bits, slot)).toBe(true);
    }
    clearMembershipBit(bits, 32);
    expect(testMembershipBit(bits, 32)).toBe(false);
    expect(testMembershipBit(bits, 31)).toBe(true);
    expect(testMembershipBit(bits, 63)).toBe(true);
  });

  it("clone is independent of the original", () => {
    const bits = createMembership(64);
    setMembershipBit(bits, 10);
    const copy = cloneMembership(bits, 64);
    clearMembershipBit(copy, 10);
    setMembershipBit(copy, 20);
    expect(testMembershipBit(bits, 10)).toBe(true);
    expect(testMembershipBit(bits, 20)).toBe(false);
  });

  it("clone can grow capacity, preserving low bits", () => {
    const bits = createMembership(32);
    setMembershipBit(bits, 31);
    const grown = cloneMembership(bits, 200);
    expect(testMembershipBit(grown, 31)).toBe(true);
    setMembershipBit(grown, 199);
    expect(testMembershipBit(grown, 199)).toBe(true);
  });

  it("reads beyond a bitset's words answer false (EMPTY sentinel contract)", () => {
    expect(testMembershipBit(EMPTY_MEMBERSHIP, 0)).toBe(false);
    expect(testMembershipBit(EMPTY_MEMBERSHIP, 12345)).toBe(false);
    const bits = createMembership(32);
    expect(testMembershipBit(bits, 500)).toBe(false);
  });
});
