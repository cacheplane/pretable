// @vitest-environment jsdom
import { render, renderHook } from "@testing-library/react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { LabeledGridSurface } from "../labeled-grid-surface";
import { Pretable } from "../pretable";
import { PretableSurface } from "../pretable-surface";
import { usePretable } from "../use-pretable";
import type { PretableColumn } from "../types";
import type { PretableDataRow, PretableVisibleRow } from "@pretable/core";

/**
 * Row identity must never silently be positional, and the React entry points
 * must not disagree about it. Before this was enforced there were three
 * behaviours across four doors: `<Pretable>` guessed `row.id` then fell back to
 * the array index, `<PretableSurface>` and `<LabeledGridSurface>` fell through
 * to the engine's index, and a since-removed `<InspectionGrid>` preset
 * hardcoded a real id.
 *
 * The fixture row type carries `sku`, not `id`, so nothing can quietly guess.
 */

type Row = {
  sku: string;
  name: string;
};

const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", value: (row) => row.name },
];

const rows: Row[] = [
  { sku: "a", name: "A" },
  { sku: "b", name: "B" },
];

const getRowId = (row: Row) => row.sku;

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
    const { result } = renderHook(() =>
      usePretable<Row>({ columns, rows, getRowId, viewportHeight: 200 }),
    );

    act(() => {
      result.current.grid.applyTransaction({
        update: [{ sku: "b", name: "B2" }],
      });
    });

    expect(
      findDataRow(result.current.snapshot.visibleRows, "b")?.row.name,
    ).toBe("B2");
  });

  it("every surface derives the same ids from the same rows", () => {
    const dropIn = render(
      <Pretable<Row> columns={columns} rows={rows} getRowId={getRowId} />,
    );
    const dropInIds = readRowIds(dropIn.container);
    dropIn.unmount();

    const surface = render(
      <PretableSurface<Row>
        ariaLabel="surface"
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        viewportHeight={200}
      />,
    );
    const surfaceIds = readRowIds(surface.container);
    surface.unmount();

    const labeled = render(
      <LabeledGridSurface<Row>
        ariaLabel="labeled"
        columns={columns}
        rows={rows}
        getRowId={getRowId}
        viewportHeight={200}
      />,
    );
    const labeledIds = readRowIds(labeled.container);
    labeled.unmount();

    expect(dropInIds).toEqual(["a", "b"]);
    expect(surfaceIds).toEqual(dropInIds);
    expect(labeledIds).toEqual(dropInIds);
  });

  // `getRowId` is required on every entry point, so TypeScript is the primary
  // gate. `usePretable` checks at runtime too, because it hands `createGrid` a
  // stable wrapper — always a function — which would otherwise walk an omitted
  // `getRowId` straight past the engine's own guard. That is precisely how
  // `applyTransaction`'s check came to be unreachable from React.
  it("usePretable refuses to run without getRowId", () => {
    expect(() =>
      renderHook(() =>
        usePretable<Row>({
          columns,
          rows,
          viewportHeight: 200,
        } as unknown as Parameters<typeof usePretable<Row>>[0]),
      ),
    ).toThrow(/^pretable: `getRowId` is required/);
  });
});
