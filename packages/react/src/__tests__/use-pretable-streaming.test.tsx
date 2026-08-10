// @vitest-environment jsdom
import { render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePretable } from "../use-pretable";
import type { PretableColumn } from "../types";
import type { PretableDataRow, PretableVisibleRow } from "@pretable/core";

type Row = {
  id: string;
  name: string;
};

const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", value: (row) => row.name },
];

const rowsA: Row[] = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
];

const rowsB: Row[] = [
  { id: "a", name: "A2" },
  { id: "b", name: "B2" },
];

/**
 * This fixture is never grouped, so every visible row is a data row. Narrow the
 * union rather than side-stepping it: a group row genuinely has no `.row`.
 */
function findDataRow(
  visibleRows: readonly PretableVisibleRow<Row>[],
  id: string,
): PretableDataRow<Row> | undefined {
  return visibleRows.find(
    (entry): entry is PretableDataRow<Row> =>
      entry.kind === "data" && entry.id === id,
  );
}

describe("usePretable streaming lifecycle", () => {
  it("keeps the grid instance and selection across rows updates", () => {
    const getRowId = (row: Row) => row.id;
    const { result, rerender } = renderHook(
      ({ rows }: { rows: Row[] }) =>
        usePretable<Row>({ columns, rows, getRowId, viewportHeight: 200 }),
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
        usePretable<Row>({
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

  it("does not recreate the grid when processing is an inline object literal", () => {
    const seen: unknown[] = [];
    function Harness({ rows }: { rows: Row[] }) {
      const model = usePretable<Row>({
        columns,
        rows,
        getRowId: (row) => row.id,
        viewportHeight: 300,
        processing: { filter: "external", sort: "external" },
      });
      seen.push(model.grid);
      return null;
    }
    const view = render(<Harness rows={rowsA} />);
    view.rerender(<Harness rows={rowsB} />);
    expect(new Set(seen).size).toBe(1);
  });

  it("routes a meta-only change through setResultMeta and keeps the rows array", () => {
    function Harness({ rows, total }: { rows: Row[]; total: number }) {
      const model = usePretable<Row>({
        columns,
        rows,
        getRowId: (row) => row.id,
        viewportHeight: 300,
        processing: { filter: "external" },
        resultMeta: { total: { kind: "exact", count: total } },
      });
      return (
        <div
          data-total={JSON.stringify(model.snapshot.matchingTotal)}
          data-loaded={model.telemetry.loadedRowCount}
        />
      );
    }
    const view = render(<Harness rows={rowsA} total={100} />);
    view.rerender(<Harness rows={rowsA} total={101} />);
    const node = view.container.firstElementChild!;
    expect(node.getAttribute("data-total")).toBe(
      JSON.stringify({ kind: "exact", count: 101 }),
    );
    expect(node.getAttribute("data-loaded")).toBe(String(rowsA.length));
  });
});
