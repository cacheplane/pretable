// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
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
 * The `pendingQueryRef` bypass, made observable. `setQuery` settles
 * ASYNCHRONOUSLY (post-#321), so two rapid writes on different axes race:
 * each write re-submits every axis it does not own, and a write that reads
 * the SETTLED snapshot instead of the pending query re-submits the other
 * axis's OLD value — silently reverting the first write. `queryWith` owns
 * `pendingQueryRef` to prevent exactly that, and `applyRowGroups` (the strip
 * / header-menu grouping write) was the one write path still bypassing it.
 *
 * Both orders are pinned: filter-then-grouping resurrects the filter the
 * funnel just cleared, and grouping-then-filter resurrects the grouping the
 * chip just removed. Each burst is a single synchronous `act` with no await
 * between the two writes, so the second write lands inside the first one's
 * settle window. Both writes are driven through rendered UI — the funnel
 * dialog's Clear button (`grid.setColumnFilter` → `queryWith`) and the
 * strip's chip-remove button (`applyRowGroups`).
 *
 * jsdom budget note (canonical write-up: grouping-state-engine.test.tsx,
 * the header comment): grouped grids stop applying DERIVATION changes after
 * ~4 flips per grid / ~7 per module, MODULE-CUMULATIVE. These tests flip
 * GROUPING (query state), not derivations, and no column declares an
 * aggregate — but the file is kept small on purpose.
 */

type Holding = {
  id: string;
  sector: string;
  name: string;
};

const rows: Holding[] = [
  { id: "r1", sector: "Tech", name: "alpha" },
  { id: "r2", sector: "Tech", name: "beta" },
  { id: "r3", sector: "Energy", name: "gamma" },
];

const columns: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector", widthPx: 100, type: "text" },
  { id: "name", header: "Name", widthPx: 100, type: "text" },
];

type Grid = PretableSurfaceGrid<Holding, string, PretableColumn<Holding>[]>;

type Query = PretableQueryFor<PretableSurfaceQueryColumns<Holding>>;

const NAME_FILTER = { columnId: "name", operator: "contains", value: "alpha" };

/** Grouped by sector AND filtered on name — one level of each axis to lose. */
const INITIAL_QUERY: Query = {
  filters: [NAME_FILTER],
  sort: [],
  rowGroups: [{ columnId: "sector" }],
} as Query;

function renderGrouped(onGridReady: (grid: Grid) => void) {
  // UNCONTROLLED (no `query` prop): the engine owns the query, which is the
  // mode `pendingQueryRef` protects — in controlled mode `setQuery` reports
  // intent and stops, and the consumer's re-render closes the loop instead.
  return render(
    <PretableSurface
      ariaLabel="holdings"
      columns={columns}
      getRowId={(row: Holding) => row.id}
      groupPanel={{ enabled: true }}
      onGridReady={onGridReady}
      overscan={0}
      rows={rows}
      toolPanel={false}
      viewportHeight={400}
    />,
  );
}

function settledQuery(grid: Grid) {
  return grid.rowModel.getState().snapshot.query;
}

async function mountSettled() {
  let grid: Grid | null = null;
  const view = renderGrouped((ready) => {
    grid = ready;
  });
  const ready = () => grid!;
  // Seed the grouped + filtered starting state through the public handle
  // (uncontrolled mode applies it), then let it settle COMPLETELY — the
  // burst below must be the only thing in flight.
  act(() => {
    ready().setQuery(INITIAL_QUERY as never);
  });
  await waitFor(() => {
    expect(settledQuery(ready()).rowGroups).toHaveLength(1);
    expect(settledQuery(ready()).filters).toHaveLength(1);
  });
  return { view, ready };
}

function clearButton(view: ReturnType<typeof render>) {
  fireEvent.click(view.getByRole("button", { name: "Filter Name" }));
  const dialog = view.getByRole("dialog", { name: "Filter Name" });
  return within(dialog).getByText("Clear");
}

function chipRemove(view: ReturnType<typeof render>) {
  return view.container.querySelector("[data-pretable-chip-remove]")!;
}

describe("rapid cross-axis query writes both survive settling", () => {
  it("a filter write followed by a grouping write keeps the filter", async () => {
    const { view, ready } = await mountSettled();
    const clear = clearButton(view);

    // One synchronous burst: the funnel's filter write, then the strip's
    // chip-remove grouping write, before the model settles either.
    act(() => {
      fireEvent.click(clear);
      fireEvent.click(chipRemove(view));
    });

    await waitFor(() => {
      expect(settledQuery(ready()).rowGroups).toEqual([]);
    });
    // The grouping write must not have re-submitted the STALE filter axis it
    // does not own — the cleared filter must stay cleared.
    expect(settledQuery(ready()).filters).toEqual([]);
  });

  it("a grouping write followed by a filter write keeps the grouping", async () => {
    const { view, ready } = await mountSettled();
    const clear = clearButton(view);

    // Reverse order: the grouping write first. If it is not RECORDED as the
    // pending query, the filter write re-submits the settled (still grouped)
    // rowGroups and resurrects the level the chip just removed.
    act(() => {
      fireEvent.click(chipRemove(view));
      fireEvent.click(clear);
    });

    await waitFor(() => {
      expect(settledQuery(ready()).filters).toEqual([]);
    });
    expect(settledQuery(ready()).rowGroups).toEqual([]);
  });
});
