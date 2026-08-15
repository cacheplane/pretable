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

  /**
   * Rows named by their DATASET position, so a window's `start` and the ids
   * inside it can never drift apart. `datasetSlice(2_000, 2_100)` is the
   * hundred rows a window at `{ start: 2_000, length: 100 }` would hold.
   */
  function datasetSlice(from: number, to: number): Row[] {
    return Array.from({ length: to - from }, (_, offset) => ({
      id: `row-${from + offset}`,
      team: "a",
      score: from + offset,
    }));
  }

  function modelFor(rows: readonly Row[]) {
    return createLocalRowModel({
      rows: [...rows],
      columns,
      getRowId: (row) => row.id,
    }).getState().snapshot;
  }

  /** A stable population identity; see `spanReadableInWindow`. */
  const DATASET_KEY = "population-1";

  const EMPTY_FOCUS = { ref: null, columnId: null };

  describe("eviction", () => {
    test("an evicted focused cell keeps the cursor where the user left it", () => {
      // The window was parked over dataset positions 2,000-2,099 and the user
      // put the cursor on row-2010 -- rank 10 of that window, dataset position
      // 2,010. Neither number is zero, so a conversion that drops the window
      // offset cannot pass by arithmetic coincidence.
      const previousSnapshot = modelFor(datasetSlice(2_000, 2_100));
      const previousWindow = {
        start: 2_000,
        length: 100,
        datasetKey: DATASET_KEY,
      };
      const focus = { ref: data("row-2010"), columnId: "score" as const };
      expect(previousSnapshot.dataIndexOf(focus.ref)).toBe(10);

      // Scrolled a long way on. Nothing of the old window is loaded, and the
      // new window's span comes nowhere near where row-2010 sat -- which is
      // exactly what says the row was RELEASED rather than removed.
      const snapshot = modelFor(datasetSlice(3_000, 3_030));
      const loadedWindow = {
        start: 3_000,
        length: 30,
        datasetKey: DATASET_KEY,
      };
      expect(snapshot.indexOf(focus.ref)).toBe(-1);

      expect(
        reconcileIndexedFocus(focus, snapshot, {
          window: loadedWindow,
          previous: { snapshot: previousSnapshot, window: previousWindow },
        }),
      ).toEqual(focus);
    });

    test("a focused row deleted inside the loaded span still gives up the cursor", () => {
      // The positive twin of the test above, and the one that keeps "retain an
      // evicted row" from being implemented as "never re-seat". Same shape,
      // same fixture size; only the window's relationship to the row's old
      // position differs.
      //
      // It also pins the dataset conversion: row-2010 sits at RANK 10 of the
      // previous window, and only `previousWindow.start + rank` puts it inside
      // the current window's span. A comparison that forgets the offset reads
      // 10, finds it outside [2,000, 2,099), and wrongly calls this eviction.
      const previousSnapshot = modelFor(datasetSlice(2_000, 2_100));
      const previousWindow = {
        start: 2_000,
        length: 100,
        datasetKey: DATASET_KEY,
      };
      const focus = { ref: data("row-2010"), columnId: "score" as const };

      const remaining = [
        ...datasetSlice(2_000, 2_010),
        ...datasetSlice(2_011, 2_100),
      ];
      const snapshot = modelFor(remaining);
      const loadedWindow = {
        start: 2_000,
        length: remaining.length,
        datasetKey: DATASET_KEY,
      };

      expect(
        reconcileIndexedFocus(focus, snapshot, {
          window: loadedWindow,
          previous: { snapshot: previousSnapshot, window: previousWindow },
        }),
      ).toEqual(EMPTY_FOCUS);
    });

    test("a focused row hidden inside the loaded span re-seats to its surviving ancestor", () => {
      // The re-seat branch proper. A flat model has no survivor to re-seat ONTO
      // -- `nearestVisibleRef` only ever answers with an ancestor group -- so
      // "re-seats to the nearest survivor" is only observable under grouping,
      // and it has to stay observable under a window.
      const model = createLocalRowModel({
        rows: datasetSlice(2_000, 2_010).map((row, index) => ({
          ...row,
          team: index < 5 ? "west" : "east",
        })),
        columns,
        getRowId: (row) => row.id,
        initialExpansion: { kind: "expanded" },
        query: { filters: [], sort: [], rowGroups: [{ columnId: "team" }] },
      });
      const previousSnapshot = model.getState().snapshot;
      const previousWindow = {
        start: 2_000,
        length: 10,
        datasetKey: DATASET_KEY,
      };
      const focus = { ref: data("row-2002"), columnId: "score" as const };
      const west = previousSnapshot.parentGroupOf(focus.ref);
      if (west === undefined) throw new Error("expected a parent group");

      model.setGroupExpanded(west.groupId, false);
      const snapshot = model.getState().snapshot;
      expect(snapshot.indexOf(focus.ref)).toBe(-1);

      expect(
        reconcileIndexedFocus(focus, snapshot, {
          // The window has not moved, so it still covers dataset position
          // 2,002: the row is absent from a span that is loaded, which is the
          // one thing eviction can never explain.
          window: { start: 2_000, length: 10, datasetKey: DATASET_KEY },
          previous: { snapshot: previousSnapshot, window: previousWindow },
        }),
      ).toEqual({
        ref: { kind: "group", groupId: west.groupId },
        columnId: "score",
      });
    });

    test("with no window an absent focused row still loses the cursor", () => {
      // Local mode, byte-for-byte. `previous` is supplied and would prove
      // nothing was deleted, but with no window there is no span to be outside
      // of, so absence alone still means the row is gone -- exactly what every
      // pre-eviction consumer already sees.
      const previousSnapshot = modelFor(datasetSlice(2_000, 2_100));
      const focus = { ref: data("row-2010"), columnId: "score" as const };
      const snapshot = modelFor(datasetSlice(3_000, 3_030));

      expect(
        reconcileIndexedFocus(focus, snapshot, {
          window: null,
          previous: { snapshot: previousSnapshot, window: null },
        }),
      ).toEqual(EMPTY_FOCUS);
    });

    test("a population change re-seats the focus rather than retaining it", () => {
      // Identical to the retention test except for the key. A new `datasetKey`
      // means those dataset positions now hold different rows, so "outside the
      // window" is no longer evidence the cursor's row still exists somewhere
      // -- the same reset `reconcileIndexedSelection` performs.
      const previousSnapshot = modelFor(datasetSlice(2_000, 2_100));
      const focus = { ref: data("row-2010"), columnId: "score" as const };
      const snapshot = modelFor(datasetSlice(3_000, 3_030));

      expect(
        reconcileIndexedFocus(focus, snapshot, {
          window: { start: 3_000, length: 30, datasetKey: "sort=score" },
          previous: {
            snapshot: previousSnapshot,
            window: { start: 2_000, length: 100, datasetKey: "sort=name" },
          },
        }),
      ).toEqual(EMPTY_FOCUS);
    });
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
