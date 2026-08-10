// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePretable } from "../use-pretable";
import type { PretableColumn } from "../types";
import type {
  PretableDataRow,
  PretableProcessingAuthority,
  PretableResultMeta,
  PretableVisibleRow,
} from "@pretable/core";

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
    const { result, rerender } = renderHook(
      ({ rows }: { rows: Row[] }) =>
        usePretable<Row>({
          columns,
          rows,
          getRowId: (row) => row.id,
          viewportHeight: 300,
          // Fresh object identity every render, the way a consumer writes it.
          processing: { filter: "external", sort: "external" },
        }),
      { initialProps: { rows: rowsA } },
    );

    const grid = result.current.grid;
    rerender({ rows: rowsB });

    expect(result.current.grid).toBe(grid);
  });

  it("routes a meta-only change through setResultMeta and keeps the rows array", () => {
    const { result, rerender } = renderHook(
      ({ rows, total }: { rows: Row[]; total: number }) =>
        usePretable<Row>({
          columns,
          rows,
          getRowId: (row) => row.id,
          viewportHeight: 300,
          processing: { filter: "external" },
          resultMeta: { total: { kind: "exact", count: total } },
        }),
      { initialProps: { rows: rowsA, total: 100 } },
    );

    expect(result.current.snapshot.matchingTotal).toEqual({
      kind: "exact",
      count: 100,
    });
    const visibleRows = result.current.snapshot.visibleRows;

    rerender({ rows: rowsA, total: 101 });

    expect(result.current.snapshot.matchingTotal).toEqual({
      kind: "exact",
      count: 101,
    });
    expect(result.current.telemetry.matchingTotal).toEqual({
      kind: "exact",
      count: 101,
    });
    // The engine caches its derivation and drops that cache on setRows, so a
    // surviving array identity is what distinguishes the setResultMeta path
    // from a rows replacement carrying the same rows.
    expect(result.current.snapshot.visibleRows).toBe(visibleRows);
  });

  it("re-applies resultMeta to a grid rebuilt by a processing change", () => {
    // Stable identity, the way a consumer that memoizes its meta would pass it:
    // nothing about the meta changes, only the create-time authority does.
    const resultMeta: PretableResultMeta = {
      total: { kind: "exact", count: 101 },
    };
    const { result, rerender } = renderHook(
      ({ sort }: { sort: PretableProcessingAuthority | undefined }) =>
        usePretable<Row>({
          columns,
          rows: rowsA,
          getRowId: (row) => row.id,
          viewportHeight: 300,
          processing: { filter: "external", sort },
          resultMeta,
        }),
      {
        initialProps: {
          sort: undefined as PretableProcessingAuthority | undefined,
        },
      },
    );

    const grid = result.current.grid;
    expect(result.current.snapshot.matchingTotal).toEqual({
      kind: "exact",
      count: 101,
    });

    rerender({ sort: "external" });

    expect(result.current.grid).not.toBe(grid);
    expect(result.current.snapshot.matchingTotal).toEqual({
      kind: "exact",
      count: 101,
    });
  });
});
