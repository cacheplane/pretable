// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useLegacyPretable } from "../use-legacy-pretable";
import type { PretableColumn } from "../types";
import type {
  PretableGridDataRow,
  PretableGridVisibleRow,
} from "@pretable/core";

type Row = {
  id: string;
  name: string;
};

const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", value: (row) => row.name },
];

/**
 * This fixture is never grouped, so every visible row is a data row. Narrow the
 * union rather than side-stepping it: a group row genuinely has no `.row`.
 */
function findDataRow(
  visibleRows: readonly PretableGridVisibleRow<Row>[],
  id: string,
): PretableGridDataRow<Row> | undefined {
  return visibleRows.find(
    (entry): entry is PretableGridDataRow<Row> =>
      entry.kind === "data" && entry.id === id,
  );
}

describe("usePretable streaming lifecycle", () => {
  it("keeps the grid instance and selection across rows updates", () => {
    const getRowId = (row: Row) => row.id;
    const { result, rerender } = renderHook(
      ({ rows }: { rows: Row[] }) =>
        useLegacyPretable<Row>({
          columns,
          rows,
          getRowId,
          viewportHeight: 200,
        }),
      {
        initialProps: {
          rows: [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ],
        },
      },
    );

    const grid = result.current.grid;
    grid.toggleRowSelection("a");
    expect(result.current.grid.getSnapshot().selection.ranges.length).toBe(1);

    // New array, same ids, new data — the streaming case.
    rerender({
      rows: [
        { id: "a", name: "A2" },
        { id: "b", name: "B2" },
      ],
    });

    expect(result.current.grid).toBe(grid); // not recreated
    const snap = result.current.snapshot;
    expect(snap.selection.ranges.length).toBe(1);
    expect(snap.selection.ranges[0]!.startRowId).toBe("a");
    expect(findDataRow(snap.visibleRows, "a")?.row.name).toBe("A2");
  });

  it("does not recreate the grid when getRowId is an inline closure", () => {
    const { result, rerender } = renderHook(
      ({ rows }: { rows: Row[] }) =>
        useLegacyPretable<Row>({
          columns,
          rows,
          getRowId: (row) => row.id, // fresh closure every render
          viewportHeight: 200,
        }),
      { initialProps: { rows: [{ id: "a", name: "A" }] } },
    );

    const grid = result.current.grid;
    grid.toggleRowSelection("a");
    rerender({ rows: [{ id: "a", name: "A2" }] });

    expect(result.current.grid).toBe(grid);
    expect(result.current.snapshot.selection.ranges.length).toBe(1);
  });
});
