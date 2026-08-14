import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableRowModel,
  type PretableRowModelSnapshot,
} from "@pretable-internal/row-model";

import { createGridUiCore } from "../create-grid-ui-core";
import {
  describeRowSelection,
  getIndexedRowSelectionProgramDiagnostics,
} from "../indexed-selection";

/**
 * `setRowSelection` is the write side of the row-checkbox slice.
 *
 * Before it, the slice was engine-owned and one-way: `toggleRowSelection` and
 * `selectRowRange` could move it from a gesture, `getState().selection.rows`
 * and `onRowSelectionChange` could read it, and nothing could SET it. There was
 * no "restore what the user had", no "tick everything matching this filter",
 * no undo. `setSelection` looks like it should do the job and cannot: it takes
 * the engine's own containers — a `ReadonlySet` and an opaque normalized
 * interval index — which no consumer can construct.
 *
 * The property every test here is really guarding is that the SPARSENESS
 * survives the new boundary. A settable slice that had to be spelled out as a
 * list of row ids would make select-all over a million rows cost a million
 * ids, which is exactly what the engine's symbolic representation exists to
 * avoid.
 */

interface Row {
  readonly id: number;
  readonly name: string;
}

const helper = createColumnHelper<Row>();
const modelColumns = [helper.accessor("name", { type: "text" })] as const;
const visualColumns = [{ id: "name", widthPx: 180 }] as const;

/**
 * Shared across the large-population tests. Building half a million rows twice
 * in one test is slower than everything under test put together, and a timeout
 * spent in `Array.from` would read as though the selection work were the slow
 * part.
 */
let bigRows: Row[] | undefined;

function makeRows(count: number): Row[] {
  if (count < 100_000) {
    return Array.from({ length: count }, (_, index) => ({
      id: index,
      name: `row ${index}`,
    }));
  }
  bigRows ??= Array.from({ length: 500_000 }, (_, index) => ({
    id: index,
    name: `row ${index}`,
  }));
  return bigRows.slice(0, count);
}

function make(count = 5) {
  const rowModel = createLocalRowModel({
    rows: makeRows(count),
    columns: modelColumns,
  });
  return {
    rowModel,
    grid: createGridUiCore({ rowModel, columns: visualColumns }),
  };
}

/**
 * Counts ROWS visited through the snapshot, not calls made to it.
 *
 * Rows rather than calls because the cheapest way to materialize a population
 * is one unbounded `range(0, n)`, which is a single call and half a million
 * rows. Every other door — `dataRowAt`, `dataIndexOf`, the cursor moves — is
 * one row each, so the two are commensurable and the total is a count of how
 * much of the population the operation actually looked at. That is a claim
 * about the algorithm rather than about how fast this machine is today.
 */
function countRowVisits<TColumns>(
  rowModel: PretableRowModel<Row, number, TColumns>,
) {
  let visited = 0;
  let sourceState = rowModel.getState();
  let wrapped: typeof sourceState | undefined;
  const wrapState = () => {
    const state = rowModel.getState();
    if (state === sourceState && wrapped !== undefined) return wrapped;
    sourceState = state;
    const snapshot: PretableRowModelSnapshot<Row, number, TColumns> =
      state.snapshot;
    const perRow =
      <TArgs extends unknown[], TResult>(
        operation: (...args: TArgs) => TResult,
      ) =>
      (...args: TArgs): TResult => {
        visited += 1;
        return operation.apply(snapshot, args);
      };
    wrapped = {
      ...state,
      snapshot: {
        ...snapshot,
        revision: snapshot.revision,
        sourceRowCount: snapshot.sourceRowCount,
        visibleRowCount: snapshot.visibleRowCount,
        visibleDataRowCount: snapshot.visibleDataRowCount,
        query: snapshot.query,
        expansion: snapshot.expansion,
        rowAt: perRow(snapshot.rowAt),
        range: (start: number, end: number) => {
          visited += Math.max(0, end - start);
          return snapshot.range(start, end);
        },
        indexOf: perRow(snapshot.indexOf),
        dataIndexOf: perRow(snapshot.dataIndexOf),
        dataRowAt: perRow(snapshot.dataRowAt),
        firstDataRow: perRow(snapshot.firstDataRow),
        lastDataRow: perRow(snapshot.lastDataRow),
        nextDataRow: perRow(snapshot.nextDataRow),
        previousDataRow: perRow(snapshot.previousDataRow),
        parentGroupOf: perRow(snapshot.parentGroupOf),
        nearestVisibleRef: perRow(snapshot.nearestVisibleRef),
        isGroupExpanded: perRow(snapshot.isGroupExpanded),
      },
    };
    return wrapped;
  };
  const bound = new Map<PropertyKey, unknown>();
  const spy = new Proxy(rowModel, {
    get(target, key) {
      if (key === "getState") return wrapState;
      if (bound.has(key)) return bound.get(key);
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      const fn = value.bind(target);
      bound.set(key, fn);
      return fn;
    },
  });
  return {
    model: spy,
    reset: () => {
      visited = 0;
    },
    visited: () => visited,
  };
}

