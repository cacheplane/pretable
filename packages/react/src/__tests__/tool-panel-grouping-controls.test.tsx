// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";
import type { PretableColumn } from "../types";

afterEach(cleanup);

/*
 * The tool panel's grouping section: expansion buttons and the hide-grouped
 * switch (SP3b Task 6). Split out of tool-panel-grouping-section.test.tsx to
 * keep both files under the jsdom budget.
 *
 * The jsdom derivation-flip budget once noted here is LIFTED: the stall was
 * diagnosed and fixed (#522; mechanism write-up and regression pin in
 * `grouping-derivation-flip-stall.test.tsx`).
 */

type Holding = {
  id: string;
  sector: string;
  name: string;
};

const rows: Holding[] = [
  { id: "r1", sector: "Tech", name: "alpha" },
  { id: "r2", sector: "Energy", name: "beta" },
];

const columns: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector", widthPx: 100, type: "text" },
  { id: "name", header: "Name", widthPx: 100, type: "text" },
];

type Grid = PretableSurfaceGrid<Holding, string, PretableColumn<Holding>[]>;

/** The settled engine query's grouping levels, by column id. */
function settled(grid: Grid): string[] {
  // The cast: the handle's query generic narrows `rowGroups` element types
  // by the columns parameter, which this harness leaves at its widest.
  const levels = grid.rowModel.getState().snapshot.query.rowGroups as readonly {
    columnId: string;
  }[];
  return levels.map((level) => level.columnId);
}

/**
 * UNCONTROLLED (no `query` prop), like the section test's harness: the engine
 * owns the query, so grouping is seeded through the public handle after mount
 * and awaited to a complete settle. `hideGroupedColumns` is deliberately NOT
 * passed as a prop anywhere here: the prop keeps writing after mount (the
 * handle's two-writer note), so the pane's own write is only observable when
 * the engine default seeds the state.
 */
async function mountControls(options?: { rowGroups?: string[] }) {
  const captured = { current: null as Grid | null };
  const view = render(
    <PretableSurface<Holding>
      ariaLabel="Grouping controls grid"
      columns={columns}
      getRowId={(row: Holding) => row.id}
      onGridReady={(grid) => {
        captured.current = grid as Grid;
      }}
      overscan={0}
      rows={rows}
      toolPanel={{ defaultActiveSection: "grouping" }}
      viewportHeight={300}
    />,
  );
  if (captured.current === null) {
    throw new Error("onGridReady never fired: no grid captured at mount");
  }
  const grid = captured.current;
  const seed = options?.rowGroups ?? [];
  if (seed.length > 0) {
    act(() => {
      grid.setQuery({
        filters: [],
        sort: [],
        rowGroups: seed.map((columnId) => ({ columnId })),
      } as never);
    });
    await waitFor(() => {
      expect(settled(grid)).toEqual(seed);
    });
  }
  return {
    view,
    grid,
    expandAll: () =>
      view.container.querySelector(
        "[data-pretable-expand-all]",
      ) as HTMLButtonElement,
    collapseAll: () =>
      view.container.querySelector(
        "[data-pretable-collapse-all]",
      ) as HTMLButtonElement,
    hideGrouped: () =>
      view.container.querySelector(
        "input[data-pretable-hide-grouped]",
      ) as HTMLInputElement,
    /** A known CHILD-row cell — present only while its group is expanded. */
    childCell: (text: string) =>
      Array.from(view.container.querySelectorAll("[data-pretable-cell]")).find(
        (cell) => cell.textContent === text,
      ) ?? null,
    headerFor: (columnId: string) =>
      view.container.querySelector(
        `[data-pretable-header-cell][data-pretable-column-id="${columnId}"]`,
      ),
  };
}

describe("grouping section expansion buttons", () => {
  it("Collapse all removes CHILD ROWS from the drawn grid; Expand all restores them", async () => {
    const h = await mountControls({ rowGroups: ["sector"] });
    // Groups default expanded: the child cells are drawn before any click.
    await waitFor(() => {
      expect(h.childCell("alpha")).not.toBeNull();
    });

    fireEvent.click(h.collapseAll());
    await waitFor(() => {
      expect(h.childCell("alpha")).toBeNull();
    });
    // Group rows themselves stay: collapse hides children, not groups.
    expect(
      h.view.container.querySelector("[data-pretable-group-row]"),
    ).not.toBeNull();

    fireEvent.click(h.expandAll());
    await waitFor(() => {
      expect(h.childCell("alpha")).not.toBeNull();
    });
    expect(h.childCell("beta")).not.toBeNull();
  });

  it("both buttons are disabled while ungrouped, enabled once grouped", async () => {
    const h = await mountControls();
    expect(h.expandAll()).toBeDisabled();
    expect(h.collapseAll()).toBeDisabled();

    act(() => {
      h.grid.setQuery({
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "sector" }],
      } as never);
    });
    await waitFor(() => {
      expect(h.expandAll()).not.toBeDisabled();
    });
    expect(h.collapseAll()).not.toBeDisabled();
  });
});

describe("grouping section hide-grouped switch", () => {
  it("toggling unchecks the box AND draws the grouped column's header; toggling back removes it", async () => {
    const h = await mountControls({ rowGroups: ["sector"] });
    // Engine default: the key is ABSENT, and the surface hides grouped
    // columns unless it is EXPLICITLY false (`resolveEffectiveColumns`) —
    // so the switch starts CHECKED, matching the drawn grid it describes.
    expect(h.hideGrouped()).toBeChecked();
    // Polled, not one-shot: the mount's seeded `rowGroups` settles
    // asynchronously, and until it lands the grouped column is still an
    // ordinary drawn column — a one-shot read here raced that settle and
    // failed under CI load (third sighting; not a flake).
    await waitFor(() => {
      expect(h.headerFor("sector")).toBeNull();
    });

    fireEvent.click(h.hideGrouped());
    await waitFor(() => {
      expect(h.headerFor("sector")).not.toBeNull();
    });
    expect(h.hideGrouped()).not.toBeChecked();
    // The ungrouped column is drawn throughout: the switch acts on GROUPED
    // columns only.
    expect(h.headerFor("name")).not.toBeNull();

    fireEvent.click(h.hideGrouped());
    await waitFor(() => {
      expect(h.headerFor("sector")).toBeNull();
    });
    expect(h.hideGrouped()).toBeChecked();
  });
});
