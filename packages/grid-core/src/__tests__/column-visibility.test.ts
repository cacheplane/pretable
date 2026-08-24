import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
} from "@pretable-internal/row-model";

import { createGridUiCore } from "../create-grid-ui-core";

interface Row {
  readonly id: number;
  readonly name: string;
  readonly quantity: number;
  readonly price: number;
}

const helper = createColumnHelper<Row>();
const modelColumns = [
  helper.accessor("name", { type: "text" }),
  helper.accessor("quantity", { type: "number" }),
  helper.accessor("price", { type: "number" }),
] as const;

function make(
  visualColumns: readonly {
    readonly id: "name" | "quantity" | "price";
    readonly widthPx?: number;
    readonly pinned?: "left" | "right";
    readonly hidden?: boolean;
  }[] = [
    { id: "name", widthPx: 180 },
    { id: "quantity", widthPx: 100, pinned: "right" },
    { id: "price", widthPx: 120 },
  ],
) {
  const rowModel = createLocalRowModel({
    rows: [
      { id: 1, name: "one", quantity: 1, price: 10 },
      { id: 2, name: "two", quantity: 2, price: 20 },
    ],
    columns: modelColumns,
  });
  return {
    rowModel,
    grid: createGridUiCore({ rowModel, columns: visualColumns }),
  };
}

