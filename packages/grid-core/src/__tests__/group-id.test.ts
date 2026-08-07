import { describe, expect, test } from "vitest";

import {
  escapeGroupKey,
  makeGroupId,
  stringifyGroupValue,
  unescapeGroupKey,
} from "../group-id";

describe("escapeGroupKey", () => {
  test("leaves ordinary keys untouched", () => {
    expect(escapeGroupKey("Technology")).toBe("Technology");
  });

  test("escapes the three structural characters", () => {
    expect(escapeGroupKey("/")).toBe("%2F");
    expect(escapeGroupKey("=")).toBe("%3D");
    expect(escapeGroupKey("%")).toBe("%25");
  });

  test("escapes % before the separators so escapes cannot be forged", () => {
    // A raw key of "%2F" must NOT round-trip through as a literal slash.
    expect(escapeGroupKey("%2F")).toBe("%252F");
    expect(unescapeGroupKey(escapeGroupKey("%2F"))).toBe("%2F");
  });

  test.each([
    "plain",
    "a/b",
    "a=b",
    "100%",
    "a%2Fb",
    "=/%",
    "",
    "  spaced  ",
    "emoji 🚀 / = %",
  ])("round-trips %j", (raw) => {
    expect(unescapeGroupKey(escapeGroupKey(raw))).toBe(raw);
  });
});

describe("stringifyGroupValue", () => {
  test("is deterministic for the same input", () => {
    expect(stringifyGroupValue("a")).toBe(stringifyGroupValue("a"));
    expect(stringifyGroupValue(42)).toBe(stringifyGroupValue(42));
  });

  test("null and undefined share one key (a single blank group)", () => {
    expect(stringifyGroupValue(null)).toBe(stringifyGroupValue(undefined));
  });

  test("distinguishes values that stringify alike but differ in type", () => {
    const keys = [
      stringifyGroupValue(1),
      stringifyGroupValue("1"),
      stringifyGroupValue(true),
      stringifyGroupValue("true"),
      stringifyGroupValue(null),
      stringifyGroupValue("null"),
      stringifyGroupValue(""),
    ];

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("makeGroupId", () => {
  test("produces the documented shape", () => {
    expect(makeGroupId([{ columnId: "sector", value: "Tech" }])).toBe(
      "__group__:sector=s:Tech",
    );
  });

  test("joins multi-level paths outermost first", () => {
    const id = makeGroupId([
      { columnId: "sector", value: "Tech" },
      { columnId: "analyst", value: "Ada" },
    ]);

    expect(id).toBe("__group__:sector=s:Tech/analyst=s:Ada");
    expect(
      id.startsWith(makeGroupId([{ columnId: "sector", value: "Tech" }])),
    ).toBe(true);
  });

  test("escapes separators inside the column id as well as the key", () => {
    const id = makeGroupId([{ columnId: "a/b=c", value: "x/y=z" }]);

    expect(id).toBe("__group__:a%2Fb%3Dc=s:x%2Fy%3Dz");
  });

  test("two different paths never collide", () => {
    const paths: { columnId: string; value: unknown }[][] = [
      [{ columnId: "a", value: "b/c" }],
      [
        { columnId: "a", value: "b" },
        { columnId: "c", value: "d" },
      ],
      [{ columnId: "a", value: "b=c" }],
      [{ columnId: "a=b", value: "c" }],
      [{ columnId: "a", value: "b" }],
      [{ columnId: "a", value: 1 }],
      [{ columnId: "a", value: "1" }],
      [{ columnId: "a", value: null }],
      [{ columnId: "a", value: "" }],
      [
        { columnId: "a", value: "b" },
        { columnId: "c", value: "" },
      ],
      [{ columnId: "a", value: "b%2Fc" }],
      [{ columnId: "a%2Fb", value: "c" }],
      // The pairs that collide under a naive raw join: keys that spell out a
      // level boundary verbatim, tag and all. `a/c=s:d` matches the two-level
      // path above, and `a=s:b=s:c` is reachable from either side of the `=`.
      [{ columnId: "a", value: "b/c=s:d" }],
      [{ columnId: "a", value: "b=s:c" }],
      [{ columnId: "a=s:b", value: "c" }],
    ];

    const ids = paths.map((path) => makeGroupId(path));

    expect(new Set(ids).size).toBe(paths.length);
  });

  test("an empty path is the root id", () => {
    expect(makeGroupId([])).toBe("__group__:");
  });

  test("is stable across calls", () => {
    const path = [
      { columnId: "sector", value: "Tech" },
      { columnId: "qty", value: 100 },
    ];

    expect(makeGroupId(path)).toBe(makeGroupId([...path]));
  });
});