describe("setRowSelection", () => {
  test("ticks the rows a consumer names, which nothing could do before", () => {
    const { grid } = make();

    grid.setRowSelection({ kind: "explicit", rowIds: [1, 3] });

    expect(grid.isRowSelected(1)).toBe(true);
    expect(grid.isRowSelected(3)).toBe(true);
    expect(grid.isRowSelected(0)).toBe(false);
    expect(grid.getSelectionSummary().selectedCount).toBe(2);
  });

  test("replacing the slice unticks what it does not name", () => {
    // The positive twin above proves ticking. Without this one, an
    // implementation that only ever ADDS would pass everything else here.
    const { grid } = make();
    grid.setRowSelection({ kind: "explicit", rowIds: [1, 3] });

    grid.setRowSelection({ kind: "explicit", rowIds: [0] });

    expect(grid.isRowSelected(0)).toBe(true);
    expect(grid.isRowSelected(1)).toBe(false);
    expect(grid.isRowSelected(3)).toBe(false);
  });

  test("leaves the cell-range slice alone", () => {
    const { grid } = make();
    grid.setSelection({
      rows: grid.getState().selection.rows,
      ranges: [
        {
          start: { rowId: 0, columnId: "name" },
          end: { rowId: 2, columnId: "name" },
        },
      ],
      anchor: { rowId: 0, columnId: "name" },
    });

    grid.setRowSelection({ kind: "explicit", rowIds: [4] });

    expect(grid.getState().selection.ranges).toHaveLength(1);
    expect(grid.getState().selection.anchor).toEqual({
      rowId: 0,
      columnId: "name",
    });
  });

  test("a repeated row id ticks the row rather than cancelling itself", () => {
    // The slice is built out of the same TOGGLE the checkbox uses, so a
    // duplicate id is the obvious way for it to silently untick.
    const { grid } = make();

    grid.setRowSelection({ kind: "explicit", rowIds: [2, 2] });

    expect(grid.isRowSelected(2)).toBe(true);
  });

  test("keeps a span symbolic instead of expanding it", () => {
    const { grid } = make(100_000);

    grid.setRowSelection({
      kind: "explicit",
      rowIds: [],
      ranges: [{ startRowId: 10, endRowId: 99_999 }],
    });

    const rows = grid.getState().selection.rows;
    if (rows.kind !== "explicit") throw new Error("expected explicit");
    expect(rows.rowIds.size).toBe(0);
    expect([...(rows.ranges ?? [])]).toEqual([
      { startRowId: 10, endRowId: 99_999 },
    ]);
    expect(grid.isRowSelected(9)).toBe(false);
    expect(grid.isRowSelected(10)).toBe(true);
    expect(grid.isRowSelected(99_999)).toBe(true);
    expect(grid.getSelectionSummary().selectedCount).toBe(99_990);
  }, 30_000);

  test("excludes named rows from a symbolic all", () => {
    const { grid } = make();

    grid.setRowSelection({ kind: "all", excludedRowIds: [2] });

    expect(grid.getState().selection.rows.kind).toBe("all");
    expect(grid.isRowSelected(2)).toBe(false);
    expect(grid.isRowSelected(1)).toBe(true);
    expect(grid.getSelectionSummary().selectedCount).toBe(4);
  });

  test("excluding a row that was never selected does not select it", () => {
    // `excludedRowIds` is applied by toggling, and a toggle on an unselected
    // row SELECTS it. "Everything except row 4" would have quietly become
    // "row 4" for an explicit request that did not cover it.
    const { grid } = make();

    grid.setRowSelection({
      kind: "explicit",
      rowIds: [1],
      excludedRowIds: [4],
    });

    expect(grid.isRowSelected(1)).toBe(true);
    expect(grid.isRowSelected(4)).toBe(false);
    expect(grid.getSelectionSummary().selectedCount).toBe(1);
  });

  test("drops ids the current snapshot does not show", async () => {
    const { grid, rowModel } = make();
    await rowModel.setQuery({
      filters: [{ columnId: "name", operator: "equals", value: "row 1" }],
      sort: [],
      rowGroups: [],
    }).finished;
    expect(rowModel.getState().snapshot.visibleDataRowCount).toBe(1);

    grid.setRowSelection({ kind: "explicit", rowIds: [0, 1] });

    expect(grid.isRowSelected(1)).toBe(true);
    expect(grid.getSelectionSummary().selectedCount).toBe(1);
  });

  test("applying a value the slice already holds publishes nothing", () => {
    // The idempotence a controlled caller needs. `sameSelection` cannot answer
    // this — it compares semantic HISTORIES, and a rebuilt slice never shares
    // one — so without a value-level check a controlled consumer pushing on
    // each render would publish forever.
    const { grid } = make();
    grid.setRowSelection({ kind: "explicit", rowIds: [1, 3] });
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setRowSelection({ kind: "explicit", rowIds: [1, 3] });
    grid.setRowSelection({ kind: "explicit", rowIds: [3, 1] });

    expect(listener).not.toHaveBeenCalled();

    // The positive twin: a value that IS different still publishes, so the
    // silence above is idempotence rather than a dead command.
    grid.setRowSelection({ kind: "explicit", rowIds: [1] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test("changing only the exclusions still applies", () => {
    // The idempotence check has to look at the exclusions too. Two symbolic
    // "all"s differing only in what they exclude are the same `kind` and carry
    // no `rowIds` between them, so a comparison that stops at those two fields
    // calls them equal and quietly refuses to un-exclude anything.
    const { grid } = make();
    grid.setRowSelection({ kind: "all", excludedRowIds: [2] });
    expect(grid.isRowSelected(2)).toBe(false);

    grid.setRowSelection({ kind: "all" });

    expect(grid.isRowSelected(2)).toBe(true);
    expect(grid.getSelectionSummary().selectedCount).toBe(5);
  });

  test("an explicit list of every id is not the same value as a symbolic all", () => {
    // Both tick every row, and the idempotence check must still tell them
    // apart: only one of them keeps ticking rows that arrive later.
    const { grid } = make(3);
    grid.setRowSelection({ kind: "all" });
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.setRowSelection({ kind: "explicit", rowIds: [0, 1, 2] });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(grid.getState().selection.rows.kind).toBe("explicit");
  });
});

describe("a symbolic select-all stays O(1)", () => {
  test("records one run and no per-row rules over 500k rows", () => {
    const { grid } = make(500_000);

    grid.setRowSelection({ kind: "all" });

    const rows = grid.getState().selection.rows;
    expect(rows.kind).toBe("all");
    // The load-bearing assertion: the whole 500k population is one compressed
    // run and zero per-row rules. A materializing implementation would show
    // 500k point rules, or 500k runs, or both.
    expect(getIndexedRowSelectionProgramDiagnostics(rows)).toEqual({
      pointRuleCount: 0,
      rangeRuleCount: 0,
      snapshotBasisCount: 0,
      projectionRunCount: 1,
    });
    // ...and it MEANS everything, rather than being cheap by being empty.
    expect(grid.getSelectionSummary()).toEqual({
      state: "all",
      selectedCount: 500_000,
      visibleCount: 500_000,
    });
  }, 30_000);

  test("visits none of the population to apply it", () => {
    const rowModel = createLocalRowModel({
      rows: makeRows(500_000),
      columns: modelColumns,
    });
    const counted = countRowVisits(rowModel);
    const grid = createGridUiCore({
      rowModel: counted.model,
      columns: visualColumns,
    });
    counted.reset();

    grid.setRowSelection({ kind: "all" });

    // A handful of bookkeeping rows is fine; anything proportional to the
    // population is the failure this is watching for. 500k rows, under 64
    // visited — and the summary below proves the cheapness is not emptiness.
    expect(counted.visited()).toBeLessThan(64);
    expect(grid.getSelectionSummary().selectedCount).toBe(500_000);
  }, 30_000);

  test("stays symbolic through the describe/re-apply round trip", () => {
    const { grid } = make(500_000);
    grid.setRowSelection({ kind: "all", excludedRowIds: [7] });

    const described = describeRowSelection(grid.getState().selection.rows);
    expect(described).toEqual({ kind: "all", excludedRowIds: [7] });

    const replay = make(500_000);
    replay.grid.setRowSelection(described);

    expect(replay.grid.getState().selection.rows.kind).toBe("all");
    expect(replay.grid.getSelectionSummary().selectedCount).toBe(499_999);
    expect(replay.grid.isRowSelected(7)).toBe(false);
  }, 30_000);
});

describe("describeRowSelection", () => {
  test("round-trips an explicit selection", () => {
    const { grid } = make();
    grid.toggleRowSelection(1);
    grid.toggleRowSelection(3);

    expect(describeRowSelection(grid.getState().selection.rows)).toEqual({
      kind: "explicit",
      rowIds: [1, 3],
    });
  });

  test("round-trips a shift-checked span as its endpoints", () => {
    const { grid } = make(100_000);
    grid.toggleRowSelection(0);
    grid.selectRowRange(0, 99_999);

    const described = describeRowSelection(grid.getState().selection.rows);

    expect(described).toEqual({
      kind: "explicit",
      rowIds: [0],
      ranges: [{ startRowId: 0, endRowId: 99_999 }],
    });
  });

  test("omits the empty containers rather than printing them", () => {
    const { grid } = make();

    expect(describeRowSelection(grid.getState().selection.rows)).toEqual({
      kind: "explicit",
      rowIds: [],
    });
  });
});
