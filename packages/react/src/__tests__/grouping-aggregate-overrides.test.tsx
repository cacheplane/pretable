// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { createColumnHelper, type PretableQueryFor } from "@pretable/core";

import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";

type Holding = {
  id: string;
  sector: string;
  qty: number;
};

/*
 * Split out of `grouping-state-engine.test.tsx`: see the note there for the
 * module-cumulative re-derivation stall. These three tests spend five changes
 * between them and no more than two on any one grid — under the per-grid
 * threshold, and under the module one. Because the budget is CUMULATIVE, a
 * fourth test here can break one of these three rather than itself.
 */
const helper = createColumnHelper<Holding>();

/**
 * `qty` declares `sum`. Over the Tech rows sum is 30, count is 2 and max is
 * 20 — three distinct numbers, so every override here changes the RESULT and
 * not merely the label. A fixture whose aggregates agreed would pass whether
 * or not the override reached the row model.
 */
const COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "sum" }),
] as const;

const ROWS: readonly Holding[] = [
  { id: "h1", sector: "Tech", qty: 10 },
  { id: "h2", sector: "Tech", qty: 20 },
  { id: "h3", sector: "Energy", qty: 5 },
];

const GROUPED_QUERY: PretableQueryFor<typeof COLUMNS> = {
  filters: [],
  sort: [],
  rowGroups: [{ columnId: "sector" }],
};

const getRowId = (row: Holding) => row.id;

afterEach(cleanup);

type Grid = PretableSurfaceGrid<Holding, string, typeof COLUMNS>;

function renderGrouped(props: {
  readonly hideGroupedColumns?: boolean;
  readonly onGridReady: (grid: Grid) => void;
}) {
  return render(
    <PretableSurface<Holding, string, typeof COLUMNS>
      ariaLabel="holdings"
      columns={COLUMNS}
      getRowId={getRowId}
      hideGroupedColumns={props.hideGroupedColumns}
      onGridReady={props.onGridReady}
      onQueryChange={() => {}}
      overscan={0}
      query={GROUPED_QUERY}
      rows={ROWS}
      viewportHeight={400}
    />,
  );
}

function techAggregateText(container: HTMLElement): string {
  const techGroup = [
    ...container.querySelectorAll("[data-pretable-group-row]"),
  ].find((row) => row.textContent?.includes("Tech"));
  return (
    techGroup?.querySelector('[data-pretable-column-id="qty"]')?.textContent ??
    ""
  );
}

describe("the surface merges grid-core aggregate overrides into derivations", () => {
  test("an override changes the rendered aggregate with no columns-prop change", async () => {
    let grid: Grid | null = null;
    const view = renderGrouped({
      onGridReady: (ready) => {
        grid = ready;
      },
    });

    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    act(() => {
      (grid as unknown as Grid).setColumnAggregate("qty", "count");
    });
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("2");
    });
  });

  test("clearing the override restores the declared aggregate", async () => {
    let grid: Grid | null = null;
    const view = renderGrouped({
      onGridReady: (ready) => {
        grid = ready;
      },
    });
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    act(() => {
      (grid as unknown as Grid).setColumnAggregate("qty", "count");
    });
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("2");
    });

    act(() => {
      (grid as unknown as Grid).setColumnAggregate("qty", undefined);
    });
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });
  });

  test("a second override on the same column replaces the first", async () => {
    let grid: Grid | null = null;
    const view = renderGrouped({
      onGridReady: (ready) => {
        grid = ready;
      },
    });
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    act(() => {
      (grid as unknown as Grid).setColumnAggregate("qty", "count");
    });
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("2");
    });

    // The KEY SET is identical across this write — only the value moves. That
    // is the half of the translation cache's set-equality test that nothing
    // else reaches: compare keys alone and the memo hands back the stale
    // object, and this second override is swallowed with no error anywhere.
    // Switching one column's aggregate twice is the ordinary tool-panel
    // gesture, not an edge case.
    act(() => {
      (grid as unknown as Grid).setColumnAggregate("qty", "max");
    });
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("20");
    });
  });
});
