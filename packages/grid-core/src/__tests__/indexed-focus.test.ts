import fc from "fast-check";
import { describe, expect, test } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableGroupId,
} from "@pretable-internal/row-model";
import { createRowHeightIndex } from "@pretable-internal/layout-core";

import {
  getScrollTopForIndexedFocus,
  moveIndexedFocus,
  reconcileIndexedFocus,
} from "../indexed-focus";
import type { PretableIndexedFocusState } from "../types";

interface Row {
  readonly id: string;
  readonly team: string;
  readonly score: number;
}

const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("team", { type: "text" }),
  helper.accessor("score", { type: "number" }),
] as const;

const data = (rowId: string) => ({ kind: "data" as const, rowId });

function flatModel(count = 8) {
  return createLocalRowModel({
    rows: Array.from({ length: count }, (_, index) => ({
      id: `r${index}`,
      team: index < 4 ? "a" : "b",
      score: index,
    })),
    columns,
    getRowId: (row) => row.id,
  });
}

describe("indexed focus", () => {
  test("supports arrows, pages, home/end, and tab without materializing visible rows", () => {
    const snapshot = flatModel().getState().snapshot;
    const columnIds = ["team", "score"] as const;
    let focus: PretableIndexedFocusState<string, "team" | "score"> = {
      ref: data("r2"),
      columnId: "team",
    };

    focus = moveIndexedFocus({
      snapshot,
      columns: columnIds,
      focus,
      movement: "down",
    });
    expect(focus).toEqual({ ref: data("r3"), columnId: "team" });
    focus = moveIndexedFocus({
      snapshot,
      columns: columnIds,
      focus,
      movement: "page-down",
      pageRows: 3,
    });
    expect(focus.ref).toEqual(data("r6"));
    focus = moveIndexedFocus({
      snapshot,
      columns: columnIds,
      focus,
      movement: "end",
    });
    expect(focus.ref).toEqual(data("r7"));
    focus = moveIndexedFocus({
      snapshot,
      columns: columnIds,
      focus,
      movement: "home",
    });
    expect(focus.ref).toEqual(data("r0"));
    focus = moveIndexedFocus({
      snapshot,
      columns: columnIds,
      focus,
      movement: "tab",
    });
    expect(focus).toEqual({ ref: data("r0"), columnId: "score" });
    focus = moveIndexedFocus({
      snapshot,
      columns: columnIds,
      focus,
      movement: "tab",
    });
    expect(focus).toEqual({ ref: data("r1"), columnId: "team" });
    focus = moveIndexedFocus({
      snapshot,
      columns: columnIds,
      focus,
      movement: "shift-tab",
    });
    expect(focus).toEqual({ ref: data("r0"), columnId: "score" });

    const last = { ref: data("r7"), columnId: "score" as const };
    expect(
      moveIndexedFocus({
        snapshot,
        columns: columnIds,
        focus: last,
        movement: "tab",
      }),
    ).toBe(last);
    const first = { ref: data("r0"), columnId: "team" as const };
    expect(
      moveIndexedFocus({
        snapshot,
        columns: columnIds,
        focus: first,
        movement: "shift-tab",
      }),
    ).toBe(first);
  });

  test("from null focus, left arrives on the first row's last visual column", () => {
    const snapshot = flatModel().getState().snapshot;

    expect(
      moveIndexedFocus({
        snapshot,
        columns: ["team", "score"],
        focus: { ref: null, columnId: null },
        movement: "left",
      }),
    ).toEqual({ ref: data("r0"), columnId: "score" });
  });

  test("focuses group refs, navigates to parents, and falls back after collapse", () => {
    const model = createLocalRowModel({
      rows: [
        { id: "a", team: "team", score: 1 },
        { id: "b", team: "team", score: 2 },
      ],
      columns,
      getRowId: (row) => row.id,
      initialExpansion: { kind: "expanded" },
      query: { filters: [], sort: [], rowGroups: [{ columnId: "team" }] },
    });
    const expanded = model.getState().snapshot;
    const parent = expanded.parentGroupOf(data("a"));
    expect(parent).toBeDefined();
    if (!parent) throw new Error("expected parent");

    const parentFocus = moveIndexedFocus({
      snapshot: expanded,
      columns: ["team", "score"],
      focus: { ref: data("a"), columnId: "score" },
      movement: "parent",
    });
    expect(parentFocus).toEqual({
      ref: { kind: "group", groupId: parent.groupId },
      columnId: "score",
    });

    model.setGroupExpanded(parent.groupId, false);
    const collapsed = model.getState().snapshot;
    expect(reconcileIndexedFocus(parentFocus, collapsed)).toBe(parentFocus);
    expect(
      reconcileIndexedFocus({ ref: data("a"), columnId: "score" }, collapsed),
    ).toEqual({
      ref: { kind: "group", groupId: parent.groupId },
      columnId: "score",
    });
  });

  test("keeps equal-text data and group identities distinct", () => {
    const equalTextId = "__group__:team=s:same";
    const model = createLocalRowModel({
      rows: [{ id: equalTextId, team: "same", score: 1 }],
      columns,
      getRowId: (row) => row.id,
      initialExpansion: { kind: "expanded" },
      query: { filters: [], sort: [], rowGroups: [{ columnId: "team" }] },
    });
    const snapshot = model.getState().snapshot;
    const groupRef = {
      kind: "group" as const,
      groupId: equalTextId as PretableGroupId,
    };

    expect(snapshot.indexOf(groupRef)).toBe(0);
    expect(snapshot.indexOf(data(equalTextId))).toBe(1);

    expect(
      moveIndexedFocus({
        snapshot,
        columns: ["team", "score"],
        focus: { ref: groupRef, columnId: "team" },
        movement: "down",
      }).ref,
    ).toEqual(data(equalTextId));
  });

  test("uses bounded indexed calls for page movement and returns stable focus for missing rows", () => {
    const source = flatModel(100).getState().snapshot;
    let calls = 0;
    const snapshot = {
      ...source,
      rowAt(index: number) {
        calls += 1;
        return source.rowAt(index);
      },
      indexOf(ref: Parameters<typeof source.indexOf>[0]) {
        calls += 1;
        return source.indexOf(ref);
      },
    };
    const missing = { ref: data("missing"), columnId: "score" as const };

    expect(
      moveIndexedFocus({
        snapshot,
        columns: ["team", "score"],
        focus: { ref: data("r50"), columnId: "score" },
        movement: "page-up",
        pageRows: 20,
      }).ref,
    ).toEqual(data("r30"));
    expect(calls).toBeLessThanOrEqual(3);
    expect(reconcileIndexedFocus(missing, snapshot)).toEqual({
      ref: null,
      columnId: null,
    });
  });

  test("computes scroll-to-ref from rank and row metrics and ignores missing refs", () => {
    const snapshot = flatModel(5).getState().snapshot;
    const rowMetrics = createRowHeightIndex({
      defaultHeight: 20,
      getKey: (ref: { readonly kind: "data"; readonly rowId: string }) =>
        ref.rowId,
      rows: Array.from({ length: 5 }, (_, index) => ({
        key: data(`r${index}`),
      })),
    });

    expect(
      getScrollTopForIndexedFocus({
        snapshot,
        ref: data("r4"),
        rowMetrics,
        scrollTop: 0,
        viewportHeight: 40,
      }),
    ).toBe(60);
    expect(
      getScrollTopForIndexedFocus({
        snapshot,
        ref: data("missing"),
        rowMetrics,
        scrollTop: 0,
        viewportHeight: 40,
      }),
    ).toBeNull();
  });

  test("matches flat-rank navigation across randomized vertical movements", () => {
    const snapshot = flatModel(64).getState().snapshot;
    const movement = fc.constantFrom(
      "up" as const,
      "down" as const,
      "page-up" as const,
      "page-down" as const,
      "home" as const,
      "end" as const,
    );

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 63 }),
        fc.array(movement, { maxLength: 150 }),
        (start, movements) => {
          let index = start;
          let focus: PretableIndexedFocusState<string, "team" | "score"> = {
            ref: data(`r${start}`),
            columnId: "score",
          };
          for (const current of movements) {
            focus = moveIndexedFocus({
              snapshot,
              columns: ["team", "score"],
              focus,
              movement: current,
              pageRows: 7,
            });
            index =
              current === "home"
                ? 0
                : current === "end"
                  ? 63
                  : Math.max(
                      0,
                      Math.min(
                        63,
                        index +
                          (current === "up"
                            ? -1
                            : current === "down"
                              ? 1
                              : current === "page-up"
                                ? -7
                                : 7),
                      ),
                    );
            expect(focus).toEqual({
              ref: data(`r${index}`),
              columnId: "score",
            });
          }
        },
      ),
      { seed: 18_082, numRuns: 100 },
    );
  });
});
