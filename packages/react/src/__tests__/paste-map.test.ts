import { describe, expect, it, vi } from "vitest";

import { ROW_SELECT_COLUMN_ID } from "../constants";
import { mapPasteToTargets } from "../paste";
import {
  createColumnHelper,
  createLocalRowModel,
  type PretableRowModelSnapshot,
  type PretableVisibleRowRef,
} from "@pretable/core";
import type { PretableColumn } from "../types";

type Row = {
  id: string;
  group: string;
  a: string;
  b: string;
  c: string;
  d: string;
};

const rows: Row[] = ["r0", "r1", "r2", "r3", "r4"].map((id) => ({
  id,
  group: id === "r0" || id === "r1" ? "x" : "y",
  a: `${id}a`,
  b: `${id}b`,
  c: `${id}c`,
  d: `${id}d`,
}));

const modelColumn = createColumnHelper<Row>();
const modelColumns = [
  modelColumn.accessor("group", { type: "text" }),
  modelColumn.accessor("a", { type: "text" }),
  modelColumn.accessor("b", { type: "text" }),
  modelColumn.accessor("c", { type: "text" }),
  modelColumn.accessor("d", { type: "text" }),
] as const;

function makeRowModelSnapshot(
  sourceRows: readonly Row[],
): PretableRowModelSnapshot<Row, string, typeof modelColumns> {
  return createLocalRowModel({
    rows: sourceRows,
    columns: modelColumns,
  }).getState().snapshot;
}

const rowModelSnapshot = makeRowModelSnapshot(rows);

// The synthetic row-select column is first in effectiveColumns, exactly as the
// surface passes it in — every assertion below must be blind to it.
const columns: PretableColumn<Row>[] = [
  { id: ROW_SELECT_COLUMN_ID },
  { id: "a" },
  { id: "b" },
  { id: "c" },
  { id: "d" },
];

function map(
  matrix: string[][],
  rowId: string,
  columnId: string,
  selectionSize = { rows: 1, columns: 1 },
) {
  return mapPasteToTargets({
    matrix,
    anchor: { ref: { kind: "data", rowId }, columnId },
    selectionSize,
    rowModelSnapshot,
    columns,
  });
}

/** Compact `rowId:columnId=raw` form so expectations stay readable. */
function shape(result: {
  cells: { rowId: string; columnId: string; raw: string }[];
}) {
  return result.cells.map((c) => `${c.rowId}:${c.columnId}=${c.raw}`);
}

describe("mapPasteToTargets — anchor", () => {
  it("writes a 2x2 block down/right from a single selected cell", () => {
    const result = map(
      [
        ["1", "2"],
        ["3", "4"],
      ],
      "r1",
      "b",
    );
    expect(shape(result)).toEqual(["r1:b=1", "r1:c=2", "r2:b=3", "r2:c=4"]);
    expect(result.clipped).toEqual({ rows: 0, columns: 0 });
  });

  it("writes a single cell", () => {
    const result = map([["x"]], "r0", "a");
    expect(shape(result)).toEqual(["r0:a=x"]);
  });

  it("walks only the output data-row span", () => {
    const nextDataRow = vi.fn(
      rowModelSnapshot.nextDataRow.bind(rowModelSnapshot),
    );
    const guardedSnapshot = {
      ...rowModelSnapshot,
      nextDataRow,
      range: () => {
        throw new Error("paste must not request a visible-row range");
      },
    };
    const result = mapPasteToTargets({
      matrix: [["1"], ["2"]],
      anchor: { ref: { kind: "data", rowId: "r1" }, columnId: "a" },
      selectionSize: { rows: 1, columns: 1 },
      rowModelSnapshot: guardedSnapshot,
      columns,
    });

    expect(shape(result)).toEqual(["r1:a=1", "r2:a=2"]);
    expect(nextDataRow).toHaveBeenCalledOnce();
  });

  it("returns nothing for an empty matrix", () => {
    const result = map([], "r0", "a");
    expect(result.cells).toEqual([]);
    expect(result.clipped).toEqual({ rows: 0, columns: 0 });
  });

  it("returns nothing when the anchor row is not visible", () => {
    const result = map([["x"]], "nope", "a");
    expect(result.cells).toEqual([]);
  });

  it("returns nothing when the anchor column is unknown", () => {
    const result = map([["x"]], "r0", "nope");
    expect(result.cells).toEqual([]);
  });
});

