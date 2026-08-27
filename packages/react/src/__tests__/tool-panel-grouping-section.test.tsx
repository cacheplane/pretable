// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultMessages } from "../messages";
import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";
import { GroupingSection } from "../tool-panel/grouping";
import type { PretableColumn } from "../types";

afterEach(cleanup);

/*
 * The tool panel's grouping section: the group-by block — list, remove,
 * drag-reorder, add menu (SP3b Task 5).
 *
 * jsdom budget note (canonical write-up: grouping-state-engine.test.tsx, the
 * header comment): a grouped grid stops re-deriving once a jsdom module has
 * changed derivations enough times — around the fourth change on ONE grid,
 * and around the seventh CUMULATIVE change across a module however many
 * grids share it. It is MODULE-CUMULATIVE, not per-grid, so any test added
 * to any of these files can tip a later one over, and the symptom is an
 * unexplained `waitFor` timeout that points nowhere near the cause. These
 * tests flip GROUPING (query state), not derivations, and no column declares
 * an aggregate — but the file is kept lean regardless.
 */

type Holding = {
  id: string;
  sector: string;
  region: string;
  name: string;
};

const rows: Holding[] = [
  { id: "r1", sector: "Tech", region: "US", name: "alpha" },
  { id: "r2", sector: "Energy", region: "EU", name: "beta" },
];

const columns: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector", widthPx: 100, type: "text" },
  { id: "region", header: "Region", widthPx: 100, type: "text" },
  { id: "name", header: "Name", widthPx: 100, type: "text" },
];

type Grid = PretableSurfaceGrid<Holding, string, PretableColumn<Holding>[]>;

/** The settled engine query's grouping levels, by column id. */
function settled(grid: Grid): string[] {
  // The cast: the handle's query generic narrows `rowGroups` element types
  // by the columns parameter, which this harness leaves at its widest.
  const levels = grid.rowModel.getState().snapshot.query
    .rowGroups as readonly { columnId: string }[];
  return levels.map((level) => level.columnId);
}

/**
 * UNCONTROLLED (no `query` prop), like grouping-query-write's harness: the
 * engine owns the query, so the pane's `applyRowGroups` writes actually land
 * and settle instead of merely reporting intent. Grouping is seeded through
 * the public handle after mount and awaited to a COMPLETE settle, so each
 * test's own write is the only thing in flight.
 */
