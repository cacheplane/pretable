import { describe, expect, it } from "vitest";

import {
  resolveToolPanelRoster,
  type ToolPanelRosterEntry,
} from "../tool-panel/roster";
import type { ToolPanelSectionDescriptor } from "../tool-panel/sections";

const section = (id: string): ToolPanelSectionDescriptor => ({
  id,
  icon: (() => null) as never,
  label: id,
  render: () => null,
});

const BUILTINS: readonly ToolPanelSectionDescriptor[] = [
  section("columns"),
  section("filters"),
  section("grouping"),
];

describe("resolveToolPanelRoster", () => {
  it("resolves an absent roster to the built-ins as the SAME array", () => {
    // Identity, not equality: the surface's descriptor-stability pin watches
    // the array's identity, so the default path must not allocate.
    expect(resolveToolPanelRoster(undefined, BUILTINS)).toBe(BUILTINS);
  });

  it("treats the roster as the COMPLETE rail: subset, reorder, interleave", () => {
    const mine = section("mine");
    const out = resolveToolPanelRoster(["grouping", mine, "columns"], BUILTINS);
    expect(out.map((s) => s.id)).toEqual(["grouping", "mine", "columns"]);
    expect(out[1]).toBe(mine); // descriptor passed through, not copied
    expect(out[0]).toBe(BUILTINS[2]); // built-in resolved to the real descriptor
    expect(out[2]).toBe(BUILTINS[0]);
  });

  it("accepts an empty roster and resolves it empty", () => {
    expect(resolveToolPanelRoster([], BUILTINS)).toEqual([]);
  });

  it.each<readonly [readonly ToolPanelRosterEntry[], RegExp]>([
    [["columns", section("columns")], /duplicate|built-in.*"columns"/i],
    [[section("a"), section("a")], /duplicate.*"a"/i],
    [[section("")], /empty/i],
    [[section("has space")], /"has space".*whitespace/i],
  ])(
    "throws on an invalid roster, naming the offending id",
    (entries, message) => {
      expect(() => resolveToolPanelRoster(entries, BUILTINS)).toThrow(message);
    },
  );

  it("throws on a duplicate built-in reference", () => {
    expect(() =>
      resolveToolPanelRoster(["columns", "columns"], BUILTINS),
    ).toThrow(/duplicate/i);
  });

  it("refuses a custom descriptor reusing a built-in id, saying replacement is not supported", () => {
    // Spec decision 4: replacing a built-in is a real feature someday, but
    // today it is a collision — and the message must say so, not leave it
    // ambiguous.
    expect(() =>
      resolveToolPanelRoster([section("filters")], BUILTINS),
    ).toThrow(/replac/i);
    expect(() =>
      resolveToolPanelRoster([section("filters")], BUILTINS),
    ).toThrow(/"filters"/);
  });

  it("throws on an unknown built-in reference", () => {
    expect(() => resolveToolPanelRoster(["totals" as never], BUILTINS)).toThrow(
      /"totals".*not a built-in/i,
    );
  });
});
