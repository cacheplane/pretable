import { describe, expect, test } from "vitest";

import {
  DEFAULT_GROUP_EXPANSION_OVERRIDE_LIMIT,
  addGroupExpansionOverride,
  resolveGroupExpansionOverrideLimit,
} from "../index";

describe("resolveGroupExpansionOverrideLimit", () => {
  test("undefined takes the default", () => {
    expect(resolveGroupExpansionOverrideLimit(undefined)).toBe(
      DEFAULT_GROUP_EXPANSION_OVERRIDE_LIMIT,
    );
    expect(DEFAULT_GROUP_EXPANSION_OVERRIDE_LIMIT).toBe(10_000);
  });

  test("Infinity is honored — the documented opt-out", () => {
    expect(resolveGroupExpansionOverrideLimit(Number.POSITIVE_INFINITY)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  test("NaN and -Infinity fall back to the default", () => {
    expect(resolveGroupExpansionOverrideLimit(Number.NaN)).toBe(
      DEFAULT_GROUP_EXPANSION_OVERRIDE_LIMIT,
    );
    expect(resolveGroupExpansionOverrideLimit(Number.NEGATIVE_INFINITY)).toBe(
      DEFAULT_GROUP_EXPANSION_OVERRIDE_LIMIT,
    );
  });

  test("0 and negatives clamp to 1, so a decision is always retained", () => {
    expect(resolveGroupExpansionOverrideLimit(0)).toBe(1);
    expect(resolveGroupExpansionOverrideLimit(-5)).toBe(1);
  });

  test("fractions floor", () => {
    expect(resolveGroupExpansionOverrideLimit(3.9)).toBe(3);
    // …but never below 1.
    expect(resolveGroupExpansionOverrideLimit(0.5)).toBe(1);
  });
});

describe("addGroupExpansionOverride", () => {
  test("returns a new set — engine state is replaced, never mutated", () => {
    const current: ReadonlySet<string> = new Set(["a"]);

    const next = addGroupExpansionOverride(current, "b", 10);

    expect(next).not.toBe(current);
    expect([...current]).toEqual(["a"]);
    expect([...next]).toEqual(["a", "b"]);
  });

  test("at exactly the limit nothing is evicted", () => {
    let set: ReadonlySet<string> = new Set<string>();
    for (const id of ["a", "b", "c"]) {
      set = addGroupExpansionOverride(set, id, 3);
    }

    expect([...set]).toEqual(["a", "b", "c"]);
  });

  test("the boundary: the (limit + 1)th decision evicts exactly the oldest", () => {
    let set: ReadonlySet<string> = new Set<string>();
    for (const id of ["a", "b", "c"]) {
      set = addGroupExpansionOverride(set, id, 3);
    }

    set = addGroupExpansionOverride(set, "d", 3);

    expect([...set]).toEqual(["b", "c", "d"]);
    expect(set.has("a")).toBe(false);
  });

  test("re-adding a present id refreshes its recency instead of duplicating", () => {
    let set: ReadonlySet<string> = new Set(["a", "b", "c"]);

    set = addGroupExpansionOverride(set, "a", 3);
    expect([...set]).toEqual(["b", "c", "a"]);

    // "b" is now the oldest, so it is what the next decision pushes out.
    set = addGroupExpansionOverride(set, "d", 3);
    expect([...set]).toEqual(["c", "a", "d"]);
  });

  test("an over-full set converges in one call, not one eviction per call", () => {
    const oversized = new Set(["a", "b", "c", "d", "e"]);

    const next = addGroupExpansionOverride(oversized, "f", 2);

    expect([...next]).toEqual(["e", "f"]);
  });

  test("a limit of 1 keeps only the newest decision", () => {
    let set: ReadonlySet<string> = new Set<string>();
    set = addGroupExpansionOverride(set, "a", 1);
    set = addGroupExpansionOverride(set, "b", 1);

    expect([...set]).toEqual(["b"]);
  });

  test("Infinity retains everything", () => {
    let set: ReadonlySet<string> = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      set = addGroupExpansionOverride(set, `g${i}`, Number.POSITIVE_INFINITY);
    }

    expect(set.size).toBe(1000);
  });
});