async function mountGrouping(options?: {
  rowGroups?: string[];
  groupPanel?: boolean;
}) {
  const captured = { current: null as Grid | null };
  const view = render(
    <PretableSurface<Holding>
      ariaLabel="Grouping section grid"
      columns={columns}
      getRowId={(row: Holding) => row.id}
      onGridReady={(grid) => {
        captured.current = grid as Grid;
      }}
      overscan={0}
      rows={rows}
      toolPanel={{ defaultActiveSection: "grouping" }}
      {...(options?.groupPanel ? { groupPanel: { enabled: true } } : {})}
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
  const pane = () =>
    view.container.querySelector("[data-pretable-tool-grouping]") as
      | HTMLElement
      | null;
  const groupRows = () =>
    Array.from(
      view.container.querySelectorAll("[data-pretable-tool-group-row]"),
    ) as HTMLElement[];
  const rowByLabel = (label: string) =>
    groupRows().find(
      (row) =>
        row.querySelector("[data-pretable-tool-column-label]")?.textContent ===
        label,
    );
  return {
    view,
    grid,
    pane,
    groupRows,
    rowByLabel,
    rowLabels: () =>
      groupRows().map(
        (row) =>
          row.querySelector("[data-pretable-tool-column-label]")?.textContent,
      ),
    removeFor: (label: string) =>
      rowByLabel(label)?.querySelector(
        "[data-pretable-tool-group-remove]",
      ) as HTMLButtonElement | undefined,
    gripFor: (label: string) => {
      const grip = rowByLabel(label)?.querySelector(
        "[data-pretable-tool-row-grip]",
      ) as HTMLElement | null | undefined;
      if (!grip) throw new Error(`No grip rendered for ${label}`);
      return grip;
    },
    addButton: () =>
      view.container.querySelector(
        "[data-pretable-add-group]",
      ) as HTMLButtonElement,
    /** The add menu lives in an OverlayPortal, so it is queried on document. */
    menu: () =>
      document.querySelector(
        "[data-pretable-add-group-menu]",
      ) as HTMLElement | null,
    menuItems: () =>
      Array.from(
        document.querySelectorAll(
          "[data-pretable-add-group-menu] [data-pretable-menu-item]",
        ),
      ) as HTMLButtonElement[],
    /** The strip's chips, by visible label — the one-model counterpart. */
    chipLabels: () =>
      Array.from(
        view.container.querySelectorAll("[data-pretable-chip-label]"),
      ).map((el) => el.textContent),
    chipRemoveFor: (label: string) =>
      (Array.from(
        view.container.querySelectorAll("[data-pretable-group-chip]"),
      ) as HTMLElement[])
        .find(
          (chip) =>
            chip.querySelector("[data-pretable-chip-label]")?.textContent ===
            label,
        )
        ?.querySelector("[data-pretable-chip-remove]") as
        | HTMLElement
        | undefined,
  };
}

describe("grouping section group-by list", () => {
  it("renders one row per grouping level, in engine order, labelled by column header", async () => {
    const h = await mountGrouping({ rowGroups: ["sector", "region"] });
    expect(h.rowLabels()).toEqual(["Sector", "Region"]);
    expect(h.pane()?.textContent).toContain("Group by");
    // No empty-state message while levels exist.
    expect(h.pane()?.textContent).not.toContain("No groups");
  });

  it("renders the raw id for a grouped id outside the schema", () => {
    // Direct mount with structural fakes: the surface schema-filters its own
    // writes, so an out-of-schema id can only be pinned at the section seam.
    // Stable state objects: `useSyncExternalStore` demands a cached snapshot
    // (a fresh object per `getState` reads as an endless external change).
    const rowModelState = {
      snapshot: { query: { rowGroups: [{ columnId: "ghost" }] } },
    };
    const rowModel = {
      subscribe: () => () => {},
      getState: () => rowModelState,
      expandAll: () => {},
      collapseAll: () => {},
    };
    const gridState = { columnAggregates: {} };
    const grid = {
      subscribe: () => () => {},
      getState: () => gridState,
      setHideGroupedColumns: () => {},
      setColumnAggregate: () => {},
    };
    const { container } = render(
      <GroupingSection
        grid={grid}
        rowModel={rowModel}
        applyRowGroups={() => {}}
        columns={[{ id: "sector", label: "Sector" }]}
        aggregatesEnabled={true}
        messages={defaultMessages}
      />,
    );
    const row = container.querySelector("[data-pretable-tool-group-row]");
    expect(row).not.toBeNull();
    expect(
      row?.querySelector("[data-pretable-tool-column-label]")?.textContent,
    ).toBe("ghost");
  });

  it("commits NOTHING at the list's ends or from a cancelled drag — asserted on the write itself", () => {
    // Structural fakes + a spied write: the surface-level twins above prove
    // the settled engine state, but a settle-based negative can pass by
    // timing alone. Zero CALLS cannot.
    const apply = vi.fn();
    const rowModelState = {
      snapshot: {
        query: {
          rowGroups: [{ columnId: "sector" }, { columnId: "region" }],
        },
      },
    };
    const rowModel = {
      subscribe: () => () => {},
      getState: () => rowModelState,
      expandAll: () => {},
      collapseAll: () => {},
    };
    const gridState = { columnAggregates: {} };
    const grid = {
      subscribe: () => () => {},
      getState: () => gridState,
      setHideGroupedColumns: () => {},
      setColumnAggregate: () => {},
    };
    const { container } = render(
      <GroupingSection
        grid={grid}
        rowModel={rowModel}
        applyRowGroups={apply}
        columns={[
          { id: "sector", label: "Sector" },
          { id: "region", label: "Region" },
        ]}
        aggregatesEnabled={true}
        messages={defaultMessages}
      />,
    );
    const grips = Array.from(
      container.querySelectorAll("[data-pretable-tool-row-grip]"),
    ) as HTMLElement[];
    const first = grips[0]!;
    const last = grips[grips.length - 1]!;

    // No wrap: the boundary chords have no neighbor to swap with.
    fireEvent.keyDown(last, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(first, { key: "ArrowUp", shiftKey: true });
    expect(apply).not.toHaveBeenCalled();

    // Escape mid-drag: the cancelled gesture's release commits nothing.
    fireEvent.pointerDown(last, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(last, { pointerId: 1, clientX: 10, clientY: 60 });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.pointerUp(last, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(apply).not.toHaveBeenCalled();
  });

  it("renders the empty state while ungrouped, and the add menu then lists every column", async () => {
    const h = await mountGrouping();
    expect(h.groupRows()).toHaveLength(0);
    expect(h.pane()?.textContent).toContain("No groups. Rows are ungrouped.");

    fireEvent.click(h.addButton());
    expect(h.menuItems().map((item) => item.textContent)).toEqual([
      "Sector",
      "Region",
      "Name",
    ]);
  });

  it("remove commits the SHORTENED list to the engine and the list follows", async () => {
    const h = await mountGrouping({ rowGroups: ["sector", "region"] });
    const remove = h.removeFor("Sector");
    expect(remove).toHaveAccessibleName("Remove grouping by Sector");

    fireEvent.click(remove!);

    await waitFor(() => {
      expect(settled(h.grid)).toEqual(["region"]);
    });
    expect(h.rowLabels()).toEqual(["Region"]);
  });

  it("the add menu lists only UNGROUPED columns, appends on select, and closes", async () => {
    const h = await mountGrouping({ rowGroups: ["sector"] });
    const add = h.addButton();
    expect(add).toHaveAccessibleName("Add group");
    expect(add).not.toBeDisabled();

    fireEvent.click(add);
    expect(h.menuItems().map((item) => item.textContent)).toEqual([
      "Region",
      "Name",
    ]);

    fireEvent.click(
      h.menuItems().find((item) => item.textContent === "Region")!,
    );
    expect(h.menu()).toBeNull();
    await waitFor(() => {
      expect(settled(h.grid)).toEqual(["sector", "region"]);
    });
    expect(h.rowLabels()).toEqual(["Sector", "Region"]);
  });

  it("disables the add button once every column is grouped", async () => {
    const h = await mountGrouping({ rowGroups: ["sector", "region", "name"] });
    expect(h.addButton()).toBeDisabled();
  });

  it("menu keyboard: first item focused on open, arrows rove, Escape closes and returns focus to the button", async () => {
    const h = await mountGrouping();
    fireEvent.click(h.addButton());
    const items = h.menuItems();
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(h.menu()!, { key: "ArrowDown" });
    expect(items[1]).toHaveFocus();

    fireEvent.keyDown(h.menu()!, { key: "Escape" });
    expect(h.menu()).toBeNull();
    expect(h.addButton()).toHaveFocus();
  });

  it("Shift+ArrowDown reorders on the ENGINE, refocuses the grip, and never wraps at the ends", async () => {
    const h = await mountGrouping({ rowGroups: ["sector", "region"] });
    const grip = h.gripFor("Sector");
    expect(grip).toHaveAccessibleName("Reorder grouping by Sector");
    grip.focus();

    fireEvent.keyDown(grip, { key: "ArrowDown", shiftKey: true });

    await waitFor(() => {
      expect(settled(h.grid)).toEqual(["region", "sector"]);
    });
    expect(h.rowLabels()).toEqual(["Region", "Sector"]);
    expect(h.gripFor("Sector")).toHaveFocus();

    // At the list's end nothing moves and nothing is committed (no wrap).
    fireEvent.keyDown(h.gripFor("Sector"), {
      key: "ArrowDown",
      shiftKey: true,
    });
    expect(settled(h.grid)).toEqual(["region", "sector"]);
    expect(h.rowLabels()).toEqual(["Region", "Sector"]);
  });

  it("pointer drag: marks the row, draws the indicator, commits NOTHING until release — then the whole reordered list", async () => {
    const h = await mountGrouping({ rowGroups: ["sector", "region"] });
    const grip = h.gripFor("Sector");
    const row = h.rowByLabel("Sector")!;

    fireEvent.pointerDown(grip, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    // Under the 5px threshold: still a press, not a drag.
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 10, clientY: 12 });
    expect(row.hasAttribute("data-pretable-tool-row-dragging")).toBe(false);

    // Past the threshold. jsdom rects are all 0×0, so the pure drop-target
    // function resolves "after the last row" — a real reorder on release.
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(row.hasAttribute("data-pretable-tool-row-dragging")).toBe(true);
    expect(
      h.view.container.querySelector("[data-pretable-tool-drop-indicator]"),
    ).not.toBeNull();
    // Commit on drop, never mid-move.
    expect(settled(h.grid)).toEqual(["sector", "region"]);

    fireEvent.pointerUp(grip, { pointerId: 1, clientX: 10, clientY: 60 });
    await waitFor(() => {
      expect(settled(h.grid)).toEqual(["region", "sector"]);
    });
    expect(h.rowLabels()).toEqual(["Region", "Sector"]);
  });

  it("Escape mid-drag cancels: state cleared, engine untouched, and the release commits nothing", async () => {
    const h = await mountGrouping({ rowGroups: ["sector", "region"] });
    const grip = h.gripFor("Sector");
    const row = h.rowByLabel("Sector")!;

    fireEvent.pointerDown(grip, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(row.hasAttribute("data-pretable-tool-row-dragging")).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(row.hasAttribute("data-pretable-tool-row-dragging")).toBe(false);
    expect(
      h.view.container.querySelector("[data-pretable-tool-drop-indicator]"),
    ).toBeNull();

    // The release that ends the abandoned gesture must not resurrect it.
    fireEvent.pointerUp(grip, { pointerId: 1, clientX: 10, clientY: 60 });
    expect(settled(h.grid)).toEqual(["sector", "region"]);
    expect(h.rowLabels()).toEqual(["Sector", "Region"]);
  });

  it("strip and pane are two projections of ONE model: a write through either updates both", async () => {
    const h = await mountGrouping({
      rowGroups: ["sector", "region"],
      groupPanel: true,
    });
    expect(h.chipLabels()).toEqual(["Sector", "Region"]);

    // Pane → strip.
    fireEvent.click(h.removeFor("Sector")!);
    await waitFor(() => {
      expect(h.chipLabels()).toEqual(["Region"]);
    });
    expect(h.rowLabels()).toEqual(["Region"]);

    // Strip → pane.
    fireEvent.click(h.chipRemoveFor("Region")!);
    await waitFor(() => {
      expect(h.groupRows()).toHaveLength(0);
    });
    expect(h.chipLabels()).toEqual([]);
    expect(h.pane()?.textContent).toContain("No groups. Rows are ungrouped.");
  });
});