describe("mapPasteToTargets — tiling", () => {
  it("tiles down when the selection is an exact row multiple of the block", () => {
    const result = map([["1"], ["2"]], "r0", "a", { rows: 4, columns: 1 });
    expect(shape(result)).toEqual(["r0:a=1", "r1:a=2", "r2:a=1", "r3:a=2"]);
    expect(result.clipped).toEqual({ rows: 0, columns: 0 });
  });

  it("tiles across when the selection is an exact column multiple of the block", () => {
    const result = map([["1", "2"]], "r0", "a", { rows: 1, columns: 4 });
    expect(shape(result)).toEqual(["r0:a=1", "r0:b=2", "r0:c=1", "r0:d=2"]);
  });

  it("tiles in both dimensions", () => {
    const result = map(
      [
        ["1", "2"],
        ["3", "4"],
      ],
      "r0",
      "a",
      { rows: 4, columns: 4 },
    );
    expect(result.cells).toHaveLength(16);
    expect(shape(result).slice(0, 4)).toEqual([
      "r0:a=1",
      "r0:b=2",
      "r0:c=1",
      "r0:d=2",
    ]);
    expect(shape(result).slice(12)).toEqual([
      "r3:a=3",
      "r3:b=4",
      "r3:c=3",
      "r3:d=4",
    ]);
  });

  it("does not tile rows when the selection is not an exact multiple", () => {
    const result = map([["1"], ["2"]], "r0", "a", { rows: 3, columns: 1 });
    expect(shape(result)).toEqual(["r0:a=1", "r1:a=2"]);
    expect(result.clipped).toEqual({ rows: 0, columns: 0 });
  });

  it("does not tile columns when the selection is not an exact multiple", () => {
    const result = map([["1", "2"]], "r0", "a", { rows: 1, columns: 3 });
    expect(shape(result)).toEqual(["r0:a=1", "r0:b=2"]);
  });

  it("writes the block once when the selection is smaller than the block", () => {
    const result = map([["1"], ["2"], ["3"]], "r0", "a", {
      rows: 2,
      columns: 1,
    });
    expect(shape(result)).toEqual(["r0:a=1", "r1:a=2", "r2:a=3"]);
  });

  it("tiles one dimension while writing the other once", () => {
    // Columns: 4 is an exact multiple of 2 → tile. Rows: 3 is not a multiple of 2
    // → the block is written once from the top and row r2 is left untouched.
    const result = map(
      [
        ["1", "2"],
        ["3", "4"],
      ],
      "r0",
      "a",
      { rows: 3, columns: 4 },
    );
    expect(shape(result)).toEqual([
      "r0:a=1",
      "r0:b=2",
      "r0:c=1",
      "r0:d=2",
      "r1:a=3",
      "r1:b=4",
      "r1:c=3",
      "r1:d=4",
    ]);
  });

  it("tiles a single-row block down the whole selection", () => {
    const result = map([["1", "2"]], "r0", "a", { rows: 3, columns: 2 });
    expect(shape(result)).toEqual([
      "r0:a=1",
      "r0:b=2",
      "r1:a=1",
      "r1:b=2",
      "r2:a=1",
      "r2:b=2",
    ]);
  });
});

