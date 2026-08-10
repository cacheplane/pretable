import { describe, expect, test } from "vitest";
import {
  createPersistentMap,
  createPersistentMapForTesting,
  getPersistentMapPathForTesting,
} from "../persistent/persistent-map";

describe("PersistentMap", () => {
  test("starts empty", () => {
    const map = createPersistentMap<string, number>();

    expect(map.size).toBe(0);
    expect(map.get("missing")).toBeUndefined();
    expect(map.has("missing")).toBe(false);
    expect([...map.entries()]).toEqual([]);
  });

  test("sets, replaces, deletes, and iterates entries", () => {
    const first = createPersistentMap<string, number>()
      .set("alpha", 1)
      .set("beta", 2);
    const replaced = first.set("alpha", 3);
    const deleted = replaced.delete("beta");

    expect(first.size).toBe(2);
    expect(first.get("alpha")).toBe(1);
    expect(replaced.size).toBe(2);
    expect(replaced.get("alpha")).toBe(3);
    expect(deleted.size).toBe(1);
    expect(deleted.has("beta")).toBe(false);
    expect(new Map(deleted.entries())).toEqual(new Map([["alpha", 3]]));
  });

  test("distinguishes string and number keys", () => {
    const map = createPersistentMap<string | number, string>()
      .set("1", "string")
      .set(1, "number");

    expect(map.size).toBe(2);
    expect(map.get("1")).toBe("string");
    expect(map.get(1)).toBe("number");
  });

  test("handles keys with forced hash collisions", () => {
    const map = createPersistentMapForTesting<string, number>(() => 7)
      .set("alpha", 1)
      .set("beta", 2)
      .set("gamma", 3)
      .delete("beta");

    expect(map.size).toBe(2);
    expect(map.get("alpha")).toBe(1);
    expect(map.has("beta")).toBe(false);
    expect(map.get("gamma")).toBe(3);
    expect(new Map(map.entries())).toEqual(
      new Map([
        ["alpha", 1],
        ["gamma", 3],
      ]),
    );
  });

  test("indexes the highest bitmap slot correctly", () => {
    const map = createPersistentMapForTesting<string, number>((key) =>
      key === "high" ? 31 : 0,
    )
      .set("high", 31)
      .set("low", 0);

    expect(map.get("high")).toBe(31);
    expect(map.get("low")).toBe(0);
  });

  test("returns the same map for semantic no-ops", () => {
    const value = { count: 1 };
    const map = createPersistentMap<string, typeof value>().set("alpha", value);

    expect(map.set("alpha", value)).toBe(map);
    expect(map.delete("missing")).toBe(map);
  });

  test("keeps old roots immutable", () => {
    const original = createPersistentMap<string, number>()
      .set("alpha", 1)
      .set("beta", 2);
    const updated = original.set("alpha", 10).delete("beta").set("gamma", 3);

    expect(new Map(original.entries())).toEqual(
      new Map([
        ["alpha", 1],
        ["beta", 2],
      ]),
    );
    expect(new Map(updated.entries())).toEqual(
      new Map([
        ["alpha", 10],
        ["gamma", 3],
      ]),
    );
  });

  test("copies only the changed hash path", () => {
    const hash = (key: string) => ({ alpha: 0, beta: 1 })[key] ?? 2;
    const original = createPersistentMapForTesting<string, number>(hash)
      .set("alpha", 1)
      .set("beta", 2);
    const updated = original.set("alpha", 10);

    const originalAlphaPath = getPersistentMapPathForTesting(original, "alpha");
    const updatedAlphaPath = getPersistentMapPathForTesting(updated, "alpha");
    const originalBetaPath = getPersistentMapPathForTesting(original, "beta");
    const updatedBetaPath = getPersistentMapPathForTesting(updated, "beta");

    expect(updatedAlphaPath[0]).not.toBe(originalAlphaPath[0]);
    expect(updatedAlphaPath.at(-1)).not.toBe(originalAlphaPath.at(-1));
    expect(updatedBetaPath[0]).not.toBe(originalBetaPath[0]);
    expect(updatedBetaPath.at(-1)).toBe(originalBetaPath.at(-1));
  });
});
