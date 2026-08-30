// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PretableQueryFor } from "@pretable/core";

import {
  PretableSurface,
  type PretableSurfaceGrid,
  type PretableSurfaceQueryColumns,
} from "../pretable-surface";
import type { PretableColumn } from "../types";

afterEach(cleanup);

/*
 * A hidden column must STAY hidden across a grouping round-trip.
 *
 * The loss mechanism: when grouping removes a column from the drawn roster
 * (`hideGroupedColumns` on), the surface hands the engine a roster without
 * it, and the engine rebuilds `columnLayout` from that roster. Engine-side
 * per-column layout state — `hidden` from `setColumnVisible`, a resize from
 * `setColumnWidth`, a pin from `setColumnPinned` — has no prop to live in,
 * so a rebuild that forgets the departed column's entry silently discards
 * the user's explicit choice; the column comes back DRAWN (or unpinned, or
 * default-width) the moment it re-enters the roster.
 *
 * The jsdom derivation-flip budget once noted here is LIFTED: the stall was
 * diagnosed and fixed (#522; mechanism write-up and regression pin in
 * grouping-derivation-flip-stall.test.tsx).
 */

type Holding = {
  id: string;
  sector: string;
  name: string;
  qty: number;
};

const rows: Holding[] = [
  { id: "r1", sector: "Tech", name: "alpha", qty: 10 },
  { id: "r2", sector: "Tech", name: "beta", qty: 20 },
  { id: "r3", sector: "Energy", name: "gamma", qty: 5 },
];

const columns: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector", widthPx: 100, type: "text" },
  { id: "name", header: "Name", widthPx: 100, type: "text" },
  { id: "qty", header: "Qty", widthPx: 100, type: "number" },
];

type Grid = PretableSurfaceGrid<Holding, string, PretableColumn<Holding>[]>;

type Query = PretableQueryFor<PretableSurfaceQueryColumns<Holding>>;

const EMPTY_QUERY: Query = { filters: [], sort: [], rowGroups: [] } as Query;

function groupedBy(columnId: string): Query {
  return {
    filters: [],
    sort: [],
    rowGroups: [{ columnId }],
  } as Query;
}

function renderSurface(onGridReady: (grid: Grid) => void) {
  // UNCONTROLLED query (no `query` prop): the engine owns the query, so
  // `grid.setQuery` applies grouping transitions itself. Tool panel open on
  // the columns section so the visibility checkbox is rendered and can be
  // asserted against the drawn headers.
  return render(
    <PretableSurface
      ariaLabel="holdings"
      columns={columns}
      getRowId={(row: Holding) => row.id}
      onGridReady={onGridReady}
      overscan={0}
      rows={rows}
      toolPanel={{ defaultActiveSection: "columns" }}
      viewportHeight={400}
    />,
  );
}

async function mountSurface() {
  let grid: Grid | null = null;
  const view = renderSurface((ready) => {
    grid = ready;
  });
  const ready = () => grid!;
  await waitFor(() => {
    expect(headerIds(view.container)).toContain("qty");
  });
  return { view, ready };
}

function headerIds(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[data-pretable-header-cell]")].map(
    (header) => header.getAttribute("data-pretable-column-id") ?? "",
  );
}

function columnToggle(container: HTMLElement, columnId: string) {
  return container.querySelector(
    `[data-pretable-tool-column-row][data-pretable-column-id="${columnId}"]` +
      " [data-pretable-tool-column-toggle]",
  );
}

function layoutEntry(grid: Grid, columnId: string) {
  return grid.getState().columnLayout.find((column) => column.id === columnId);
}