describe("column visibility", () => {
  test("hidden: true in the initial column config survives normalization", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100, hidden: true },
      { id: "price", widthPx: 120 },
    ]);

    expect(grid.getState().columnLayout).toEqual([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100, hidden: true },
      { id: "price", widthPx: 120 },
    ]);
  });

  test("setColumnVisible(false) sets hidden and leaves width, pin and position alone", () => {
    const { grid } = make();

    grid.setColumnVisible("quantity", false);

    // The pinned "quantity" column sits at the pinned-right end of the
    // normalized layout, and hiding it must not move it back.
    expect(grid.getState().columnLayout).toEqual([
      { id: "name", widthPx: 180 },
      { id: "price", widthPx: 120 },
      { id: "quantity", widthPx: 100, pinned: "right", hidden: true },
    ]);
  });

  test("an unchanged visibility publishes nothing", () => {
    const { grid } = make();
    const listener = vi.fn();
    grid.subscribe(listener);
    const before = grid.getState();

    grid.setColumnVisible("quantity", true);
    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();

    grid.setColumnVisible("quantity", false);
    expect(listener).toHaveBeenCalledTimes(1);
    const hiddenState = grid.getState();

    grid.setColumnVisible("quantity", false);
    expect(grid.getState()).toBe(hiddenState);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("setColumnVisible(true) strips the flag rather than writing hidden: undefined", () => {
    const { grid } = make();

    grid.setColumnVisible("price", false);
    grid.setColumnVisible("price", true);

    const price = grid
      .getState()
      .columnLayout.find((column) => column.id === "price")!;
    expect(price).toEqual({ id: "price", widthPx: 120 });
    expect("hidden" in price).toBe(false);
  });

  test("setColumns publishes a visibility-only change", () => {
    const { grid } = make();
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setColumns([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100, pinned: "right", hidden: true },
      { id: "price", widthPx: 120 },
    ]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState().columnLayout).toEqual([
      { id: "name", widthPx: 180 },
      { id: "price", widthPx: 120 },
      { id: "quantity", widthPx: 100, pinned: "right", hidden: true },
    ]);

    // And the reflexive half: replaying the same visibility is still a no-op.
    grid.setColumns([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100, pinned: "right", hidden: true },
      { id: "price", widthPx: 120 },
    ]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("unpinning a hidden column does not reveal it, and re-showing keeps its pin", () => {
    const { grid } = make();

    grid.setColumnVisible("quantity", false);
    grid.setColumnPinned("quantity", null);

    // The clear path rebuilds the entry; every OTHER optional key survives.
    // The unpinned column keeps its slot at the end — `orderPinnedColumns`
    // preserves relative order and unpinning has never moved a column back.
    expect(grid.getState().columnLayout).toEqual([
      { id: "name", widthPx: 180 },
      { id: "price", widthPx: 120 },
      { id: "quantity", widthPx: 100, hidden: true },
    ]);

    // The mirror image: the show path rebuilds the entry too, and must keep
    // the pin it strips `hidden` alongside.
    grid.setColumnPinned("quantity", "right");
    grid.setColumnVisible("quantity", true);
    expect(grid.getState().columnLayout).toEqual([
      { id: "name", widthPx: 180 },
      { id: "price", widthPx: 120 },
      { id: "quantity", widthPx: 100, pinned: "right" },
    ]);
  });

  test("setColumnOrder must name every column in the layout, hidden included", () => {
    const { grid } = make();

    grid.setColumnVisible("price", false);

    expect(() => grid.setColumnOrder(["name", "quantity"])).toThrowError(
      expect.objectContaining({ code: "invalid-ui-state" }),
    );
    // The full roster, hidden included, is still accepted.
    grid.setColumnOrder(["price", "name", "quantity"]);
    expect(grid.getState().columnLayout.map((column) => column.id)).toEqual([
      "price",
      "name",
      "quantity",
    ]);
  });

  test("hiding the focused column re-seats focus onto the left neighbor first", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "quantity" });
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setColumnVisible("quantity", false);

    // One atomic wake: the layout change and the focus repair publish together.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: 1 },
      columnId: "name",
    });
  });

  test("hiding the focused first column falls back to the right neighbor", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });

    grid.setColumnVisible("name", false);

    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: 1 },
      columnId: "quantity",
    });
  });

  test("a left neighbor that is itself hidden is skipped over", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.setColumnVisible("quantity", false);
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "price" });

    grid.setColumnVisible("price", false);

    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: 1 },
      columnId: "name",
    });
  });

  test("hiding a non-focused column leaves focus alone", () => {
    const { grid } = make();
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });
    const focusBefore = grid.getState().focus;

    grid.setColumnVisible("price", false);

    expect(grid.getState().focus).toBe(focusBefore);
  });

  test("hiding the last visible column clears focus rather than pointing at a hidden cell", () => {
    const { grid } = make([{ id: "name", widthPx: 180 }]);
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });

    grid.setColumnVisible("name", false);

    expect(grid.getState().focus).toEqual({ ref: null, columnId: null });
  });

  test("hiding the selection-anchor column re-seats the anchor onto a visible neighbor", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.setSelection({
      rows: { kind: "explicit", rowIds: new Set() },
      ranges: [
        {
          start: { rowId: 1, columnId: "quantity" },
          end: { rowId: 1, columnId: "quantity" },
        },
      ],
      anchor: { rowId: 1, columnId: "quantity" },
    });

    grid.setColumnVisible("quantity", false);

    expect(grid.getState().selection.anchor).toEqual({
      rowId: 1,
      columnId: "name",
    });
  });

  test("hiding the anchor's first column falls back to the right neighbor", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.setSelection({
      rows: { kind: "explicit", rowIds: new Set() },
      ranges: [],
      anchor: { rowId: 1, columnId: "name" },
    });

    grid.setColumnVisible("name", false);

    expect(grid.getState().selection.anchor).toEqual({
      rowId: 1,
      columnId: "quantity",
    });
  });

  test("hiding the last visible column clears the anchor", () => {
    const { grid } = make([{ id: "name", widthPx: 180 }]);
    grid.setSelection({
      rows: { kind: "explicit", rowIds: new Set() },
      ranges: [],
      anchor: { rowId: 1, columnId: "name" },
    });

    grid.setColumnVisible("name", false);

    expect(grid.getState().selection.anchor).toBeNull();
  });

  test("arrow-key focus movement skips a hidden column in both directions", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.setColumnVisible("quantity", false);
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });

    grid.moveFocus("right");
    expect(grid.getState().focus.columnId).toBe("price");

    grid.moveFocus("left");
    expect(grid.getState().focus.columnId).toBe("name");
  });

  test("hiding the column under an open edit session cancels the edit atomically", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.observeRowModelRevision(0);
    grid.beginEdit({ rowId: 1, columnId: "quantity", value: 1 });
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setColumnVisible("quantity", false);

    // One atomic wake: the layout change and the edit repair publish together.
    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState().editing).toBeNull();
  });

  test("hiding a different column leaves an open edit session alone", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.observeRowModelRevision(0);
    grid.beginEdit({ rowId: 1, columnId: "quantity", value: 1 });
    const editingBefore = grid.getState().editing;

    grid.setColumnVisible("price", false);

    expect(grid.getState().editing).toBe(editingBefore);
  });

  test("beginEdit refuses a hidden column", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.observeRowModelRevision(0);
    grid.setColumnVisible("quantity", false);

    expect(() =>
      grid.beginEdit({ rowId: 1, columnId: "quantity", value: 1 }),
    ).toThrowError(expect.objectContaining({ code: "invalid-ui-state" }));
  });

  test("hiding a column that is not the anchor leaves the selection untouched", () => {
    const { grid } = make([
      { id: "name", widthPx: 180 },
      { id: "quantity", widthPx: 100 },
      { id: "price", widthPx: 120 },
    ]);
    grid.setSelection({
      rows: { kind: "explicit", rowIds: new Set() },
      ranges: [],
      anchor: { rowId: 1, columnId: "name" },
    });
    const selectionBefore = grid.getState().selection;

    grid.setColumnVisible("price", false);

    expect(grid.getState().selection).toBe(selectionBefore);
  });
});
