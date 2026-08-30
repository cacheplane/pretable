// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  GROUP_COLUMN_ID,
  type PretableQueryFor,
} from "@pretable/core";

import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";

type Holding = {
  id: string;
  sector: string;
  qty: number;
  price: number;
};

/*
 * Split from the other two grouping files for what was then thought to be a
 * jsdom derivation-flip budget. That stall is diagnosed and fixed (#522; see
 * `grouping-derivation-flip-stall.test.tsx`) — derivation changes are no
 * longer rationed; the split is topical organization only.
 */
const helper = createColumnHelper<Holding>();

const BASE_COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "sum" }),
] as const;

/**
 * `price` arrives AFTER mount. Over the Tech rows its sum is 3 and its count
 * is 2, so an override to `"count"` moves the rendered value — a fixture whose
 * sum and count agreed would pass whether or not the override arrived.
 */
const LATE_COLUMNS = [
  ...BASE_COLUMNS,
  helper.accessor("price", { type: "number", aggregate: "sum" }),
] as const;

const ROWS: readonly Holding[] = [
  { id: "h1", sector: "Tech", qty: 10, price: 1 },
  { id: "h2", sector: "Tech", qty: 20, price: 2 },
  { id: "h3", sector: "Energy", qty: 5, price: 7 },
];

const GROUPED_QUERY: PretableQueryFor<typeof LATE_COLUMNS> = {
  filters: [],
  sort: [],
  rowGroups: [{ columnId: "sector" }],
};

const getRowId = (row: Holding) => row.id;

afterEach(cleanup);

type Grid = PretableSurfaceGrid<Holding, string, typeof LATE_COLUMNS>;

function groupedElement(props: {
  readonly columns: typeof BASE_COLUMNS | typeof LATE_COLUMNS;
  readonly onGridReady: (grid: Grid) => void;
}) {
  return (
    <PretableSurface<Holding, string, typeof LATE_COLUMNS>
      ariaLabel="holdings"
      // The surface is TYPED against the widest roster this test uses, so
      // `price` is nameable on the handle; what matters here is that the
      // grid MOUNTS with the narrower one.
      columns={props.columns as unknown as typeof LATE_COLUMNS}
      getRowId={getRowId}
      onGridReady={props.onGridReady}
      onQueryChange={() => {}}
      overscan={0}
      query={GROUPED_QUERY}
      rows={ROWS}
      viewportHeight={400}
    />
  );
}

function techAggregateText(container: HTMLElement, columnId: string): string {
  const techGroup = [
    ...container.querySelectorAll("[data-pretable-group-row]"),
  ].find((row) => row.textContent?.includes("Tech"));
  return (
    techGroup?.querySelector(`[data-pretable-column-id="${columnId}"]`)
      ?.textContent ?? ""
  );
}

describe("the override vocabulary is the CURRENT derivation list", () => {
  test("a column added after mount can still be overridden", async () => {
    let grid: Grid | null = null;
    const onGridReady = (ready: Grid) => {
      grid = ready;
    };
    const view = render(groupedElement({ columns: BASE_COLUMNS, onGridReady }));
    await waitFor(() => {
      expect(techAggregateText(view.container, "qty")).toBe("30");
    });

    view.rerender(groupedElement({ columns: LATE_COLUMNS, onGridReady }));
    await waitFor(() => {
      expect(techAggregateText(view.container, "price")).toBe("3");
    });

    act(() => {
      (grid as unknown as Grid).setColumnAggregate("price", "count");
    });

    // `price` is absent from the row model's `getColumns()`, which is frozen
    // at the tuple the model was CREATED with. Translating against that tuple
    // filtered this override away before it could reach the merge.
    await waitFor(() => {
      expect(techAggregateText(view.container, "price")).toBe("2");
    });
  });
});

describe("an override outside the derivation vocabulary is inert", () => {
  test("writing one does not re-request derivations", async () => {
    let grid: Grid | null = null;
    const onGridReady = (ready: Grid) => {
      grid = ready;
    };
    const view = render(groupedElement({ columns: BASE_COLUMNS, onGridReady }));
    await waitFor(() => {
      expect(techAggregateText(view.container, "qty")).toBe("30");
    });

    const ready = grid as unknown as Grid;
    const setDerivations = vi.spyOn(ready.rowModel, "setDerivations");

    // A real override first, so the merge is on its APPLYING path — that is
    // the only path where a fresh-but-equal overrides object would produce a
    // fresh merged array and re-request derivations.
    act(() => {
      ready.setColumnAggregate("qty", "count");
    });
    await waitFor(() => {
      expect(techAggregateText(view.container, "qty")).toBe("2");
    });
    expect(setDerivations).toHaveBeenCalledTimes(1);

    // The derived group column is a LAYOUT column with no derivation behind
    // it. grid-core records the write and publishes a new `columnAggregates`;
    // the translation must drop it AND keep its own result value-stable, or
    // this write costs a `compileQuery` for a column the row model cannot see.
    act(() => {
      // Cast around a PRE-EXISTING TYPE GAP, not around a deliberate guard.
      // `PretableSurfaceGrid` (`pretable-surface.tsx:1322`) instantiates
      // `PretableReactGrid<TRow, TRowId, TColumns>` and leaves `TColumnId` at
      // its default — the SCHEMA ids — even though the surface is the one
      // layer that draws synthetic columns. So `setColumnVisible`,
      // `setColumnPinned`, `setColumnWidth` and `setColumnOrder` are equally
      // unable to name `GROUP_COLUMN_ID` from a surface handle, and
      // `setColumnAggregate`'s own "ids are the DRAWN vocabulary" JSDoc does
      // not hold on this handle. Out of scope here; the runtime layout
      // vocabulary is the wider one, and that is what this test covers.
      (ready.setColumnAggregate as (id: string, aggregate: unknown) => void)(
        GROUP_COLUMN_ID,
        "sum",
      );
    });
    expect(ready.getState().columnAggregates).toHaveProperty(
      GROUP_COLUMN_ID,
      "sum",
    );
    expect(setDerivations).toHaveBeenCalledTimes(1);
    expect(techAggregateText(view.container, "qty")).toBe("2");

    setDerivations.mockRestore();
  });
});
