import { describe, expect, it } from "vitest";
import { SparseIndex } from "../sparse-index";

describe("SparseIndex", () => {
  it("represents 60,020 slots with two descriptors and no payload", () => {
    const index = new SparseIndex(20);
    index.resolve({
      id: "region",
      parent: null,
      ordinal: 3,
      childCount: 10000,
    });
    index.resolve({
      id: "customer",
      parent: "region",
      ordinal: 9000,
      childCount: 50000,
    });
    index.setExpanded("customer", true);
    expect(index.rowCount).toBe(20);
    index.setExpanded("region", true);
    expect(index.rowCount).toBe(60020);
    expect(index.at(59004)).toEqual({ parent: "customer", ordinal: 49999 });
    expect(index.rank("region", 9999)).toBe(60003);
    for (let n = 0; n < 20; n++) {
      index.setExpanded("region", false);
      expect(index.rowCount).toBe(20);
      expect(index.rank("customer", 0)).toBeUndefined();
      index.setExpanded("region", true);
      expect(index.rowCount).toBe(60020);
    }
    expect(index.allocatedNodes).toBe(3);
  });
  it("keeps allocation independent of logical leaf count and handles far flat seeks", () => {
    for (const count of [1000000, 100000000]) {
      const index = new SparseIndex(count);
      expect(index.at(count - 1)).toEqual({ parent: null, ordinal: count - 1 });
      expect(index.rank(null, count - 1)).toBe(count - 1);
      expect(index.allocatedNodes).toBe(1);
      expect(index.at(count)).toBeUndefined();
    }
  });
  it("bounds pending intent, topology and depth with atomic refusal", () => {
    const index = new SparseIndex(3, {
      maxNodes: 3,
      maxDepth: 2,
      maxExpanded: 2,
    });
    index.setExpanded("child", true);
    index.setExpanded("parent", true);
    expect(index.rowCount).toBe(3);
    index.resolve({ id: "parent", parent: null, ordinal: 0, childCount: 4 });
    index.resolve({ id: "child", parent: "parent", ordinal: 1, childCount: 5 });
    expect(index.rowCount).toBe(12);
    expect(() =>
      index.resolve({ id: "deep", parent: "child", ordinal: 0, childCount: 1 }),
    ).toThrow();
    expect(() => index.setExpanded("third", true)).toThrow();
    expect(() =>
      index.resolve({ id: "parent", parent: null, ordinal: 0, childCount: 1 }),
    ).toThrow();
    expect(index.rowCount).toBe(12);
    expect(index.allocatedNodes).toBe(3);
  });
  it("rejects unsafe counts and expanded extent overflow atomically", () => {
    expect(() => new SparseIndex(Number.MAX_SAFE_INTEGER + 1)).toThrow();
    const index = new SparseIndex(Number.MAX_SAFE_INTEGER);
    index.resolve({ id: "group", parent: null, ordinal: 0, childCount: 1 });
    expect(() => index.setExpanded("group", true)).toThrow();
    expect(index.rowCount).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("matches an independent eager oracle through seeded changes across disjoint branches", () => {
    const index = new SparseIndex(5);
    const groups = Array.from({ length: 5 }, (_, ordinal) => ({
      id: `g${ordinal}`,
      parent: null,
      ordinal,
      childCount: 4,
    }));
    const children = groups.flatMap((g) =>
      Array.from({ length: 4 }, (_, ordinal) => ({
        id: `${g.id}/${ordinal}`,
        parent: g.id,
        ordinal,
        childCount: 3,
      })),
    );
    const all = [...groups, ...children];
    all.forEach((g) => index.resolve(g));
    const open = new Set<string>();
    let seed = 812;
    for (let step = 0; step < 180; step++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const g = all[seed % all.length]!;
      if (open.has(g.id)) open.delete(g.id);
      else open.add(g.id);
      index.setExpanded(g.id, open.has(g.id));
      const eager: { parent: string | null; ordinal: number }[] = [];
      const visit = (parent: string | null, count: number) => {
        for (let ordinal = 0; ordinal < count; ordinal++) {
          eager.push({ parent, ordinal });
          const group = all.find(
            (g) => g.parent === parent && g.ordinal === ordinal,
          );
          if (group && open.has(group.id)) visit(group.id, group.childCount);
        }
      };
      visit(null, 5);
      expect(index.rowCount).toBe(eager.length);
      eager.forEach((address, rank) => {
        expect(index.at(rank)).toEqual(address);
        expect(index.rank(address.parent, address.ordinal)).toBe(rank);
      });
    }
  });
});

it("accepts refetched descriptors but refuses contradictory identities atomically", () => {
  const index = new SparseIndex(20);
  const group = { id: "g", parent: null, ordinal: 1, childCount: 3 };
  index.resolve(group);
  index.setExpanded("g", true);
  index.resolve({ ...group });
  expect(() => index.resolve({ ...group, ordinal: 2 })).toThrow();
  expect(() => index.resolve({ ...group, childCount: 4 })).toThrow();
  expect(index.rank("g", 0)).toBe(2);
  expect(index.rowCount).toBe(23);
});

it("enforces depth independently of topology cap and rejects unresolved ancestry", () => {
  const index = new SparseIndex(1, { maxNodes: 100, maxDepth: 1 });
  index.resolve({ id: "a", parent: null, ordinal: 0, childCount: 1 });
  expect(() =>
    index.resolve({ id: "b", parent: "a", ordinal: 0, childCount: 1 }),
  ).toThrow("Depth cap");
  expect(() =>
    index.resolve({ id: "c", parent: "missing", ordinal: 0, childCount: 1 }),
  ).toThrow("ancestor");
  expect(index.allocatedNodes).toBe(2);
  expect(index.rowCount).toBe(1);
});
