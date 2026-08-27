// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createColumnHelper, type PretableQueryFor } from "@pretable/core";

import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";
import { usePretable } from "../use-pretable";

type Holding = {
  id: string;
  sector: string;
  qty: number;
};

/*
 * The engine-written aggregate-override cases live in
 * `grouping-aggregate-overrides.test.tsx` and
 * `grouping-aggregate-vocabulary.test.tsx`, not here.
 *
 * A grouped grid stops re-deriving once a jsdom module has changed
 * derivations enough times — around the fourth change on ONE grid, and around
 * the seventh CUMULATIVE change across a module however many grids share it
 * (six fresh grids × two changes each stalled on the seventh). It is
 * MODULE-CUMULATIVE, not per-grid, so any test added to any of these files can
 * tip a later one over, and the symptom is an unexplained `waitFor` timeout
 * that points nowhere near the cause. Pre-existing: reproduced 4/4 on this
 * commit's parent with all three react source files reverted and nothing but
 * prop-driven `aggregate` changes. Splitting keeps every file under the
 * threshold; this one spends two.
 */
const helper = createColumnHelper<Holding>();

/**
 * `qty` declares `sum`. Over the Tech rows sum is 30 and count is 2, so an
 * override to `"count"` changes the RESULT and not merely the label — a
 * fixture that could not distinguish the two would pass whether or not the
 * override reached the row model.
 */
const COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "sum" }),
] as const;

const COUNTING_COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "count" }),
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

function groupedElement(props: {
  readonly hideGroupedColumns?: boolean;
  readonly columns?: typeof COLUMNS | typeof COUNTING_COLUMNS;
  readonly onGridReady?: (grid: Grid) => void;
}) {
  return (
    <PretableSurface<Holding, string, typeof COLUMNS>
      ariaLabel="holdings"
      columns={(props.columns ?? COLUMNS) as unknown as typeof COLUMNS}
      getRowId={getRowId}
      hideGroupedColumns={props.hideGroupedColumns}
      onGridReady={props.onGridReady}
      onQueryChange={() => {}}
      overscan={0}
      query={GROUPED_QUERY}
      rows={ROWS}
      viewportHeight={400}
    />
  );
}

function renderGrouped(props: {
  readonly hideGroupedColumns?: boolean;
  readonly columns?: typeof COLUMNS | typeof COUNTING_COLUMNS;
  readonly onGridReady: (grid: Grid) => void;
}) {
  return render(groupedElement(props));
}

function headerIds(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[data-pretable-header-cell]")].map(
    (header) => header.getAttribute("data-pretable-column-id") ?? "",
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

describe("the surface seeds hideGroupedColumns and reads it from the engine", () => {
  test("the prop seeds grid-core at mount", () => {
    let grid: Grid | null = null;
    renderGrouped({
      hideGroupedColumns: false,
      onGridReady: (ready) => {
        grid = ready;
      },
    });

    expect(grid).not.toBeNull();
    expect((grid as unknown as Grid).getState().hideGroupedColumns).toBe(false);
  });

  test("an omitted prop leaves the key ABSENT, not false", () => {
    let grid: Grid | null = null;
    renderGrouped({
      onGridReady: (ready) => {
        grid = ready;
      },
    });

    expect("hideGroupedColumns" in (grid as unknown as Grid).getState()).toBe(
      false,
    );
  });

  test("setHideGroupedColumns changes the drawn columns with no prop change", () => {
    let grid: Grid | null = null;
    const view = renderGrouped({
      onGridReady: (ready) => {
        grid = ready;
      },
    });

    // Default ON: the grouped column is dropped from the drawn set.
    expect(headerIds(view.container)).not.toContain("sector");

    act(() => {
      (grid as unknown as Grid).setHideGroupedColumns(false);
    });
    expect(headerIds(view.container)).toContain("sector");

    act(() => {
      (grid as unknown as Grid).setHideGroupedColumns(true);
    });
    expect(headerIds(view.container)).not.toContain("sector");
  });
});

describe("the hideGroupedColumns prop keeps writing after mount", () => {
  test("a changed prop is written onto the engine", () => {
    let grid: Grid | null = null;
    const onGridReady = (ready: Grid) => {
      grid = ready;
    };
    const view = renderGrouped({ onGridReady });
    expect(headerIds(view.container)).not.toContain("sector");

    view.rerender(groupedElement({ hideGroupedColumns: false, onGridReady }));

    // The prop is the seed, but a consumer still driving it declaratively must
    // not lose control of the engine value.
    expect((grid as unknown as Grid).getState().hideGroupedColumns).toBe(false);
    expect(headerIds(view.container)).toContain("sector");
  });

  test("a prop change to undefined is swallowed, never restoring ABSENT", () => {
    let grid: Grid | null = null;
    const onGridReady = (ready: Grid) => {
      grid = ready;
    };
    // Mounted with an EXPLICIT `true` rather than `false`, and that choice is
    // the whole test: starting from `false` cannot tell "swallowed" apart from
    // "wrote `false` again". From `true`, a `?? false` write would reveal the
    // grouped column.
    const view = renderGrouped({ hideGroupedColumns: true, onGridReady });
    expect(headerIds(view.container)).not.toContain("sector");

    view.rerender(groupedElement({ onGridReady }));

    // The asymmetric half of the rule. There is no engine write that restores
    // "absent", and writing `false` for an omitted prop would flip the value
    // out from under everyone reading the engine — so an omitted prop is a
    // no-op, not a reset. Pinned because it is the surprising half.
    expect("hideGroupedColumns" in (grid as unknown as Grid).getState()).toBe(
      true,
    );
    expect((grid as unknown as Grid).getState().hideGroupedColumns).toBe(true);
    expect(headerIds(view.container)).not.toContain("sector");
  });
});

describe("an untouched consumer sees today's behaviour", () => {
  test("a consumer that touches neither still gets today's behaviour", async () => {
    // The survives-test. No engine write happens anywhere in it: the declared
    // aggregate must still compute, the grouped column must still be dropped,
    // and a CHANGE to the columns prop must still be obeyed — the old path,
    // not merely the new one.
    const onGridReady = vi.fn();
    const view = renderGrouped({ onGridReady });

    expect(headerIds(view.container)).not.toContain("sector");
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    view.rerender(groupedElement({ columns: COUNTING_COLUMNS, onGridReady }));

    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("2");
    });
  });
});

describe("aggregate overrides do not churn derivations", () => {
  test("a re-render, and a restated override, request derivations zero times", async () => {
    const { rerender, result } = renderHook(
      () =>
        usePretable({
          columns: COLUMNS,
          getRowId,
          query: GROUPED_QUERY,
          onQueryChange: () => {},
          rows: ROWS,
          viewportHeight: 400,
        }),
      { initialProps: {} },
    );

    await waitFor(() => {
      expect(
        result.current.rowModel.getState().snapshot.query.rowGroups,
      ).length(1);
    });

    const setDerivations = vi.spyOn(result.current.rowModel, "setDerivations");

    rerender({});
    rerender({});
    expect(setDerivations).toHaveBeenCalledTimes(0);

    act(() => {
      result.current.grid.setColumnAggregate("qty", "count");
    });
    expect(setDerivations).toHaveBeenCalledTimes(1);

    // A restated override publishes nothing (grid-core no-ops on an equal
    // value), and the memo keeps the merged array's identity, so neither the
    // extra renders nor the restatement re-request derivations.
    rerender({});
    act(() => {
      result.current.grid.setColumnAggregate("qty", "count");
    });
    rerender({});
    expect(setDerivations).toHaveBeenCalledTimes(1);

    setDerivations.mockRestore();
  });
});
