import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
} from "@pretable-internal/row-model";

import { createGridUiCore, PretableGridUiError } from "../create-grid-ui-core";
import { getIndexedRowSelectionProgramDiagnostics } from "../indexed-selection";
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
      "columnAggregates",
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

  test("publishes one atomic wake for symbolic row-range selection", () => {
    const rowModel = createLocalRowModel({
      rows: [
        { id: 1, name: "one", quantity: 1 },
        { id: 2, name: "two", quantity: 2 },
        { id: 3, name: "three", quantity: 3 },
      ],
      columns: modelColumns,
    });
    const grid = createGridUiCore({ rowModel, columns: visualColumns });
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.selectRowRange(1, 3);

    expect(listener).toHaveBeenCalledTimes(1);
    const selectedRows = grid.getState().selection.rows;
    expect(selectedRows.kind).toBe("explicit");
    if (selectedRows.kind !== "explicit") throw new Error("expected explicit");
    expect(Array.from(selectedRows.ranges ?? [])).toEqual([
      { startRowId: 1, endRowId: 3 },
    ]);
  });

  test("normalizes an externally supplied structural selection even when its public range is unchanged", () => {
    const rows = [
      { id: 1, name: "one", quantity: 1 },
      { id: 2, name: "two", quantity: 2 },
      { id: 3, name: "three", quantity: 3 },
      { id: 4, name: "four", quantity: 4 },
    ];
    const rowModel = createLocalRowModel({ rows, columns: modelColumns });
    const grid = createGridUiCore({ rowModel, columns: visualColumns });
    grid.selectRowRange(1, 3);

    rowModel.setRows([rows[0]!, rows[3]!, rows[2]!, rows[1]!]);
    grid.observeRowModelRevision(1);
    expect(grid.isRowSelected(2)).toBe(true);
    expect(grid.isRowSelected(4)).toBe(false);

    const current = grid.getState().selection;
    if (current.rows.kind !== "explicit")
      throw new Error("expected explicit selection");
    grid.setSelection({
      rows: {
        kind: "explicit",
        rowIds: new Set(current.rows.rowIds),
        ranges: current.rows.ranges,
      },
      ranges: [],
      anchor: null,
    });

    expect(grid.isRowSelected(2)).toBe(false);
    expect(grid.isRowSelected(4)).toBe(true);
  });

  test("releases semantic selection snapshot bases when disposed", () => {
    const rowModel = createLocalRowModel({
      rows: [
        { id: 1, name: "one", quantity: 1 },
        { id: 2, name: "two", quantity: 2 },
      ],
      columns: modelColumns,
    });
    const grid = createGridUiCore({ rowModel, columns: visualColumns });
    grid.selectRowRange(1, 2);
    expect(
      getIndexedRowSelectionProgramDiagnostics(grid.getState().selection.rows)
        .snapshotBasisCount,
    ).toBe(1);

    grid.dispose();

    expect(
      getIndexedRowSelectionProgramDiagnostics(grid.getState().selection.rows),
    ).toMatchObject({
      pointRuleCount: 0,
      rangeRuleCount: 0,
      snapshotBasisCount: 0,
    });
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

  test("re-setting the same header address publishes nothing", () => {
    // `sameRef` is a chain of `kind === "data"` / `kind === "group"` tests, not
    // an exhaustive switch, so widening the union with `{kind: "header"}` did
    // not make the compiler say a word — it just made two header refs compare
    // UNEQUAL. Every no-op `setFocus` would then publish, and the surface
    // re-renders on each one: an arrow key that moved nothing would still cost
    // a full render of every cell.
    const { grid } = make();
    grid.observeRowModelRevision(0);
    grid.setFocus({ ref: { kind: "header" }, columnId: "name" });
    const listener = vi.fn();
    grid.subscribe(listener);

    // A DIFFERENT object with the same shape — identity equality would pass
    // this vacuously, since the engine hands out one frozen header ref.
    grid.setFocus({ ref: { kind: "header" }, columnId: "name" });
    expect(listener).not.toHaveBeenCalled();

    // The positive twin: a real move still publishes, so the test above is
    // not just asserting that `setFocus` is broken.
    grid.setFocus({ ref: { kind: "header" }, columnId: "quantity" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState().focus).toEqual({
      ref: { kind: "header" },
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

  /**
   * A grid whose consumer serves a moving WINDOW over `all`, exactly as the
   * windowed-data contract describes: `setRows` gets the loaded slice and
   * `getWindowing` reports where that slice sits in the dataset.
   *
   * Every eviction test below drives gestures through the real store rather
   * than calling `reconcileIndexedSelection` with a hand-built fixture. That
   * distinction is the point: a fixture can hold the whole dataset resident,
   * and a selection built by a gesture never carries a span at all until
   * something stamps one.
   */
  function windowedGrid(total: number) {
    const all = Array.from({ length: total }, (_, id) => ({
      id,
      name: `row-${id}`,
      quantity: id,
    }));
    let selectionWindow: {
      readonly start: number;
      readonly length: number;
      readonly datasetKey?: string;
      readonly datasetTotal: number;
    } | null = null;
    const rowModel = createLocalRowModel({ rows: [], columns: modelColumns });
    const grid = createGridUiCore({
      rowModel,
      columns: visualColumns,
      // Windowed throughout: `windowing` is non-null even before the first
      // slide, when the window itself is still unknown.
      getWindowing: () => ({ window: selectionWindow }),
    });
    // A published `datasetKey` by default: spans are fail-closed on it (see
    // `spanReadableInWindow`), so a windowed consumer that never sets one
    // gets no span survival at all -- which is a real configuration, pinned
    // in `indexed-selection.test.ts`, but not the one these tests are about.
    const slideTo = (
      start: number,
      length: number,
      datasetKey = "population-1",
    ) => {
      rowModel.setRows(all.slice(start, start + length));
      // `total`, not `length`: the population is the whole of `all`, and the
      // window is a slice of it. Publishing the slice's own size here would
      // make every slide look like a population change.
      selectionWindow = { start, length, datasetKey, datasetTotal: total };
      grid.observeRowModelRevision(rowModel.getState().snapshot.revision);
    };
    /** The shape every surface gesture builds: a fresh range, ids only. */
    const selectCells = (startRowId: number, endRowId: number) => {
      grid.setSelection({
        ...grid.getState().selection,
        ranges: [
          {
            start: { rowId: startRowId, columnId: "name" },
            end: { rowId: endRowId, columnId: "quantity" },
          },
        ],
        anchor: { rowId: startRowId, columnId: "name" },
      });
    };
    return { grid, rowModel, slideTo, selectCells };
  }

  test("a shift-click extension from an EVICTED anchor keeps its dataset span", () => {
    // Gesture (1) from the review: the surface's shift branch calls
    // `extendRangeFromAnchor`, which builds a BRAND-NEW range object from the
    // anchor to the clicked cell. If the span only ever gets stamped by
    // reconciliation while both endpoints happen to be loaded, this range is
    // born spanless and a genuine 131-row selection reports 1.
    const { grid, slideTo, selectCells } = windowedGrid(200);
    slideTo(0, 100);

    selectCells(10, 90);
    expect(grid.getCellSelectionSummary()).toEqual({
      rowCount: 81,
      verified: true,
    });

    // Scroll on: row 10 evicts, row 90 does not.
    slideTo(50, 100);
    expect(grid.getCellSelectionSummary()).toEqual({
      rowCount: 81,
      verified: false,
    });

    // Shift-click row 140. The anchor (row 10) is not loaded, so its position
    // has to come from the selection that already holds it.
    selectCells(10, 140);
    expect(grid.getCellSelectionSummary()).toEqual({
      rowCount: 131,
      verified: false,
    });
  });

  test("an unrelated cmd-click does not un-count the retained ranges", () => {
    // Gesture (5): `copySelection` runs on the ONLY public write path, so any
    // later gesture rebuilding the range list is where every retained span
    // silently dies -- including the ranges the gesture never touched.
    const { grid, slideTo, selectCells } = windowedGrid(200);
    slideTo(0, 100);
    selectCells(10, 90);
    slideTo(50, 100);

    const retained = grid.getState().selection;
    grid.setSelection({
      ...retained,
      ranges: [
        ...retained.ranges,
        {
          start: { rowId: 60, columnId: "name" },
          end: { rowId: 60, columnId: "name" },
        },
      ],
      anchor: { rowId: 60, columnId: "name" },
    });

    // 10..90 already covers 60, so the union is unchanged at 81. A dropped
    // span would leave only the cmd-clicked cell and report 1.
    expect(grid.getCellSelectionSummary().rowCount).toBe(81);
  });

  test("a select-all-shaped range covers the LOADED window, and says so", () => {
    // The pinned decision. `selectAll` builds its range from `dataRowAt(0)`
    // and `dataRowAt(visibleDataRowCount - 1)` -- the first and last LOADED
    // rows, not the first and last rows of the dataset. That stays true: a
    // cell range is identified by its two endpoint row IDs, and the engine
    // cannot name a row it has never loaded. Widening the span behind loaded
    // IDs would also be undone the moment both IDs resolve again, because a
    // span whose endpoints are both present is re-derived from them.
    const { grid, slideTo } = windowedGrid(200);
    slideTo(50, 100);
    const snapshot = grid.rowModel.getState().snapshot;
    const first = snapshot.dataRowAt(0);
    const last = snapshot.dataRowAt(snapshot.visibleDataRowCount - 1);
    if (first === undefined || last === undefined) throw new Error("no rows");

    grid.setSelection({
      ...grid.getState().selection,
      ranges: [
        {
          start: { rowId: first.rowId, columnId: "name" },
          end: { rowId: last.rowId, columnId: "quantity" },
        },
      ],
      anchor: { rowId: first.rowId, columnId: "name" },
    });

    expect(grid.getCellSelectionSummary()).toEqual({
      rowCount: 100,
      verified: true,
    });
  });

  test("the cursor survives its row being evicted, and comes back with it", () => {
    // The WIRING, not the rule: `reconcileIndexedFocus` is given the same
    // window and the same `previous` pairing the selection gets, from the same
    // two reads in `observeRowModelRevision`. Its own unit tests can pass with
    // the store still calling it two-argument, which is how a cursor that
    // survives in the engine still jumps in the product.
    const { grid, slideTo } = windowedGrid(200);
    slideTo(0, 100);
    grid.setFocus({ ref: { kind: "data", rowId: 10 }, columnId: "name" });
    const focused = grid.getState().focus;
    expect(focused).toEqual({
      ref: { kind: "data", rowId: 10 },
      columnId: "name",
    });

    // Row 10 is released -- and, crucially, the row model cannot tell that
    // apart from a delete on its own.
    slideTo(120, 40);
    expect(
      grid.rowModel.getState().snapshot.indexOf({ kind: "data", rowId: 10 }),
    ).toBe(-1);
    expect(grid.getState().focus).toEqual(focused);

    // ...and when the rows come back, the cursor is still on the cell the
    // user left it on, not on whatever the viewport happens to show.
    slideTo(0, 100);
    expect(grid.getState().focus).toEqual(focused);
  });

  test("an arrow key pressed while the cursor's row is evicted does not lose it", () => {
    // The other half of the same WIRING. `moveFocus` reconciles too, and it
    // reconciled two-argument -- so the cursor the test above proves survives a
    // revision was dropped by the very next keystroke, which is the state a
    // real user is in: they scrolled away, then pressed a key.
    const { grid, slideTo } = windowedGrid(200);
    slideTo(0, 100);
    grid.setFocus({ ref: { kind: "data", rowId: 10 }, columnId: "name" });
    const focused = grid.getState().focus;

    // The control, from the same grid and the same window: with the row
    // loaded, ArrowDown still moves. Without it, "hold the cursor" could be
    // "the keyboard does nothing in a windowed grid".
    grid.moveFocus("down");
    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: 11 },
      columnId: "name",
    });
    grid.setFocus(focused);

    slideTo(120, 40);
    expect(
      grid.rowModel.getState().snapshot.indexOf({ kind: "data", rowId: 10 }),
    ).toBe(-1);

    grid.moveFocus("down");
    expect(grid.getState().focus).toEqual(focused);
    // ...and the column axis still answers, because it never needed the row.
    grid.moveFocus("right");
    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: 10 },
      columnId: "quantity",
    });

    // Back into the window: the cursor is where the user left it, one column
    // over, and moves normally again.
    slideTo(0, 100);
    grid.moveFocus("down");
    expect(grid.getState().focus).toEqual({
      ref: { kind: "data", rowId: 11 },
      columnId: "quantity",
    });
  });

  test("a cursor on a row deleted under a standing window still gives way", () => {
    // The positive twin, through the store: same gesture, same window, but the
    // row is genuinely removed while the window stays put over its position.
    // Without this, "the cursor survives eviction" could be implemented as
    // "the cursor never moves", which would leave it on a row that is gone.
    const rowModel = createLocalRowModel({
      rows: Array.from({ length: 100 }, (_, id) => ({
        id,
        name: `row-${id}`,
        quantity: id,
      })),
      columns: modelColumns,
    });
    let length = 100;
    const grid = createGridUiCore({
      rowModel,
      columns: visualColumns,
      getWindowing: () => ({
        window: {
          start: 0,
          length,
          datasetKey: "population-1",
          // The whole dataset is resident here, so the population size and
          // the window length are the same number -- and a deletion moves
          // both, which is what makes the narrowing below provable.
          datasetTotal: length,
        },
      }),
    });
    grid.observeRowModelRevision(rowModel.getState().snapshot.revision);
    grid.setFocus({ ref: { kind: "data", rowId: 10 }, columnId: "name" });

    rowModel.applyTransaction({ remove: [10] });
    length = 99;
    grid.observeRowModelRevision(rowModel.getState().snapshot.revision);

    expect(grid.getState().focus).toEqual({ ref: null, columnId: null });
  });

  test("a datasetKey change drops spans rather than repainting their old positions", () => {
    const { grid, slideTo, selectCells } = windowedGrid(200);
    slideTo(0, 100, "sort=name");
    selectCells(10, 90);
    expect(grid.getCellSelectionSummary().rowCount).toBe(81);

    slideTo(120, 40, "sort=quantity");

    expect(grid.getState().selection.ranges).toEqual([]);
    expect(grid.getCellSelectionSummary()).toEqual({
      rowCount: 0,
      verified: true,
    });
  });

  test("a span change alone counts as a selection change", () => {
    // `sameSelection` compares ranges endpoint by endpoint. Once the span is
    // part of a range's identity -- which is the whole point of storing
    // dataset positions -- two selections that differ only in their spans are
    // different selections, and the store must publish rather than keep the
    // stale one. Pinned in both directions so neither half can rot.
    const { grid, slideTo, selectCells } = windowedGrid(200);
    slideTo(0, 100);
    selectCells(10, 90);
    // Both endpoints evicted, so the span is the only thing that still says
    // how big this selection is; nothing can re-derive it from the snapshot.
    slideTo(150, 50);
    const stamped = grid.getState();
    const range = {
      start: { rowId: 10, columnId: "name" as const },
      end: { rowId: 90, columnId: "quantity" as const },
    };

    // Identical ids, and a span recovered to the identical value: the
    // controlled-`state` echo every render must stay a stable no-op.
    grid.setSelection({
      ...stamped.selection,
      ranges: [range],
      anchor: { rowId: 10, columnId: "name" },
    });
    expect(grid.getState()).toBe(stamped);

    // Same ids, a span that says something else: not the same selection.
    grid.setSelection({
      ...stamped.selection,
      ranges: [
        {
          ...range,
          // Keyed to the window's population, or it would be refused rather
          // than read -- see `spanReadableInWindow`.
          datasetRowSpan: {
            start: 10,
            end: 40,
            datasetKey: "population-1",
            datasetTotal: 200,
          },
        },
      ],
      anchor: { rowId: 10, columnId: "name" },
    });
    expect(grid.getState()).not.toBe(stamped);
    expect(grid.getCellSelectionSummary().rowCount).toBe(31);
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