describe("mapPasteToTargets — clipping", () => {
  it("clips rows past the last visible row and counts them", () => {
    const result = map([["1"], ["2"], ["3"], ["4"]], "r3", "a");
    expect(shape(result)).toEqual(["r3:a=1", "r4:a=2"]);
    expect(result.clipped).toEqual({ rows: 2, columns: 0 });
  });

  it("clips columns past the last data column and counts them", () => {
    const result = map([["1", "2", "3"]], "r0", "d");
    expect(shape(result)).toEqual(["r0:d=1"]);
    expect(result.clipped).toEqual({ rows: 0, columns: 2 });
  });

  it("counts clipped rows and columns independently, not per cell", () => {
    const result = map(
      [
        ["1", "2", "3"],
        ["4", "5", "6"],
        ["7", "8", "9"],
      ],
      "r4",
      "c",
    );
    expect(shape(result)).toEqual(["r4:c=1", "r4:d=2"]);
    expect(result.clipped).toEqual({ rows: 2, columns: 1 });
  });

  it("clips the tiled area too", () => {
    const result = map([["1"], ["2"]], "r2", "a", { rows: 4, columns: 1 });
    expect(shape(result)).toEqual(["r2:a=1", "r3:a=2", "r4:a=1"]);
    expect(result.clipped).toEqual({ rows: 1, columns: 0 });
  });
});

describe("mapPasteToTargets — row-select column", () => {
  it("never emits the synthetic row-select column as a target", () => {
    const result = map([["1", "2", "3", "4"]], "r0", "a");
    expect(shape(result)).toEqual(["r0:a=1", "r0:b=2", "r0:c=3", "r0:d=4"]);
    expect(result.cells.some((c) => c.columnId === ROW_SELECT_COLUMN_ID)).toBe(
      false,
    );
  });

  it("anchors on the first data column when the anchor is the row-select column", () => {
    const result = map([["1", "2"]], "r0", ROW_SELECT_COLUMN_ID);
    expect(shape(result)).toEqual(["r0:a=1", "r0:b=2"]);
  });

  it("returns nothing when there are no data columns", () => {
    const result = mapPasteToTargets({
      matrix: [["1"]],
      anchor: { ref: { kind: "data", rowId: "r0" }, columnId: "a" },
      selectionSize: { rows: 1, columns: 1 },
      rowModelSnapshot,
      columns: [{ id: ROW_SELECT_COLUMN_ID }] as PretableColumn<Row>[],
    });
    expect(result.cells).toEqual([]);
  });
});

describe("mapPasteToTargets — ragged input", () => {
  it("emits no target for a source cell the matrix does not have", () => {
    const result = map([["1", "2"], ["3"]], "r0", "a");
    // The short row leaves (r1, b) untouched rather than clearing it.
    expect(shape(result)).toEqual(["r0:a=1", "r0:b=2", "r1:a=3"]);
    expect(result.clipped).toEqual({ rows: 0, columns: 0 });
  });

  it("uses the widest row as the block width when tiling", () => {
    const result = map([["1", "2"], ["3"]], "r0", "a", {
      rows: 2,
      columns: 4,
    });
    expect(shape(result)).toEqual([
      "r0:a=1",
      "r0:b=2",
      "r0:c=1",
      "r0:d=2",
      "r1:a=3",
      "r1:c=3",
    ]);
  });
});

describe("mapPasteToTargets — value fidelity", () => {
  it("passes raw clipboard text through untouched", () => {
    const result = map([["  spaced  ", "with\nnewline"]], "r0", "a");
    expect(result.cells).toEqual([
      { rowId: "r0", columnId: "a", raw: "  spaced  " },
      { rowId: "r0", columnId: "b", raw: "with\nnewline" },
    ]);
  });

  it("emits an empty raw for an empty clipboard field", () => {
    const result = map([["", "x"]], "r0", "a");
    expect(shape(result)).toEqual(["r0:a=", "r0:b=x"]);
  });
});

