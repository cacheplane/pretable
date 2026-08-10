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
});
