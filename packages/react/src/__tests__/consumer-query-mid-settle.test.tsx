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
 * The third-writer hole in `pendingQueryRef`, made observable. A chrome
 * write records its submitted query in `pendingQueryRef` until the settled
 * snapshot JSON-matches it. A CONSUMER calling the public handle's
 * `grid.setQuery` mid-settle goes straight to the engine — its transition
 * SUPERSEDES the chrome write's, so the chrome query never settles, never
 * matches, and the pending record never clears. The NEXT chrome write then
 * builds its unnamed axes from the STALE pending query and silently reverts
 * the consumer's write.
 *
 * Sequence pinned here: funnel Clear (chrome, records pending), consumer
 * `setQuery` changing SORT in the same synchronous act (lands inside the
 * chrome write's settle window), settle, then the strip's chip-remove
 * (chrome grouping write). The consumer's sort must survive that last write.
 *
 * Harness mirrors grouping-query-write.test.tsx: UNCONTROLLED (the engine
 * owns the query — the only mode `pendingQueryRef` protects), chrome writes
 * driven through rendered UI. One test on purpose — originally rationed by
 * the jsdom flip budget, since diagnosed and LIFTED (#522; see
 * grouping-derivation-flip-stall.test.tsx). The REVERSE interleaving (a
 * chrome write landing mid-settle of a consumer `setQuery`) is closed by the
 * same fix — the consumer write now records the pending query the chrome
 * write builds from — but remains unpinned.
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

/** Grouped by sector AND filtered on name; sort starts EMPTY — the consumer
 * write below owns the sort axis, so its survival is unambiguous. */
const INITIAL_QUERY: Query = {
  filters: [NAME_FILTER],
  sort: [],
  rowGroups: [{ columnId: "sector" }],
} as Query;

const CONSUMER_SORT = [{ columnId: "name", direction: "asc" }];

/** The consumer's full replacement: filter cleared (agreeing with the chrome
 * write in flight), grouping kept, and a NEW sort — the axis whose survival
 * this test asserts. Deliberately differs from the chrome write's submitted
 * query so the pending record can never JSON-match a settled snapshot. */
const CONSUMER_QUERY: Query = {
  filters: [],
  sort: CONSUMER_SORT,
  rowGroups: [{ columnId: "sector" }],
} as Query;

function renderGrouped(onGridReady: (grid: Grid) => void) {
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

describe("a consumer setQuery landing mid-settle of a chrome write", () => {
  it("is not reverted by the next chrome write", async () => {
    let grid: Grid | null = null;
    const view = renderGrouped((ready) => {
      grid = ready;
    });
    const ready = () => grid!;
    act(() => {
      ready().setQuery(INITIAL_QUERY as never);
    });
    await waitFor(() => {
      expect(settledQuery(ready()).rowGroups).toHaveLength(1);
      expect(settledQuery(ready()).filters).toHaveLength(1);
    });

    fireEvent.click(view.getByRole("button", { name: "Filter Name" }));
    const dialog = view.getByRole("dialog", { name: "Filter Name" });
    const clear = within(dialog).getByText("Clear");

    // One synchronous burst: the funnel's Clear (chrome — records the
    // pending query), then the consumer's full setQuery before the model
    // settles either. The consumer's transition supersedes the chrome one,
    // so the chrome query never settles.
    act(() => {
      fireEvent.click(clear);
      ready().setQuery(CONSUMER_QUERY as never);
    });

    await waitFor(() => {
      expect(settledQuery(ready()).sort).toEqual(CONSUMER_SORT);
      expect(settledQuery(ready()).filters).toEqual([]);
    });

    // The NEXT chrome write: remove the grouping level via the strip's chip.
    // It names only `rowGroups`; the sort axis it re-submits must be the
    // consumer's settled sort, not the stale pending query's empty sort.
    const chip = view.container.querySelector("[data-pretable-chip-remove]")!;
    act(() => {
      fireEvent.click(chip);
    });

    await waitFor(() => {
      expect(settledQuery(ready()).rowGroups).toEqual([]);
    });
    expect(settledQuery(ready()).sort).toEqual(CONSUMER_SORT);
  });
});