describe("mapPasteToTargets — group rows", () => {
  //   [g:x]  r0  r1  [g:y]  r2  r3  r4
  const groupedSnapshot = createLocalRowModel({
    rows,
    columns: modelColumns,
    initialExpansion: { kind: "expanded" },
    query: {
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "group" }],
    },
  }).getState().snapshot;

  function mapGrouped(
    matrix: string[][],
    ref: PretableVisibleRowRef<string>,
    columnId: string,
    selectionSize = { rows: 1, columns: 1 },
  ) {
    return mapPasteToTargets({
      matrix,
      anchor: { ref, columnId },
      selectionSize,
      rowModelSnapshot: groupedSnapshot,
      columns,
    });
  }

  it("steps over a group header instead of spending a block row on it", () => {
    // Anchored on the last data row of group x, a 3-row block continues into
    // group y's rows: the header occupies no slot, so all 3 rows land and
    // nothing clips.
    const result = mapGrouped(
      [["1"], ["2"], ["3"]],
      { kind: "data", rowId: "r1" },
      "a",
    );
    expect(shape(result)).toEqual(["r1:a=1", "r2:a=2", "r3:a=3"]);
    expect(result.clipped).toEqual({ rows: 0, columns: 0 });
  });

  it("never emits a group row as a target", () => {
    // A block long enough to cover the whole list, anchored at the top.
    const result = mapGrouped(
      [["1"], ["2"], ["3"], ["4"], ["5"]],
      { kind: "data", rowId: "r0" },
      "a",
      { rows: 5, columns: 1 },
    );
    const targetIds = new Set(result.cells.map((c) => c.rowId));
    expect([...targetIds]).toEqual(["r0", "r1", "r2", "r3", "r4"]);
    expect(targetIds.has("g:x")).toBe(false);
    expect(targetIds.has("g:y")).toBe(false);
  });

  it("resolves an anchor that lands on a group header to the next data row", () => {
    const group = groupedSnapshot.parentGroupOf({ kind: "data", rowId: "r2" });
    expect(group).toBeDefined();
    const result = mapGrouped(
      [["1"], ["2"]],
      { kind: "group", groupId: group!.groupId },
      "a",
    );
    expect(shape(result)).toEqual(["r2:a=1", "r3:a=2"]);
    expect(result.clipped).toEqual({ rows: 0, columns: 0 });
  });

  it("counts clipped rows against the data rows, not the visible rows", () => {
    // Two data rows remain below the anchor (r3, r4); the last two block rows
    // fall off the end. The trailing group header must not be mistaken for a
    // landing slot, nor inflate the row space it is clipped against.
    const result = mapGrouped(
      [["1"], ["2"], ["3"], ["4"]],
      { kind: "data", rowId: "r3" },
      "a",
    );
    expect(shape(result)).toEqual(["r3:a=1", "r4:a=2"]);
    expect(result.clipped).toEqual({ rows: 2, columns: 0 });
  });

  it("tiles across a group boundary against the data-row selection count", () => {
    // `selectionSize.rows` counts data rows (the surface measures it that way),
    // so a 2-row block tiles twice over 4 data rows spanning the boundary.
    const result = mapGrouped(
      [["1"], ["2"]],
      { kind: "data", rowId: "r1" },
      "a",
      {
        rows: 4,
        columns: 1,
      },
    );
    expect(shape(result)).toEqual(["r1:a=1", "r2:a=2", "r3:a=1", "r4:a=2"]);
    expect(result.clipped).toEqual({ rows: 0, columns: 0 });
  });

  it("returns nothing when no data row sits at or after the anchor", () => {
    const collapsedSnapshot = createLocalRowModel({
      rows: [rows[0]!],
      columns: modelColumns,
      initialExpansion: { kind: "collapsed" },
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "group" }],
      },
    }).getState().snapshot;
    const trailingHeader = collapsedSnapshot.rowAt(0);
    expect(trailingHeader?.kind).toBe("group");
    if (trailingHeader?.kind !== "group") throw new Error("Expected group row");
    const result = mapPasteToTargets({
      matrix: [["1"]],
      anchor: {
        ref: { kind: "group", groupId: trailingHeader.groupId },
        columnId: "a",
      },
      selectionSize: { rows: 1, columns: 1 },
      rowModelSnapshot: collapsedSnapshot,
      columns,
    });
    expect(result.cells).toEqual([]);
    expect(result.clipped).toEqual({ rows: 0, columns: 0 });
  });
});
