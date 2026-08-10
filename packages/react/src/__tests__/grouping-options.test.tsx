// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { GROUP_COLUMN_ID, type PretableGroupRow } from "@pretable/core";

import { PretableSurface } from "../pretable-surface";
import { usePretable } from "../use-pretable";
import type { PretableColumn } from "../types";

afterEach(() => {
  cleanup();
});

type Holding = {
  id: string;
  sector: string;
  name: string;
  qty: number;
};

const holdings: Holding[] = [
  { id: "h1", sector: "Tech", name: "Ada", qty: 10 },
  { id: "h2", sector: "Tech", name: "Bob", qty: 20 },
  { id: "h3", sector: "Energy", name: "Cy", qty: 5 },
];

const getRowId = (row: Holding) => row.id;

/** `rowGroup: true` groups at construction, so create-time options are exercised. */
const columns: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector", rowGroup: true },
  { id: "name", header: "Name" },
  { id: "qty", header: "Qty", type: "number", aggregate: "sum" },
];

function groupRowsOf(
  visibleRows: readonly { kind: string }[],
): PretableGroupRow[] {
  return visibleRows.filter(
    (entry): entry is PretableGroupRow => entry.kind === "group",
  );
}

describe("grouping options reach the engine through usePretable", () => {
  it("forwards groupColumn to the derived group column", () => {
    const { result } = renderHook(() =>
      usePretable<Holding>({
        columns,
        rows: holdings,
        getRowId,
        viewportHeight: 200,
        groupColumn: { header: "Book", widthPx: 320 },
      }),
    );

    const groupColumn = result.current.grid.getColumns()[0];
    expect(groupColumn?.id).toBe(GROUP_COLUMN_ID);
    expect(groupColumn?.header).toBe("Book");
    expect(groupColumn?.widthPx).toBe(320);
  });

  it("forwards hideGroupedColumns:false so the grouped column stays in the data area", () => {
    const { result } = renderHook(() =>
      usePretable<Holding>({
        columns,
        rows: holdings,
        getRowId,
        viewportHeight: 200,
        hideGroupedColumns: false,
      }),
    );

    expect(result.current.grid.getColumns().map((column) => column.id)).toEqual(
      [GROUP_COLUMN_ID, "sector", "name", "qty"],
    );
  });

  it("forwards groupsDefaultExpanded:false so groups start collapsed", () => {
    const { result } = renderHook(() =>
      usePretable<Holding>({
        columns,
        rows: holdings,
        getRowId,
        viewportHeight: 200,
        groupsDefaultExpanded: false,
      }),
    );

    const { visibleRows } = result.current.snapshot;
    expect(visibleRows.map((entry) => entry.kind)).toEqual(["group", "group"]);
  });

  it("forwards aggregateFilteredRows so totals fold rows the filter hides", () => {
    const { result } = renderHook(
      ({ aggregateFilteredRows }: { aggregateFilteredRows: boolean }) =>
        usePretable<Holding>({
          columns,
          rows: holdings,
          getRowId,
          viewportHeight: 200,
          aggregateFilteredRows,
        }),
      { initialProps: { aggregateFilteredRows: true } },
    );

    act(() => {
      result.current.grid.setColumnFilter("name", {
        operator: "contains",
        value: "Ada",
      });
    });

    const tech = groupRowsOf(result.current.snapshot.visibleRows).find(
      (group) => group.value === "Tech",
    );
    // Bob's 20 is filtered out of the rows but still folded into the total.
    expect(tech?.aggregates.qty).toBe(30);
    expect(tech?.childCount).toBe(1);
  });

  /**
   * The grid is memoized on create-time inputs; an identity-unstable dependency
   * would recreate it and discard sort, filters, selection, focus and
   * expansion. Every consumer writes `groupColumn={{ pinned: "left" }}` inline,
   * so this is the failure that would silently destroy user state on every
   * parent render.
   */
  it("keeps the grid instance and its state across an inline groupColumn object", () => {
    const { result, rerender } = renderHook(
      ({ tick }: { tick: number }) => {
        void tick;

        return usePretable<Holding>({
          columns,
          rows: holdings,
          getRowId,
          viewportHeight: 200,
          // Freshly allocated on every render, exactly as a consumer writes it.
          groupColumn: { header: "Book", widthPx: 320, pinned: "left" },
          hideGroupedColumns: false,
          aggregateFilteredRows: false,
          groupsDefaultExpanded: true,
        });
      },
      { initialProps: { tick: 0 } },
    );

    const grid = result.current.grid;
    grid.toggleRowSelection("h1");
    expect(grid.getSnapshot().selection.ranges).toHaveLength(1);

    rerender({ tick: 1 });

    expect(result.current.grid).toBe(grid);
    expect(result.current.grid.getSnapshot().selection.ranges).toHaveLength(1);
  });

  /**
   * `groupColumnsByPin` seats the synthetic column at the head of ITS OWN pin
   * region, so an unpinned tree column lands after every left-pinned data
   * column. `groupColumn.pinned: "left"` is the escape hatch, and it is only
   * reachable now that the option is plumbed through React.
   */
  it("seats a left-pinned group column ahead of a left-pinned data column", () => {
    const pinnedColumns: PretableColumn<Holding>[] = [
      { id: "sector", header: "Sector", rowGroup: true },
      { id: "name", header: "Name", pinned: "left" },
      { id: "qty", header: "Qty" },
    ];

    const { result: unpinned } = renderHook(() =>
      usePretable<Holding>({
        columns: pinnedColumns,
        rows: holdings,
        getRowId,
        viewportHeight: 200,
      }),
    );
    expect(unpinned.current.grid.getColumns().map((c) => c.id)).toEqual([
      "name",
      GROUP_COLUMN_ID,
      "qty",
    ]);

    const { result: pinnedLeft } = renderHook(() =>
      usePretable<Holding>({
        columns: pinnedColumns,
        rows: holdings,
        getRowId,
        viewportHeight: 200,
        groupColumn: { pinned: "left" },
      }),
    );
    expect(pinnedLeft.current.grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "name",
      "qty",
    ]);
  });
});

