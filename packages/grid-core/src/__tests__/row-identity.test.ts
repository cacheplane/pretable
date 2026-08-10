import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import type {
  PretableDataRow,
  PretableGridOptions,
  PretableVisibleRow,
} from "../types";

/**
 * Row identity must never silently be positional.
 *
 * Selection, focus, in-flight edits and transactions are all keyed by row id
 * and deliberately survive a wholesale row replacement. Under a positional id
 * "survive" degrades into "silently re-point at whatever now sits there" — so
 * these tests come in pairs: identity holds across a reorder when `getRowId`
 * derives it from the row, and construction is refused when it is missing.
 *
 * The fixture row type has no `id` field on purpose. Nothing in the engine may
 * guess an identity, from `row.id` or from array position.
 */

type Row = {
  sku: string;
  name: string;
};

const columns = [{ id: "name", header: "Name" }];
const getRowId = (row: Row) => row.sku;

const rows: Row[] = [
  { sku: "a", name: "A" },
  { sku: "b", name: "B" },
  { sku: "c", name: "C" },
];

function findDataRow(
  visibleRows: readonly PretableVisibleRow<Row>[],
  id: string,
): PretableDataRow<Row> | undefined {
  return visibleRows.find(
    (entry): entry is PretableDataRow<Row> =>
      entry.kind === "data" && entry.id === id,
  );
}

describe("row identity is never positional", () => {
  test("selection stays on the same row when the row array is reordered", () => {
    const grid = createGridCore<Row>({
      columns: [...columns],
      rows: [...rows],
      getRowId,
    });

    grid.toggleRowSelection("b");

    // An externally sorted / streamed replacement: same rows, new order.
    grid.setRows([
      { sku: "b", name: "B" },
      { sku: "c", name: "C" },
      { sku: "a", name: "A" },
    ]);

    const snap = grid.getSnapshot();
    const selectedId = snap.selection.ranges[0]?.startRowId ?? null;
    expect(selectedId).not.toBeNull();
    expect(findDataRow(snap.visibleRows, selectedId!)?.row.sku).toBe("b");
  });

  test("an in-flight edit stays on the same row when the row array is reordered", () => {
    const grid = createGridCore<Row>({
      columns: [...columns],
      rows: [...rows],
      getRowId,
    });

    grid.beginEdit({ rowId: "a", columnId: "name" });

    grid.setRows([
      { sku: "c", name: "C" },
      { sku: "b", name: "B" },
      { sku: "a", name: "A" },
    ]);

    const snap = grid.getSnapshot();
    const editingId = snap.editing?.rowId ?? null;
    expect(editingId).not.toBeNull();
    expect(findDataRow(snap.visibleRows, editingId!)?.row.sku).toBe("a");
  });

  test("row ids do not track array position", () => {
    const grid = createGridCore<Row>({
      columns: [...columns],
      rows: [...rows],
      getRowId,
    });

    const idsBefore = grid.getSnapshot().visibleRows.map((entry) => entry.id);
    expect(idsBefore).toEqual(["a", "b", "c"]);

    grid.setRows([
      { sku: "c", name: "C" },
      { sku: "a", name: "A" },
      { sku: "b", name: "B" },
    ]);

    expect(grid.getSnapshot().visibleRows.map((entry) => entry.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  // `getRowId` is a required field, so TypeScript is the primary gate. This
  // covers the callers it cannot reach: plain JS, `any`, an options object
  // assembled across a package boundary.
  test("construction is refused when getRowId is missing", () => {
    expect(() =>
      createGridCore<Row>({
        columns: [...columns],
        rows: [...rows],
      } as unknown as PretableGridOptions<Row>),
    ).toThrow(/^pretable: `getRowId` is required/);
  });

  test("construction is refused when getRowId is not a function", () => {
    expect(() =>
      createGridCore<Row>({
        columns: [...columns],
        rows: [...rows],
        getRowId: "sku",
      } as unknown as PretableGridOptions<Row>),
    ).toThrow(/^pretable: `getRowId` is required/);
  });
});
