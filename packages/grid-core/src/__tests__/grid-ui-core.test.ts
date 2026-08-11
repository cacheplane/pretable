import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
} from "@pretable-internal/row-model";

import { createGridUiCore, PretableGridUiError } from "../create-grid-ui-core";
import type { PretableGridUiCore } from "../types";

interface Row {
  readonly id: number;
  readonly name: string;
  readonly quantity: number;
}

const helper = createColumnHelper<Row>();
const modelColumns = [
  helper.accessor("name", { type: "text" }),
  helper.accessor("quantity", { type: "number" }),
] as const;
const visualColumns = [
  { id: "name", widthPx: 180 },
  { id: "quantity", widthPx: 100, pinned: "right" as const },
] as const;

function make() {
  const rowModel = createLocalRowModel({
    rows: [{ id: 1, name: "one", quantity: 1 }],
    columns: modelColumns,
  });
  return {
    rowModel,
    grid: createGridUiCore({ rowModel, columns: visualColumns }),
  };
}

describe("UI-only grid core", () => {
  test("snapshot contains only UI state and the atomically observed model revision", () => {
    const { grid } = make();
    const snapshot = grid.getState();

    expect(Object.keys(snapshot).sort()).toEqual([
      "columnLayout",
      "editing",
      "focus",
      "observedRowModelRevision",
      "selection",
      "viewport",
    ]);
    expect(snapshot.observedRowModelRevision).toBeNull();
    for (const forbidden of [
      "rows",
      "visibleRows",
      "filters",
      "sort",
      "grouping",
      "rowGroups",
      "expansion",
      "transactions",
      "distinctValues",
      "query",
    ]) {
      expect(forbidden in snapshot).toBe(false);
    }
  });

  test("accepts model columns directly and resolves a visual width default", () => {
    const rowModel = createLocalRowModel({
      rows: [{ id: 1, name: "one", quantity: 1 }],
      columns: modelColumns,
    });

    const grid = createGridUiCore({ rowModel, columns: modelColumns });

    expect(grid.getState().columnLayout).toEqual([
      { id: "name", widthPx: 160 },
      { id: "quantity", widthPx: 160 },
    ]);
  });

  test("model commits do not wake grid subscribers until the matching layout revision is observed", () => {
    const { grid, rowModel } = make();
    const listener = vi.fn();
    grid.subscribe(listener);

    rowModel.applyTransaction({ add: [{ id: 2, name: "two", quantity: 2 }] });

    expect(listener).not.toHaveBeenCalled();
    expect(grid.getState().observedRowModelRevision).toBeNull();
    grid.observeRowModelRevision(0);
    expect(listener).not.toHaveBeenCalled();
    grid.observeRowModelRevision(1);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState().observedRowModelRevision).toBe(1);
    grid.observeRowModelRevision(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("UI changes wake normally while no-ops retain stable state identity", () => {
    const { grid } = make();
    const listener = vi.fn();
    grid.subscribe(listener);
    const initial = grid.getState();

    grid.setViewport({ scrollTop: 0, scrollLeft: 0, width: 0, height: 0 });
    expect(grid.getState()).toBe(initial);
    expect(listener).not.toHaveBeenCalled();

    grid.setViewport({ scrollTop: 10, scrollLeft: 4, width: 800, height: 500 });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState()).not.toBe(initial);
    expect(grid.getState().viewport).toEqual({
      scrollTop: 10,
      scrollLeft: 4,
      width: 800,
      height: 500,
    });
  });

  test("semantically equal selection replacement is a stable no-op", () => {
    const { grid } = make();
    const listener = vi.fn();
    grid.subscribe(listener);
    const before = grid.getState();

    grid.setSelection({
      rows: { kind: "explicit", rowIds: new Set() },
      ranges: [],
      anchor: null,
    });

    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("updates visual pinning without leaking derivation column state", () => {
    const { grid } = make();
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setColumnPinned("name", "left");

    expect(grid.getState().columnLayout[0]).toEqual({
      id: "name",
      widthPx: 180,
      pinned: "left",
    });
    expect(listener).toHaveBeenCalledTimes(1);
    const before = grid.getState();
    grid.setColumnPinned("name", "left");
    expect(grid.getState()).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("focus navigation follows the current visual column order", () => {
    const { grid } = make();
    grid.observeRowModelRevision(0);
    grid.setColumnPinned("quantity", null);
    grid.setColumnOrder(["quantity", "name"]);
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });

    grid.moveFocus("left");

    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: 1 },
      columnId: "quantity",
    });
  });

  test("reconciles focus and data-only editing in the same revision publication", () => {
    const { grid, rowModel } = make();
    grid.observeRowModelRevision(0);
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });
    grid.beginEdit({ rowId: 1, columnId: "quantity", value: 1 });
    const listener = vi.fn();
    grid.subscribe(listener);

    rowModel.applyTransaction({ remove: [1] });
    grid.observeRowModelRevision(1);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState()).toMatchObject({
      observedRowModelRevision: 1,
      focus: { ref: null, columnId: null },
      editing: null,
    });
  });

  test("isolates hostile listeners, queues reentrant UI commands, and disposes best-effort", () => {
    const { grid } = make();
    const calls: string[] = [];
    grid.subscribe(() => {
      calls.push("throw");
      throw new Error("hostile listener");
    });
    grid.subscribe(() => {
      calls.push("reenter");
      if (grid.getState().viewport.scrollTop === 1) {
        grid.setViewport({ ...grid.getState().viewport, scrollTop: 2 });
      }
    });

    grid.setViewport({ ...grid.getState().viewport, scrollTop: 1 });

    expect(calls).toEqual(["throw", "reenter", "throw", "reenter"]);
    expect(grid.getState().viewport.scrollTop).toBe(2);
    grid.dispose();
    expect("status" in grid.getState()).toBe(false);
    expect(() =>
      grid.setViewport({ ...grid.getState().viewport, scrollTop: 3 }),
    ).toThrow(PretableGridUiError);
  });

  test("reentrant disposal wakes the captured listeners once and detaches them", () => {
    const { grid } = make();
    const disposing = vi.fn(() => grid.dispose());
    const peer = vi.fn();
    grid.subscribe(disposing);
    grid.subscribe(peer);

    grid.setViewport({ ...grid.getState().viewport, scrollTop: 1 });

    expect(disposing).toHaveBeenCalledTimes(2);
    expect(peer).toHaveBeenCalledTimes(2);
    expect(() =>
      grid.setViewport({ ...grid.getState().viewport, scrollTop: 2 }),
    ).toThrowError(expect.objectContaining({ code: "disposed-grid-ui" }));
  });

  test("keeps row, row-ID, and column correlations through editing", () => {
    const { grid } = make();
    grid.observeRowModelRevision(0);

    grid.beginEdit({ rowId: 1, columnId: "quantity", value: 42 });
    expect(grid.getState().editing).toEqual({
      rowId: 1,
      columnId: "quantity",
      value: 42,
      status: "editing",
    });
    if (false) {
      // @ts-expect-error quantity editing accepts a number, not a string
      grid.beginEdit({ rowId: 1, columnId: "quantity", value: "42" });
      // @ts-expect-error a string row ID cannot enter a number-ID model
      grid.beginEdit({ rowId: "1", columnId: "name", value: "one" });
    }

    type OtherRow = { readonly id: string; readonly name: string };
    type OtherColumns = readonly [
      ReturnType<ReturnType<typeof createColumnHelper<OtherRow>>["accessor"]>,
    ];
    // @ts-expect-error grid generics are invariant across row, ID, and columns
    const incompatible: PretableGridUiCore<OtherRow, string, OtherColumns> =
      grid;
    void incompatible;
  });

  test("rejects missing, group-only, and unknown-column edit targets atomically", () => {
    interface StringRow {
      readonly id: string;
      readonly name: string;
      readonly quantity: number;
    }
    const stringHelper = createColumnHelper<StringRow>();
    const stringColumns = [
      stringHelper.accessor("name", { type: "text" }),
      stringHelper.accessor("quantity", { type: "number" }),
    ] as const;
    const groupedModel = createLocalRowModel({
      rows: [{ id: "data", name: "team", quantity: 1 }],
      columns: stringColumns,
      getRowId: (row) => row.id,
      initialExpansion: { kind: "expanded" },
      query: { filters: [], sort: [], rowGroups: [{ columnId: "name" }] },
    });
    const group = groupedModel.getState().snapshot.rowAt(0);
    expect(group?.kind).toBe("group");
    if (group?.kind !== "group") throw new Error("expected group");
    const grid = createGridUiCore({
      rowModel: groupedModel,
      columns: stringColumns,
    });
    grid.observeRowModelRevision(0);
    const before = grid.getState();
    const listener = vi.fn();
    grid.subscribe(listener);

    expect(() =>
      grid.beginEdit({ rowId: group.groupId, columnId: "name", value: "x" }),
    ).toThrowError(expect.objectContaining({ code: "invalid-ui-state" }));
    expect(() =>
      grid.beginEdit({ rowId: "missing", columnId: "name", value: "x" }),
    ).toThrowError(expect.objectContaining({ code: "invalid-ui-state" }));
    expect(() =>
      grid.beginEdit({
        rowId: "data",
        // @ts-expect-error exercises hostile runtime input after the type gate
        columnId: "missing",
        value: "x",
      }),
    ).toThrowError(expect.objectContaining({ code: "invalid-ui-state" }));
    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("wraps hostile snapshot reads and leaves revision publication atomic", () => {
    const { rowModel } = make();
    const sourceState = rowModel.getState();
    const hostileSnapshot = {
      ...sourceState.snapshot,
      indexOf() {
        throw new Error("hostile indexed read");
      },
    };
    const hostileModel = {
      ...rowModel,
      getState: () => ({ ...sourceState, snapshot: hostileSnapshot }),
    } as typeof rowModel;
    const grid = createGridUiCore({
      rowModel: hostileModel,
      columns: visualColumns,
    });
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });
    const before = grid.getState();
    const listener = vi.fn();
    grid.subscribe(listener);

    expect(() => grid.observeRowModelRevision(0)).toThrowError(
      expect.objectContaining({
        code: "row-model-observation-failed",
        cause: expect.objectContaining({ message: "hostile indexed read" }),
      }),
    );
    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("queues reentrant viewport, focus, selection, and edit commands until observation commits", () => {
    const { rowModel } = make();
    const sourceState = rowModel.getState();
    const gridHolder: {
      grid?: PretableGridUiCore<Row, number, typeof modelColumns>;
    } = {};
    let reentered = false;
    const hostileSnapshot = {
      ...sourceState.snapshot,
      indexOf(ref: Parameters<typeof sourceState.snapshot.indexOf>[0]) {
        if (!reentered) {
          reentered = true;
          gridHolder.grid!.setViewport({
            scrollTop: 10,
            scrollLeft: 0,
            width: 800,
            height: 500,
          });
          gridHolder.grid!.setFocus({ ref: null, columnId: null });
          gridHolder.grid!.setSelection({
            rows: { kind: "explicit", rowIds: new Set([1]) },
            ranges: [],
            anchor: null,
          });
          gridHolder.grid!.beginEdit({
            rowId: 1,
            columnId: "quantity",
            value: 2,
          });
        }
        return sourceState.snapshot.indexOf(ref);
      },
    };
    const hostileModel = {
      ...rowModel,
      getState: () => ({ ...sourceState, snapshot: hostileSnapshot }),
    } as typeof rowModel;
    const grid = createGridUiCore({
      rowModel: hostileModel,
      columns: visualColumns,
    });
    gridHolder.grid = grid;
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });
    const publications: Array<{
      readonly revision: number | null;
      readonly scrollTop: number;
      readonly focused: boolean;
      readonly selected: number;
      readonly editing: boolean;
    }> = [];
    grid.subscribe(() => {
      const current = grid.getState();
      publications.push({
        revision: current.observedRowModelRevision,
        scrollTop: current.viewport.scrollTop,
        focused: current.focus.ref !== null,
        selected:
          current.selection.rows.kind === "explicit"
            ? current.selection.rows.rowIds.size
            : -1,
        editing: current.editing !== null,
      });
    });

    grid.observeRowModelRevision(0);

    expect(publications).toEqual([
      { revision: 0, scrollTop: 0, focused: true, selected: 0, editing: false },
      {
        revision: 0,
        scrollTop: 10,
        focused: true,
        selected: 0,
        editing: false,
      },
      {
        revision: 0,
        scrollTop: 10,
        focused: false,
        selected: 0,
        editing: false,
      },
      {
        revision: 0,
        scrollTop: 10,
        focused: false,
        selected: 1,
        editing: false,
      },
      {
        revision: 0,
        scrollTop: 10,
        focused: false,
        selected: 1,
        editing: true,
      },
    ]);
  });

  test("drops reentrant UI commands when hostile reconciliation aborts", () => {
    const { rowModel } = make();
    const sourceState = rowModel.getState();
    const gridHolder: {
      grid?: PretableGridUiCore<Row, number, typeof modelColumns>;
    } = {};
    const hostileSnapshot = {
      ...sourceState.snapshot,
      indexOf() {
        gridHolder.grid!.setViewport({
          scrollTop: 10,
          scrollLeft: 0,
          width: 800,
          height: 500,
        });
        throw new Error("abort projection");
      },
    };
    const hostileModel = {
      ...rowModel,
      getState: () => ({ ...sourceState, snapshot: hostileSnapshot }),
    } as typeof rowModel;
    const grid = createGridUiCore({
      rowModel: hostileModel,
      columns: visualColumns,
    });
    gridHolder.grid = grid;
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });
    const before = grid.getState();
    const listener = vi.fn();
    grid.subscribe(listener);

    expect(() => grid.observeRowModelRevision(0)).toThrowError(
      expect.objectContaining({ code: "row-model-observation-failed" }),
    );
    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("disposal during reconciliation wins and prevents the outer observation commit", () => {
    const { rowModel } = make();
    const sourceState = rowModel.getState();
    const gridHolder: {
      grid?: PretableGridUiCore<Row, number, typeof modelColumns>;
    } = {};
    let disposed = false;
    const hostileSnapshot = {
      ...sourceState.snapshot,
      indexOf(ref: Parameters<typeof sourceState.snapshot.indexOf>[0]) {
        if (!disposed) {
          disposed = true;
          gridHolder.grid!.dispose();
        }
        return sourceState.snapshot.indexOf(ref);
      },
    };
    const hostileModel = {
      ...rowModel,
      getState: () => ({ ...sourceState, snapshot: hostileSnapshot }),
    } as typeof rowModel;
    const grid = createGridUiCore({
      rowModel: hostileModel,
      columns: visualColumns,
    });
    gridHolder.grid = grid;
    grid.setFocus({ ref: { kind: "data", rowId: 1 }, columnId: "name" });
    const before = grid.getState();
    const listener = vi.fn();
    grid.subscribe(listener);

    expect(() => grid.observeRowModelRevision(0)).not.toThrow();
    expect(grid.getState()).toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(() =>
      grid.setViewport({ ...grid.getState().viewport, scrollTop: 1 }),
    ).toThrowError(expect.objectContaining({ code: "disposed-grid-ui" }));
  });

  test("wraps a throwing snapshot revision getter without publishing", () => {
    const { rowModel } = make();
    const sourceState = rowModel.getState();
    const hostileSnapshot = { ...sourceState.snapshot };
    Object.defineProperty(hostileSnapshot, "revision", {
      get() {
        throw new Error("hostile revision");
      },
    });
    const hostileModel = {
      ...rowModel,
      getState: () => ({ ...sourceState, snapshot: hostileSnapshot }),
    } as typeof rowModel;
    const grid = createGridUiCore({
      rowModel: hostileModel,
      columns: visualColumns,
    });
    const before = grid.getState();
    const listener = vi.fn();
    grid.subscribe(listener);

    expect(() => grid.observeRowModelRevision(0)).toThrowError(
      expect.objectContaining({
        code: "row-model-observation-failed",
        cause: expect.objectContaining({ message: "hostile revision" }),
      }),
    );
    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  test("wraps nearest-visible and navigation failures without partial publication", () => {
    const { rowModel } = make();
    const sourceState = rowModel.getState();
    const nearestHostile = {
      ...sourceState.snapshot,
      indexOf: () => -1,
      nearestVisibleRef() {
        throw new Error("hostile nearest");
      },
    };
    const nearestModel = {
      ...rowModel,
      getState: () => ({ ...sourceState, snapshot: nearestHostile }),
    } as typeof rowModel;
    const nearestGrid = createGridUiCore({
      rowModel: nearestModel,
      columns: visualColumns,
    });
    nearestGrid.setFocus({
      ref: { kind: "data", rowId: 999 },
      columnId: "name",
    });
    const nearestBefore = nearestGrid.getState();
    expect(() => nearestGrid.observeRowModelRevision(0)).toThrowError(
      expect.objectContaining({
        code: "row-model-observation-failed",
        cause: expect.objectContaining({ message: "hostile nearest" }),
      }),
    );
    expect(nearestGrid.getState()).toBe(nearestBefore);

    const navigationHostile = {
      ...sourceState.snapshot,
      rowAt() {
        throw new Error("hostile navigation");
      },
    };
    const navigationModel = {
      ...rowModel,
      getState: () => ({ ...sourceState, snapshot: navigationHostile }),
    } as typeof rowModel;
    const navigationGrid = createGridUiCore({
      rowModel: navigationModel,
      columns: visualColumns,
    });
    navigationGrid.observeRowModelRevision(0);
    const navigationBefore = navigationGrid.getState();
    const listener = vi.fn();
    navigationGrid.subscribe(listener);

    expect(() => navigationGrid.moveFocus("down")).toThrowError(
      expect.objectContaining({
        code: "row-model-observation-failed",
        cause: expect.objectContaining({ message: "hostile navigation" }),
      }),
    );
    expect(navigationGrid.getState()).toBe(navigationBefore);
    expect(listener).not.toHaveBeenCalled();
  });

  test("rejects a model snapshot that changes before observation assignment", () => {
    const firstModel = createLocalRowModel({
      rows: [{ id: 1, name: "one", quantity: 1 }],
      columns: modelColumns,
    });
    const secondModel = createLocalRowModel({
      rows: [{ id: 2, name: "two", quantity: 2 }],
      columns: modelColumns,
    });
    const firstState = firstModel.getState();
    const secondState = secondModel.getState();
    let reads = 0;
    const changingModel = {
      ...firstModel,
      getState: () => (reads++ === 0 ? firstState : secondState),
    } as typeof firstModel;
    const grid = createGridUiCore({
      rowModel: changingModel,
      columns: visualColumns,
    });
    const before = grid.getState();
    const listener = vi.fn();
    grid.subscribe(listener);

    expect(() => grid.observeRowModelRevision(0)).toThrowError(
      expect.objectContaining({ code: "row-model-observation-failed" }),
    );
    expect(grid.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });
});