describe("grouping options reach the engine through PretableSurface", () => {
  it("renders the configured group column header", () => {
    const view = render(
      <PretableSurface
        ariaLabel="grouped"
        columns={columns}
        getRowId={getRowId}
        groupColumn={{ header: "Book", widthPx: 320 }}
        rows={holdings}
        viewportHeight={400}
      />,
    );

    const header = view.container.querySelector(
      `[role="columnheader"][data-pretable-column-id="${GROUP_COLUMN_ID}"]`,
    );
    expect(header).toHaveTextContent("Book");
  });

  it("renders the grouped column in the data area when hideGroupedColumns is false", () => {
    const view = render(
      <PretableSurface
        ariaLabel="grouped"
        columns={columns}
        getRowId={getRowId}
        hideGroupedColumns={false}
        rows={holdings}
        viewportHeight={400}
      />,
    );

    expect(
      view.container.querySelector(
        '[role="columnheader"][data-pretable-column-id="sector"]',
      ),
    ).not.toBeNull();
  });

  it("renders only group rows when groupsDefaultExpanded is false", () => {
    const view = render(
      <PretableSurface
        ariaLabel="grouped"
        columns={columns}
        getRowId={getRowId}
        groupsDefaultExpanded={false}
        rows={holdings}
        viewportHeight={400}
      />,
    );

    expect(
      view.container.querySelectorAll("[data-pretable-group-row]"),
    ).toHaveLength(2);
    expect(view.container.querySelectorAll("[data-pretable-row]")).toHaveLength(
      0,
    );
  });

  it("folds filtered rows into the totals when aggregateFilteredRows is set", () => {
    const view = render(
      <PretableSurface
        ariaLabel="grouped"
        aggregateFilteredRows
        columns={columns}
        getRowId={getRowId}
        rows={holdings}
        state={{
          filters: { name: { operator: "contains", value: "Ada" } },
        }}
        viewportHeight={400}
      />,
    );

    const groupRows = [
      ...view.container.querySelectorAll("[data-pretable-group-row]"),
    ];
    const tech = groupRows.find((row) => row.textContent?.includes("Tech"));
    expect(tech).toHaveTextContent("30");
  });
});
