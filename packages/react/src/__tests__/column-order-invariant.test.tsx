import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ROW_SELECT_COLUMN_ID } from "../constants";
import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import type { PretableSurfaceGrid } from "../pretable-surface";

afterEach(cleanup);

/**
 * The engine's column array order IS the drawn order. grid-core enforces it by
 * regrouping into [synthetic?][left…][unpinned…][right…] on every path that
 * takes an order from outside (#209), and the surface leans on it hard: copy,
 * paste, the selection highlight, row-checkbox coverage, `onSelectedRowIdChange`
 * and the announced counts all resolve column spans against `grid.options.columns`
 * because it is the order on screen (#210, #226, #229).
 *
 * Nothing else pins that down end-to-end — grid-core's own tests cover the
 * regrouping, but not that the renderer agrees with it. If the two ever drift,
 * every one of those consumers is silently wrong, so this compares the engine's
 * array against the actual rendered header row for each way an order can be set.
 */
interface Row extends Record<string, unknown> {
  id: string;
  a: string;
  b: string;
  c: string;
  d: string;
}

const ROWS: Row[] = [{ id: "r1", a: "1", b: "2", c: "3", d: "4" }];

function mount(columns: PretableColumn<Row>[], withRowSelect = false) {
  type Grid = PretableSurfaceGrid<Row, string, readonly PretableColumn<Row>[]>;
  let captured: Grid | null = null;
  const view = render(
    <PretableSurface<Row>
      ariaLabel="order-invariant"
      columns={columns}
      getRowId={(row) => row.id}
      onGridReady={(g) => {
        captured = g;
      }}
      rows={ROWS}
      {...(withRowSelect ? { rowSelectionColumn: { enabled: true } } : {})}
      viewportHeight={200}
    />,
  );

  return {
    grid: captured as unknown as Grid,
    /** Column ids in rendered order. The synthetic header carries no
     *  column-id attribute, so it is identified by its own marker. */
    drawn: () =>
      Array.from(
        view.container.querySelectorAll("[data-pretable-header-cell]"),
      ).map((el) =>
        el.hasAttribute("data-pretable-row-select-header")
          ? ROW_SELECT_COLUMN_ID
          : el.getAttribute("data-pretable-column-id"),
      ),
    engine: () => captured!.getState().columnLayout.map((c) => c.id),
  };
}

function expectAgreement(h: ReturnType<typeof mount>) {
  expect(h.engine()).toEqual(h.drawn());
}

describe("engine column order is the drawn order", () => {
  it("regroups a right pin declared mid-array", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B", pinned: "right" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    expect(h.drawn()).toEqual(["a", "c", "d", "b"]);
    expectAgreement(h);
  });

  it("regroups a left pin declared mid-array", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B", pinned: "left" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    expect(h.drawn()).toEqual(["b", "a", "c", "d"]);
    expectAgreement(h);
  });

  it("holds after setColumnPinned at runtime", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    act(() => h.grid.setColumnPinned("a", "right"));
    expect(h.drawn()).toEqual(["b", "c", "d", "a"]);
    expectAgreement(h);
  });

  it("holds when setColumnOrder interleaves a pinned id", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B", pinned: "right" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    // The request interleaves the right-pinned "b"; it is normalised, not
    // honoured literally.
    act(() => h.grid.setColumnOrder(["d", "b", "c", "a"]));
    expectAgreement(h);
  });

  it("holds after dragging a right-pinned column to the front", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B" },
      { id: "c", header: "C" },
      { id: "d", header: "D", pinned: "right" },
    ]);
    act(() => h.grid.setColumnOrder(["d", "a", "b", "c"]));
    expectAgreement(h);
  });

  it("holds with the synthetic row-select column present", () => {
    const h = mount(
      [
        { id: "a", header: "A", pinned: "left" },
        { id: "b", header: "B" },
        { id: "c", header: "C" },
        { id: "d", header: "D" },
      ],
      true,
    );
    expect(h.drawn()[0]).toBe(ROW_SELECT_COLUMN_ID);
    expectAgreement(h);
  });
});
