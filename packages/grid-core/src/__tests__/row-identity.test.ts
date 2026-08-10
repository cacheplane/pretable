import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import type { PretableDataRow, PretableVisibleRow } from "../types";

type Row = {
  sku: string;
  name: string;
};

const columns = [{ id: "name", header: "Name" }];

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
      rows: [
        { sku: "a", name: "A" },
        { sku: "b", name: "B" },
        { sku: "c", name: "C" },
      ],
    });

    const bId = grid
      .getSnapshot()
      .visibleRows.find(
        (entry): entry is PretableDataRow<Row> =>
          entry.kind === "data" && entry.row.sku === "b",
      )!.id;
    grid.toggleRowSelection(bId);

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
      rows: [
        { sku: "a", name: "A" },
        { sku: "b", name: "B" },
        { sku: "c", name: "C" },
      ],
    });

    const aId = grid
      .getSnapshot()
      .visibleRows.find(
        (entry): entry is PretableDataRow<Row> =>
          entry.kind === "data" && entry.row.sku === "a",
      )!.id;
    grid.beginEdit({ rowId: aId, columnId: "name" });

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
});
