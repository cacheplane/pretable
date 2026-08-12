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

  test("handles signed bitmap slot 31 alongside other slots", () => {
    const hashes: Record<string, number> = {
      zero: 0,
      thirty: 30,
      thirtyOne: 31,
      nextFragment: 32,
    };
    const map = createPersistentMapForTesting<string, number>(
      (key) => hashes[key]!,
    )
      .set("zero", 0)
      .set("thirty", 30)
      .set("thirtyOne", 31)
      .set("nextFragment", 32)
      .delete("thirty");

    expect(map.size).toBe(3);
    expect(map.get("zero")).toBe(0);
    expect(map.has("thirty")).toBe(false);
    expect(map.get("thirtyOne")).toBe(31);
    expect(map.get("nextFragment")).toBe(32);
  });

  test("hides backing state from runtime property mutation", () => {
    const map = createPersistentMap<string, number>()
      .set("alpha", 1)
      .set("beta", 2);

    expect(Object.keys(map)).toEqual([]);
    expect(Reflect.get(map, "root")).toBeUndefined();
    expect(Reflect.get(map, "hash")).toBeUndefined();

    const attacked = map as unknown as Record<string, unknown>;
    attacked.root = null;
    attacked.hash = () => 0;
    expect(() => {
      attacked.size = 0;
    }).toThrow(TypeError);

    expect(map.size).toBe(2);
    expect(map.get("alpha")).toBe(1);
    expect(map.get("beta")).toBe(2);
    expect(getPersistentMapPathForTesting(map, "alpha").length).toBeGreaterThan(
      0,
    );
  });

  test("collapses deepest leaf-only paths after persistent deletion", () => {
    const hash = (key: string) => (key === "left" ? 0 : 0x40000000);
    const original = createPersistentMapForTesting<string, number>(hash)
      .set("left", 1)
      .set("right", 2);

    expect(getPersistentMapPathForTesting(original, "left")).toHaveLength(8);
    expect(getPersistentMapPathForTesting(original, "right")).toHaveLength(8);

    const onlyRight = original.delete("left");
    const onlyLeft = original.delete("right");

    expect(onlyRight.get("right")).toBe(2);
    expect(getPersistentMapPathForTesting(onlyRight, "right")).toHaveLength(1);
    expect(onlyLeft.get("left")).toBe(1);
    expect(getPersistentMapPathForTesting(onlyLeft, "left")).toHaveLength(1);
  });

  test("retains a unary bitmap whose child remains shift-dependent", () => {
    const hashes: Record<string, number> = {
      innerLeft: 0,
      innerRight: 32,
      outer: 1,
    };
    const map = createPersistentMapForTesting<string, number>(
      (key) => hashes[key]!,
    )
      .set("innerLeft", 1)
      .set("innerRight", 2)
      .set("outer", 3)
      .delete("outer");

    expect(map.get("innerLeft")).toBe(1);
    expect(map.get("innerRight")).toBe(2);
    expect(getPersistentMapPathForTesting(map, "innerLeft")).toHaveLength(3);
    expect(getPersistentMapPathForTesting(map, "innerRight")).toHaveLength(3);
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

  test("matches a native Map across a seeded operation sequence", () => {
    let randomState = 0x6d2b79f5;
    const random = () => {
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      return randomState;
    };
    let map = createPersistentMap<number, number>();
    const oracle = new Map<number, number>();

    for (let index = 0; index < 2_000; index += 1) {
      const key = random() % 257;
      if ((random() & 3) === 0) {
        map = map.delete(key);
        oracle.delete(key);
      } else {
        const value = random();
        map = map.set(key, value);
        oracle.set(key, value);
      }
      expect(map.size).toBe(oracle.size);
    }

    const byKey = (
      left: readonly [number, number],
      right: readonly [number, number],
    ) => left[0] - right[0];
    expect([...map.entries()].sort(byKey)).toEqual(
      [...oracle.entries()].sort(byKey),
    );
  });
});
