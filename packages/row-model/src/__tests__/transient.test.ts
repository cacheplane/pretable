import { describe, expect, test } from "vitest";
import {
  createPersistentMap,
  createPersistentMapForTesting,
  getPersistentMapPathForTesting,
  getTransientMapPathForTesting,
} from "../persistent/persistent-map";

describe("TransientMap", () => {
  test("supports repeated edits and chainable mutation", () => {
    const draft = createPersistentMap<string, number>().asTransient();

    expect(draft.set("alpha", 1)).toBe(draft);
    expect(draft.set("alpha", 2)).toBe(draft);
    expect(draft.set("beta", 3)).toBe(draft);
    expect(draft.delete("alpha")).toBe(draft);
    expect(draft.set("alpha", 4)).toBe(draft);

    expect(draft.size).toBe(2);
    expect(draft.get("alpha")).toBe(4);
    expect(draft.has("beta")).toBe(true);
    expect(new Map(draft.entries())).toEqual(
      new Map([
        ["beta", 3],
        ["alpha", 4],
      ]),
    );
  });

  test("does not mutate the immutable source map", () => {
    const source = createPersistentMap<string, number>()
      .set("alpha", 1)
      .set("beta", 2);
    const draft = source.asTransient();

    draft.set("alpha", 10).delete("beta").set("gamma", 3);

    expect(new Map(source.entries())).toEqual(
      new Map([
        ["alpha", 1],
        ["beta", 2],
      ]),
    );
    expect(new Map(draft.entries())).toEqual(
      new Map([
        ["alpha", 10],
        ["gamma", 3],
      ]),
    );
  });

  test("copies an edited path once and retains unedited branches", () => {
    const hash = (key: string) => (key === "alpha" ? 0 : 1);
    const source = createPersistentMapForTesting<string, number>(hash)
      .set("alpha", 1)
      .set("beta", 2);
    const sourceAlphaPath = getPersistentMapPathForTesting(source, "alpha");
    const sourceBetaPath = getPersistentMapPathForTesting(source, "beta");
    const draft = source.asTransient();

    draft.set("alpha", 10);
    const firstAlphaPath = getTransientMapPathForTesting(draft, "alpha");
    const firstBetaPath = getTransientMapPathForTesting(draft, "beta");
    draft.set("alpha", 20);
    const secondAlphaPath = getTransientMapPathForTesting(draft, "alpha");
    const secondBetaPath = getTransientMapPathForTesting(draft, "beta");

    expect(firstAlphaPath[0]).not.toBe(sourceAlphaPath[0]);
    expect(firstAlphaPath.at(-1)).not.toBe(sourceAlphaPath.at(-1));
    expect(secondAlphaPath[0]).toBe(firstAlphaPath[0]);
    expect(secondAlphaPath.at(-1)).toBe(firstAlphaPath.at(-1));
    expect(firstBetaPath.at(-1)).toBe(sourceBetaPath.at(-1));
    expect(secondBetaPath.at(-1)).toBe(sourceBetaPath.at(-1));
  });

  test("isolates sibling transient edit tokens", () => {
    const source = createPersistentMap<string, number>()
      .set("alpha", 1)
      .set("beta", 2);
    const first = source.asTransient();
    const second = source.asTransient();

    const firstResult = first.set("alpha", 10).delete("beta").freeze();
    const secondResult = second.set("beta", 20).set("gamma", 3).freeze();

    expect(new Map(source.entries())).toEqual(
      new Map([
        ["alpha", 1],
        ["beta", 2],
      ]),
    );
    expect(new Map(firstResult.entries())).toEqual(new Map([["alpha", 10]]));
    expect(new Map(secondResult.entries())).toEqual(
      new Map([
        ["alpha", 1],
        ["beta", 20],
        ["gamma", 3],
      ]),
    );
  });

  test("collapses deepest leaf-only paths before freezing", () => {
    const hash = (key: string) => (key === "left" ? 0 : 0x40000000);
    const draft = createPersistentMapForTesting<string, number>(hash)
      .set("left", 1)
      .set("right", 2)
      .asTransient();

    draft.delete("left");

    expect(draft.get("right")).toBe(2);
    expect(getTransientMapPathForTesting(draft, "right")).toHaveLength(1);
    const frozen = draft.freeze();
    expect(frozen.get("right")).toBe(2);
    expect(getPersistentMapPathForTesting(frozen, "right")).toHaveLength(1);
  });

  test("freezes once and rejects later mutation without changing the result", () => {
    const draft = createPersistentMap<string, number>()
      .set("alpha", 1)
      .asTransient();
    draft.set("beta", 2);

    const frozen = draft.freeze();

    expect(draft.freeze()).toBe(frozen);
    expect(draft.get("alpha")).toBe(1);
    expect(new Map(draft.entries())).toEqual(
      new Map([
        ["alpha", 1],
        ["beta", 2],
      ]),
    );
    expect(() => draft.set("gamma", 3)).toThrow(/frozen/i);
    expect(() => draft.delete("alpha")).toThrow(/frozen/i);
    expect(new Map(frozen.entries())).toEqual(
      new Map([
        ["alpha", 1],
        ["beta", 2],
      ]),
    );
  });

  test("supports persistent and transient descendants of a frozen map", () => {
    const frozen = createPersistentMap<string, number>()
      .set("alpha", 1)
      .asTransient()
      .set("beta", 2)
      .freeze();

    const persistentDescendant = frozen.set("alpha", 10).set("gamma", 3);
    const transientDescendant = frozen
      .asTransient()
      .delete("beta")
      .set("delta", 4)
      .freeze();

    expect(new Map(frozen.entries())).toEqual(
      new Map([
        ["alpha", 1],
        ["beta", 2],
      ]),
    );
    expect(new Map(persistentDescendant.entries())).toEqual(
      new Map([
        ["alpha", 10],
        ["beta", 2],
        ["gamma", 3],
      ]),
    );
    expect(new Map(transientDescendant.entries())).toEqual(
      new Map([
        ["alpha", 1],
        ["delta", 4],
      ]),
    );
  });
});