async function hideQty(view: ReturnType<typeof render>, ready: () => Grid) {
  act(() => {
    ready().setColumnVisible("qty", false);
  });
  await waitFor(() => {
    expect(headerIds(view.container)).not.toContain("qty");
    expect(columnToggle(view.container, "qty")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
}

async function groupBy(
  view: ReturnType<typeof render>,
  ready: () => Grid,
  columnId: string,
) {
  act(() => {
    ready().setQuery(groupedBy(columnId) as never);
  });
  await waitFor(() => {
    // The synthetic group column is drawn, and the grouped column is
    // grouped away (`hideGroupedColumns` defaults ON).
    expect(headerIds(view.container)).toContain("__pretable_group__");
    expect(headerIds(view.container)).not.toContain(columnId);
    // The SP3b invariant, asserted directly: while grouped away the column
    // has NO columnLayout entry at all — the retention fix must remember it
    // OUTSIDE the engine layout, never as a hidden entry, or the
    // filters-picker marker logic could no longer tell "grouped away" from
    // "hidden".
    expect(layoutEntry(ready(), columnId)).toBeUndefined();
  });
}

describe("a hidden column survives a grouping round-trip", () => {
  it("stays hidden when setHideGroupedColumns(false) redraws the grouped column", async () => {
    const { view, ready } = await mountSurface();
    await hideQty(view, ready);
    await groupBy(view, ready, "qty");

    act(() => {
      ready().setHideGroupedColumns(false);
    });

    // With hide-grouped off the grouped column re-enters the drawn roster —
    // but the user hid it EXPLICITLY, and that choice must win. Settles are
    // async: wait for the engine value to land, then hold the assertion.
    await waitFor(() => {
      expect(ready().getState().hideGroupedColumns).toBe(false);
    });
    await waitFor(() => {
      expect(headerIds(view.container)).not.toContain("qty");
      expect(columnToggle(view.container, "qty")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(layoutEntry(ready(), "qty")?.hidden).toBe(true);
    });
  });

  it("stays hidden when the grouping level is removed instead", async () => {
    const { view, ready } = await mountSurface();
    await hideQty(view, ready);
    await groupBy(view, ready, "qty");

    act(() => {
      ready().setQuery(EMPTY_QUERY as never);
    });

    await waitFor(() => {
      expect(headerIds(view.container)).not.toContain("__pretable_group__");
    });
    await waitFor(() => {
      expect(headerIds(view.container)).not.toContain("qty");
      expect(columnToggle(view.container, "qty")).toHaveAttribute(
        "aria-checked",
        "false",
      );
      expect(layoutEntry(ready(), "qty")?.hidden).toBe(true);
    });
  });

  it("a column hidden while a DIFFERENT column is grouped stays hidden across the roster change", async () => {
    const { view, ready } = await mountSurface();
    await hideQty(view, ready);

    // Grouping by `sector` changes the roster (sector leaves, the group
    // column enters) without ever touching `qty` — qty's hide must ride
    // through the rebuild.
    await groupBy(view, ready, "sector");
    await waitFor(() => {
      expect(headerIds(view.container)).not.toContain("qty");
      expect(layoutEntry(ready(), "qty")?.hidden).toBe(true);
    });

    act(() => {
      ready().setQuery(EMPTY_QUERY as never);
    });
    await waitFor(() => {
      expect(headerIds(view.container)).not.toContain("__pretable_group__");
      expect(headerIds(view.container)).not.toContain("qty");
      expect(layoutEntry(ready(), "qty")?.hidden).toBe(true);
    });
  });
});

describe("engine width and pin survive the same round-trip", () => {
  it("a resized, pinned column keeps both across group-then-ungroup", async () => {
    const { view, ready } = await mountSurface();

    act(() => {
      ready().setColumnWidth("qty", 333);
      ready().setColumnPinned("qty", "right");
      // `name` STAYS in the roster the whole time: its resize must ride
      // through the rebuild too, not only the departed column's state.
      ready().setColumnWidth("name", 250);
    });
    await waitFor(() => {
      const entry = layoutEntry(ready(), "qty");
      expect(entry?.widthPx).toBe(333);
      expect(entry?.pinned).toBe("right");
      expect(layoutEntry(ready(), "name")?.widthPx).toBe(250);
    });

    await groupBy(view, ready, "qty");
    act(() => {
      ready().setQuery(EMPTY_QUERY as never);
    });

    await waitFor(() => {
      expect(headerIds(view.container)).toContain("qty");
      const entry = layoutEntry(ready(), "qty");
      expect(entry?.widthPx).toBe(333);
      expect(entry?.pinned).toBe("right");
      expect(layoutEntry(ready(), "name")?.widthPx).toBe(250);
    });
  });
});
