import { describe, expect, it } from "vitest";

import {
  columnHasFilter,
  topLevelColumnFilter,
  withTopLevelColumnFilter,
  type SurfaceFilterNode,
} from "../filter-tree";

describe("columnHasFilter", () => {
  it("finds a top-level leaf", () => {
    const filters: readonly SurfaceFilterNode[] = [
      { columnId: "a", operator: "contains", value: "x" },
    ];
    expect(columnHasFilter(filters, "a")).toBe(true);
    expect(columnHasFilter(filters, "b")).toBe(false);
  });

  it("finds a leaf buried two groups deep, with no top-level leaf for it", () => {
    const filters: readonly SurfaceFilterNode[] = [
      { columnId: "b", operator: "isNotEmpty" },
      {
        op: "or",
        children: [
          { columnId: "c", operator: "contains", value: "q" },
          {
            op: "and",
            children: [{ columnId: "a", operator: "equals", value: 3 }],
          },
        ],
      },
    ];
    expect(columnHasFilter(filters, "a")).toBe(true);
    expect(columnHasFilter(filters, "c")).toBe(true);
    expect(columnHasFilter(filters, "b")).toBe(true);
    expect(columnHasFilter(filters, "d")).toBe(false);
  });

  it("an empty group mentions no column", () => {
    expect(columnHasFilter([{ op: "and", children: [] }], "a")).toBe(false);
    expect(columnHasFilter([], "a")).toBe(false);
  });

  it("does not mistake a group's `op` for a column match", () => {
    // A group carries no `columnId`; a naive `entry.columnId === columnId`
    // read would compare `undefined` and could match a column literally
    // named "undefined". Neither is a hit here.
    const filters: readonly SurfaceFilterNode[] = [{ op: "or", children: [] }];
    expect(columnHasFilter(filters, "undefined")).toBe(false);
  });

  it("walks a tree deeper than the engine bound without blowing up", () => {
    // The engine rejects trees deeper than 64 at `compileQuery`; the surface
    // helper must not hang before that rejection is reachable.
    let node: SurfaceFilterNode = {
      columnId: "a",
      operator: "isEmpty",
    };
    for (let i = 0; i < 200; i += 1) node = { op: "and", children: [node] };
    expect(columnHasFilter([node], "a")).toBe(true);
  });
});

describe("topLevelColumnFilter", () => {
  it("reads the top-level leaf, not the one nested in a group", () => {
    const filters: readonly SurfaceFilterNode[] = [
      {
        op: "or",
        children: [{ columnId: "a", operator: "contains", value: "nested" }],
      },
      { columnId: "a", operator: "endsWith", value: "top" },
    ];
    expect(topLevelColumnFilter(filters, "a")).toEqual({
      operator: "endsWith",
      value: "top",
    });
  });

  it("drops the `columnId` and omits an absent `value`", () => {
    expect(
      topLevelColumnFilter([{ columnId: "a", operator: "isEmpty" }], "a"),
    ).toEqual({ operator: "isEmpty" });
    expect(
      "value" in
        (topLevelColumnFilter([{ columnId: "a", operator: "isEmpty" }], "a") ??
          {}),
    ).toBe(false);
  });

  it("is null when only a nested leaf mentions the column", () => {
    const filters: readonly SurfaceFilterNode[] = [
      {
        op: "and",
        children: [{ columnId: "a", operator: "contains", value: "nested" }],
      },
    ];
    expect(topLevelColumnFilter(filters, "a")).toBeNull();
  });
});

it("reads the FIRST of two top-level leaves for the same column", () => {
  // Only a hand-authored `filters` can hold duplicates — the menu never
  // writes a second leaf for a column. When one does, first wins. The
  // per-column record this replaced was LAST-wins (each entry overwrote the
  // key), so this is a deliberate change of answer, not an accident.
  const filters: readonly SurfaceFilterNode[] = [
    { columnId: "a", operator: "contains", value: "one" },
    { columnId: "a", operator: "equals", value: "two" },
    { op: "or", children: [] },
  ];
  expect(topLevelColumnFilter(filters, "a")).toEqual({
    operator: "contains",
    value: "one",
  });
});

describe("withTopLevelColumnFilter", () => {
  const group: SurfaceFilterNode = {
    op: "or",
    children: [
      { columnId: "a", operator: "contains", value: "nested" },
      { columnId: "b", operator: "isNotEmpty" },
    ],
  };

  it("replaces the top-level leaf in place and leaves the group identical", () => {
    const filters: readonly SurfaceFilterNode[] = [
      { columnId: "a", operator: "contains", value: "old" },
      group,
    ];
    const next = withTopLevelColumnFilter(filters, "a", {
      operator: "endsWith",
      value: "new",
    });
    expect(next).toEqual([
      { columnId: "a", operator: "endsWith", value: "new" },
      group,
    ]);
    // Reference identity, not just structural equality: the group element the
    // menu did not touch must be the very object the query already held.
    expect(next[1]).toBe(group);
  });

  it("appends when there is no top-level leaf yet, after the group", () => {
    const next = withTopLevelColumnFilter([group], "a", {
      operator: "equals",
      value: "x",
    });
    expect(next).toEqual([
      group,
      { columnId: "a", operator: "equals", value: "x" },
    ]);
    expect(next[0]).toBe(group);
  });

  it("clearing removes only the top-level leaf; the group survives", () => {
    const filters: readonly SurfaceFilterNode[] = [
      { columnId: "a", operator: "contains", value: "old" },
      group,
    ];
    const next = withTopLevelColumnFilter(filters, "a", null);
    expect(next).toEqual([group]);
    expect(next[0]).toBe(group);
  });

  it("collapses two top-level leaves for the same column into one", () => {
    // The read side takes the FIRST duplicate, so the write side must replace
    // that same one and drop the rest: leaving a second `a` leaf behind would
    // make the commit look inert, because the query would still carry the
    // operand the user just replaced.
    const filters: readonly SurfaceFilterNode[] = [
      { columnId: "a", operator: "contains", value: "one" },
      { columnId: "a", operator: "equals", value: "two" },
      group,
    ];
    const next = withTopLevelColumnFilter(filters, "a", {
      operator: "startsWith",
      value: "three",
    });
    expect(next).toEqual([
      { columnId: "a", operator: "startsWith", value: "three" },
      group,
    ]);
    expect(next[1]).toBe(group);
  });

  it("omits `value` when the committed filter has none", () => {
    const next = withTopLevelColumnFilter([], "a", { operator: "isEmpty" });
    expect(next).toEqual([{ columnId: "a", operator: "isEmpty" }]);
    expect("value" in next[0]!).toBe(false);
  });
});
