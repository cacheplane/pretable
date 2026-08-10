// @vitest-environment jsdom
import { render, renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { Pretable } from "../pretable";
import { PretableSurface } from "../pretable-surface";
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

function findDataRow(
  visibleRows: readonly PretableVisibleRow<Row>[],
  id: string,
): PretableDataRow<Row> | undefined {
  return visibleRows.find(
    (entry): entry is PretableDataRow<Row> =>
      entry.kind === "data" && entry.id === id,
  );
}

function readRowIds(container: HTMLElement): (string | null)[] {
  return [...container.querySelectorAll("[data-pretable-row]")].map((node) =>
    node.getAttribute("data-pretable-row-id"),
  );
}

describe("React entry points agree on row identity", () => {
  it("usePretable applies a transaction update to the intended row", () => {
    const rows: Row[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const { result } = renderHook(() =>
      usePretable<Row>({ columns, rows, viewportHeight: 200 }),
    );

    const grid = result.current.grid;
    const bId = grid
      .getSnapshot()
      .visibleRows.find(
        (entry): entry is PretableDataRow<Row> =>
          entry.kind === "data" && entry.row.id === "b",
      )!.id;

    act(() => {
      grid.applyTransaction({ update: [{ id: "b", name: "B2" }] });
    });

    expect(findDataRow(result.current.snapshot.visibleRows, bId)?.row.name).toBe(
      "B2",
    );
  });

  it("Pretable and PretableSurface derive the same ids from the same rows", () => {
    const rows: Row[] = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
    ];
    const dropIn = render(<Pretable<Row> columns={columns} rows={rows} />);
    const dropInIds = readRowIds(dropIn.container);
    dropIn.unmount();

    const surface = render(
      <PretableSurface<Row>
        ariaLabel="surface"
        columns={columns}
        rows={rows}
        viewportHeight={200}
      />,
    );
    const surfaceIds = readRowIds(surface.container);
    surface.unmount();

    expect(dropInIds.length).toBeGreaterThan(0);
    expect(surfaceIds).toEqual(dropInIds);
  });
});
