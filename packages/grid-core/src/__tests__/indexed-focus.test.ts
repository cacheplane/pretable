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
import type {
  PretableIndexedFocusMovement,
  PretableIndexedFocusState,
} from "../types";

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

  /**
   * The population these windows are slices of. Required on every window, and
   * INERT for the cursor: focus carries no dataset span, so nothing here ever
   * compares one. It is held constant across each test's two windows so that
   * `datasetTotal` cannot be the thing making an assertion pass -- the only
   * discriminator in this file is still the window's coverage of the absent
   * row's old position.
   */
  const DATASET_TOTAL = 10_000;

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
        datasetTotal: DATASET_TOTAL,
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
        datasetTotal: DATASET_TOTAL,
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
        datasetTotal: DATASET_TOTAL,
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
        datasetTotal: DATASET_TOTAL,
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
        datasetTotal: DATASET_TOTAL,
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
          window: {
            start: 2_000,
            length: 10,
            datasetKey: DATASET_KEY,
            datasetTotal: DATASET_TOTAL,
          },
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

    /**
     * The retained-cursor fixture, shared by the movement tests below.
     *
     * The window was parked over dataset positions 2,000-2,099 with the cursor
     * on row-2010; it has since moved to 3,000-3,029. Nothing of the old window
     * is loaded and the new window's span comes nowhere near where row-2010
     * sat, so the row was RELEASED, not removed.
     */
    function evictedCursor() {
      const previousSnapshot = modelFor(datasetSlice(2_000, 2_100));
      const previous = {
        snapshot: previousSnapshot,
        window: {
          start: 2_000,
          length: 100,
          datasetKey: DATASET_KEY,
          datasetTotal: DATASET_TOTAL,
        },
      };
      const snapshot = modelFor(datasetSlice(3_000, 3_030));
      const focus = { ref: data("row-2010"), columnId: "score" as const };
      expect(snapshot.indexOf(focus.ref)).toBe(-1);
      return {
        snapshot,
        focus,
        eviction: {
          window: {
            start: 3_000,
            length: 30,
            datasetKey: DATASET_KEY,
            datasetTotal: DATASET_TOTAL,
          },
          previous,
        },
      };
    }

    const columnIds = ["team", "score"] as const;

    test("an arrow key from an evicted cursor holds the cursor instead of dropping it", () => {
      // `moveIndexedFocus` reconciled two-argument, so it could not tell an
      // evicted row from a deleted one: pressing an arrow WHILE the cursor's
      // row was unloaded re-seated to a nearest survivor that does not exist
      // in a flat model, and focus collapsed to nothing.
      const { snapshot, focus, eviction } = evictedCursor();

      for (const movement of [
        "down",
        "up",
        "page-down",
        "page-up",
        "home",
        "end",
        "tab",
        "shift-tab",
        "parent",
      ] as const) {
        expect(
          moveIndexedFocus({
            snapshot,
            columns: columnIds,
            focus,
            movement,
            eviction,
          }),
          `movement: ${movement}`,
        ).toEqual(focus);
      }
    });

    test("a COLUMN move from an evicted cursor still moves, because it needs no row", () => {
      // The other half of the decision: refusing to move along the ROW axis is
      // about a dataset position the engine cannot resolve to a row. The
      // column axis needs only the column list, so refusing there would be
      // gratuitous — and would make this rule indistinguishable from "an
      // evicted cursor ignores the keyboard".
      const { snapshot, focus, eviction } = evictedCursor();

      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus,
          movement: "left",
          eviction,
        }),
      ).toEqual({ ref: data("row-2010"), columnId: "team" });
      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus,
          movement: "first-column",
          eviction,
        }),
      ).toEqual({ ref: data("row-2010"), columnId: "team" });
    });

    test("an arrow from a LOADED cursor still moves while the eviction context is supplied", () => {
      // The control. Without it, "hold the cursor" could be implemented as
      // "never move once an eviction context is present", and every arrow key
      // in a windowed grid would stop working.
      const { snapshot, eviction } = evictedCursor();
      const focus = { ref: data("row-3010"), columnId: "score" as const };
      expect(snapshot.indexOf(focus.ref)).toBe(10);

      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus,
          movement: "down",
          eviction,
        }),
      ).toEqual({ ref: data("row-3011"), columnId: "score" });
    });

    test("an arrow from a PROVEN-DELETED cursor still gives the cursor up", () => {
      // The positive twin of the hold. The window has not moved, so it still
      // covers dataset position 2,010 and the row is absent from a span that
      // IS loaded — the one thing eviction can never explain. A flat model has
      // no survivor to re-seat onto, so the cursor collapses, exactly as it
      // did before this change.
      const previousSnapshot = modelFor(datasetSlice(2_000, 2_100));
      const previousWindow = {
        start: 2_000,
        length: 100,
        datasetKey: DATASET_KEY,
        datasetTotal: DATASET_TOTAL,
      };
      const focus = { ref: data("row-2010"), columnId: "score" as const };
      const remaining = [
        ...datasetSlice(2_000, 2_010),
        ...datasetSlice(2_011, 2_100),
      ];
      const snapshot = modelFor(remaining);

      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus,
          movement: "down",
          eviction: {
            window: {
              start: 2_000,
              length: remaining.length,
              datasetKey: DATASET_KEY,
              datasetTotal: DATASET_TOTAL,
            },
            previous: { snapshot: previousSnapshot, window: previousWindow },
          },
        }),
      ).toEqual(EMPTY_FOCUS);
    });

    test("with no window an arrow from an absent cursor still gives it up", () => {
      // Local mode, byte-for-byte: no window means no span to be outside of,
      // so absence alone still means the row is gone.
      const { snapshot, focus } = evictedCursor();

      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus,
          movement: "down",
        }),
      ).toEqual(EMPTY_FOCUS);
      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus,
          movement: "down",
          eviction: { window: null },
        }),
      ).toEqual(EMPTY_FOCUS);
    });

    test("an evicted cursor survives an arrow even when NOTHING is loaded", () => {
      // The whole window released at once — a fetch gap, not an exotic case.
      // `visibleRowCount === 0` collapsed every row-addressed cursor before
      // reconciliation was ever consulted, which would have undone the hold on
      // the first arrow key.
      const previousSnapshot = modelFor(datasetSlice(2_000, 2_100));
      const snapshot = modelFor([]);
      expect(snapshot.visibleRowCount).toBe(0);
      const focus = { ref: data("row-2010"), columnId: "score" as const };

      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus,
          movement: "down",
          eviction: {
            window: {
              start: 3_000,
              length: 0,
              datasetKey: DATASET_KEY,
              datasetTotal: DATASET_TOTAL,
            },
            previous: {
              snapshot: previousSnapshot,
              window: {
                start: 2_000,
                length: 100,
                datasetKey: DATASET_KEY,
                datasetTotal: DATASET_TOTAL,
              },
            },
          },
        }),
      ).toEqual(focus);
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
          window: {
            start: 3_000,
            length: 30,
            datasetKey: "sort=score",
            datasetTotal: DATASET_TOTAL,
          },
          previous: {
            snapshot: previousSnapshot,
            window: {
              start: 2_000,
              length: 100,
              datasetKey: "sort=name",
              datasetTotal: DATASET_TOTAL,
            },
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

    // The reference model now has a state ABOVE row 0: the header. `up` off
    // the first row lands there, so a walk that reaches index 0 and keeps
    // pressing up no longer clamps — and this test caught exactly that when
    // the transition was added, which is why the model is spelled out rather
    // than the assertion loosened.
    //
    // On the header, `home` / `end` are COLUMN jumps rather than row jumps.
    // The header is one row, so the only edge a jump-to-edge can mean there is
    // a column edge; in the body the same two movements still mean first/last
    // ROW, which is what the else-branch below keeps asserting.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 63 }),
        fc.array(movement, { maxLength: 150 }),
        (start, movements) => {
          let index = start;
          let onHeader = false;
          let columnId: "team" | "score" = "score";
          let focus: PretableIndexedFocusState<string, "team" | "score"> = {
            ref: data(`r${start}`),
            columnId,
          };
          for (const current of movements) {
            focus = moveIndexedFocus({
              snapshot,
              columns: ["team", "score"],
              focus,
              movement: current,
              pageRows: 7,
            });
            if (onHeader) {
              if (current === "down" || current === "page-down") {
                onHeader = false;
                index = 0;
              } else if (current === "home") {
                columnId = "team";
              } else if (current === "end") {
                columnId = "score";
              }
              // `up` / `page-up` on the header: unchanged, nowhere above it.
            } else if (current === "up" && index === 0) {
              onHeader = true;
            } else {
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
            }
            expect(focus).toEqual({
              ref: onHeader ? { kind: "header" } : data(`r${index}`),
              columnId,
            });
          }
        },
      ),
      { seed: 18_082, numRuns: 100 },
    );
  });

  describe("the header is a focus address", () => {
    const header = { kind: "header" as const };
    const columnIds = ["team", "score"] as const;
    const move = (
      focus: PretableIndexedFocusState<string, "team" | "score">,
      movement: Parameters<typeof moveIndexedFocus>[0]["movement"],
      snapshot = flatModel().getState().snapshot,
    ) => moveIndexedFocus({ snapshot, columns: columnIds, focus, movement });

    test("ArrowUp off the first row enters the header and ArrowDown leaves it", () => {
      const up = move({ ref: data("r0"), columnId: "score" }, "up");
      expect(up).toEqual({ ref: header, columnId: "score" });

      // The column is carried BOTH ways. A round trip that dropped it would
      // put the user back in the grid one column over from where they left.
      expect(move(up, "down")).toEqual({ ref: data("r0"), columnId: "score" });
    });

    test("ArrowUp from below the first row still moves one row, not to the header", () => {
      // The positive twin of the test above. Without it, an implementation
      // that sent EVERY ArrowUp to the header would pass the entry test.
      expect(move({ ref: data("r3"), columnId: "team" }, "up")).toEqual({
        ref: data("r2"),
        columnId: "team",
      });
    });

    test("left and right move between header columns and stop at the ends", () => {
      const right = move({ ref: header, columnId: "team" }, "right");
      expect(right).toEqual({ ref: header, columnId: "score" });
      expect(move(right, "right")).toEqual({ ref: header, columnId: "score" });
      expect(move(right, "left")).toEqual({ ref: header, columnId: "team" });
      expect(move({ ref: header, columnId: "team" }, "left")).toEqual({
        ref: header,
        columnId: "team",
      });
    });

    test("up from the header stays on the header", () => {
      // Consuming it is the point: an ArrowUp streak must not walk the cursor
      // off the top of the grid and leave focus nowhere.
      expect(move({ ref: header, columnId: "team" }, "up")).toEqual({
        ref: header,
        columnId: "team",
      });
    });

    test("a header cursor survives a snapshot swap unchanged", () => {
      // `reconcileIndexedFocus` re-seats an absent row to its nearest
      // surviving neighbour. The header is not a row and can never be absent,
      // so it must NOT be re-seated — without the explicit branch, `indexOf`
      // answers -1 for a valid address and the cursor silently jumps to a data
      // row on the first streaming patch.
      const model = flatModel();
      const before = model.getState().snapshot;
      model.setRows([{ id: "z0", team: "z", score: 0 }]);
      const after = model.getState().snapshot;
      expect(after).not.toBe(before);

      expect(
        reconcileIndexedFocus(
          { ref: header, columnId: "team" } satisfies PretableIndexedFocusState<
            string,
            "team" | "score"
          >,
          after,
        ),
      ).toEqual({ ref: header, columnId: "team" });
    });

    test("a header cursor survives an empty grid", () => {
      // Every row-addressed cursor collapses to empty focus when there are no
      // rows. The header is still on screen, so it stays.
      const empty = createLocalRowModel({
        rows: [] as Row[],
        columns,
        getRowId: (row) => row.id,
      }).getState().snapshot;
      expect(empty.visibleRowCount).toBe(0);

      expect(move({ ref: header, columnId: "team" }, "right", empty)).toEqual({
        ref: header,
        columnId: "score",
      });
      // …and `down` has nowhere to go, so it holds rather than clearing.
      expect(move({ ref: header, columnId: "team" }, "down", empty)).toEqual({
        ref: header,
        columnId: "team",
      });
    });

    test("scroll-into-view has nothing to reveal for the header", () => {
      // `null` is the "already resolved, write no scrollTop" answer, NOT
      // `undefined` ("could not decide, try again") — a header cursor that
      // reported undecidable would keep the surface's reveal effect re-running
      // on every layout pass.
      const snapshot = flatModel(5).getState().snapshot;
      const rowMetrics = createRowHeightIndex({
        defaultHeight: 20,
        getKey: (ref: { readonly kind: "data"; readonly rowId: string }) =>
          ref.rowId,
        rows: Array.from({ length: 5 }, (_, index) => ({
          key: data(`r${index}`),
        })),
      });

      // The positive twin: from the same scrollTop, a real row DOES produce a
      // write. Without it, a `getScrollTopForIndexedFocus` that returned null
      // for everything would satisfy the header assertion.
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
          ref: { kind: "header" },
          rowMetrics,
          scrollTop: 0,
          viewportHeight: 40,
        }),
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // The two axes of edge jump.
  //
  // `home` / `end` move to the first / last ROW; `first-column` /
  // `last-column` move to the first / last COLUMN. The pair only coincide on
  // the header, which is a single row. Every assertion below therefore starts
  // from a cell that is in the middle of BOTH axes, so an answer that moved
  // along the wrong one is visibly wrong rather than accidentally right.
  // -------------------------------------------------------------------------
  describe("edge jumps pick an axis", () => {
    const columnIds = ["team", "score", "rank"] as const;
    type ColumnId = (typeof columnIds)[number];

    function fromMiddle(movement: PretableIndexedFocusMovement) {
      const snapshot = flatModel(5).getState().snapshot;
      const focus: PretableIndexedFocusState<string, ColumnId> = {
        ref: data("r2"),
        columnId: "score",
      };
      return moveIndexedFocus({
        snapshot,
        columns: columnIds,
        focus,
        movement,
      });
    }

    test("first-column / last-column move along the row, leaving the row alone", () => {
      expect(fromMiddle("first-column")).toEqual({
        ref: data("r2"),
        columnId: "team",
      });
      expect(fromMiddle("last-column")).toEqual({
        ref: data("r2"),
        columnId: "rank",
      });
    });

    test("home / end still move along the column, leaving the column alone", () => {
      expect(fromMiddle("home")).toEqual({
        ref: data("r0"),
        columnId: "score",
      });
      expect(fromMiddle("end")).toEqual({
        ref: data("r4"),
        columnId: "score",
      });
    });

    test("a column edge jump from the edge itself changes nothing", () => {
      const snapshot = flatModel(5).getState().snapshot;
      const atFirst = { ref: data("r2"), columnId: "team" as const };
      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus: atFirst,
          movement: "first-column",
        }),
      ).toEqual(atFirst);
    });

    test("on the header, every edge jump is a column jump", () => {
      const snapshot = flatModel(5).getState().snapshot;
      const onHeader = { ref: { kind: "header" } as const, columnId: "score" };
      for (const movement of ["home", "first-column"] as const) {
        expect(
          moveIndexedFocus({
            snapshot,
            columns: columnIds,
            focus: onHeader,
            movement,
          }),
        ).toEqual({ ref: { kind: "header" }, columnId: "team" });
      }
      for (const movement of ["end", "last-column"] as const) {
        expect(
          moveIndexedFocus({
            snapshot,
            columns: columnIds,
            focus: onHeader,
            movement,
          }),
        ).toEqual({ ref: { kind: "header" }, columnId: "rank" });
      }
    });

    test("from no focus at all, a column edge jump seeds row 0 at that end", () => {
      const snapshot = flatModel(5).getState().snapshot;
      const nowhere = { ref: null, columnId: null };
      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus: nowhere,
          movement: "first-column",
        }),
      ).toEqual({ ref: data("r0"), columnId: "team" });
      expect(
        moveIndexedFocus({
          snapshot,
          columns: columnIds,
          focus: nowhere,
          movement: "last-column",
        }),
      ).toEqual({ ref: data("r0"), columnId: "rank" });
    });
  });
});
