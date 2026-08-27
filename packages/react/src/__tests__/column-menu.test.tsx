import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PretableQueryFor } from "@pretable/core";

import { ColumnMenu } from "../column-menu/ColumnMenu";
import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import type { PretableSurfaceState } from "../use-pretable";

afterEach(() => {
  cleanup();
});

type Holding = {
  id: string;
  sector: string;
  industry: string;
  name: string;
};

const rows: Holding[] = [
  { id: "r1", sector: "Tech", industry: "Software", name: "alpha" },
  { id: "r2", sector: "Tech", industry: "Hardware", name: "beta" },
  { id: "r3", sector: "Energy", industry: "Oil", name: "gamma" },
];

const columns: PretableColumn<Holding>[] = [
  { id: "sector", header: "Sector", widthPx: 100 },
  { id: "industry", header: "Industry", widthPx: 100 },
  { id: "name", header: "Name", widthPx: 100 },
];

interface GridProps {
  groupPanel?: { enabled: boolean; emptyMessage?: string };
  onRowGroupsChange?: (rowGroups: string[]) => void;
  state?: PretableSurfaceState & { rowGroups?: string[] };
}

function Grid({ groupPanel, onRowGroupsChange, state }: GridProps) {
  const [query, setQuery] = React.useState<
    PretableQueryFor<
      readonly {
        id: string;
        accessor: (row: Holding) => string;
        type: "text";
      }[]
    >
  >(() => ({
    filters: [],
    sort: [],
    rowGroups: (state?.rowGroups ?? []).map((columnId) => ({ columnId })),
  }));
  return (
    <PretableSurface
      ariaLabel="test-grid"
      columns={columns}
      getRowId={(row: Holding) => row.id}
      groupPanel={groupPanel ?? { enabled: true }}
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        onRowGroupsChange?.(next.rowGroups.map((entry) => entry.columnId));
      }}
      overscan={0}
      rows={rows}
      state={state}
      viewportHeight={600}
    />
  );
}

const renderGrid = (props: GridProps = {}) => render(<Grid {...props} />);

/** Open a column's menu the way a pointer does: pointerdown, then click. */
function openMenu(button: HTMLElement) {
  fireEvent.pointerDown(button);
  fireEvent.click(button);
}

const menuButtons = (view: { container: HTMLElement }) =>
  [
    ...view.container.querySelectorAll("[data-pretable-column-menu-button]"),
  ].map((el) => el.getAttribute("data-pretable-column-id"));

describe("ColumnMenu — the popover on its own", () => {
  // Rendered without a surface so the `grouped` prop can be set directly.
  // Not because the branch is unreachable higher up — it is: a grouped column
  // with `hideGroupedColumns={false}` keeps its header, and its ⋮ offers
  // exactly this item. See the note in ColumnMenu.tsx.
  function renderMenu(
    props: Partial<React.ComponentProps<typeof ColumnMenu>> = {},
  ) {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    anchor.focus();
    const view = render(
      <ColumnMenu
        anchor={anchor}
        columnId="sector"
        grouped={false}
        label="Sector"
        onClose={() => {}}
        onSelect={() => {}}
        {...props}
      />,
    );
    return { ...view, anchor };
  }

  it("is a role=menu whose items are role=menuitem", () => {
    const view = renderMenu();
    const menu = view.getByRole("menu");
    expect(menu).toHaveAttribute("aria-label", "Column menu for Sector");
    expect(view.getAllByRole("menuitem")).toHaveLength(1);
  });

  it("offers Group by this column when the column is not grouped", () => {
    const onSelect = vi.fn();
    const view = renderMenu({ grouped: false, onSelect });
    const item = view.getByRole("menuitem", { name: "Group by this column" });
    expect(
      view.queryByRole("menuitem", { name: "Ungroup this column" }),
    ).toBeNull();

    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith("group");
  });

  it("offers Ungroup this column when the column is already grouped", () => {
    const onSelect = vi.fn();
    const view = renderMenu({ grouped: true, onSelect });
    const item = view.getByRole("menuitem", { name: "Ungroup this column" });
    expect(
      view.queryByRole("menuitem", { name: "Group by this column" }),
    ).toBeNull();

    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalledWith("ungroup");
  });

  it("focuses its first item on open", () => {
    const view = renderMenu();
    expect(document.activeElement).toBe(view.getByRole("menuitem"));
  });

  it("Escape closes and hands focus back to the button", () => {
    const onClose = vi.fn();
    const { anchor, ...view } = renderMenu({ onClose });
    fireEvent.keyDown(view.getByRole("menu"), { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);
  });

  it("hands focus back to the button after an item is chosen", () => {
    const { anchor, ...view } = renderMenu();
    fireEvent.click(view.getByRole("menuitem"));
    expect(document.activeElement).toBe(anchor);
  });
});

describe("column menu in the surface", () => {
  it("gives every data column a ⋮ button when the panel is enabled", () => {
    const view = renderGrid();
    expect(menuButtons(view)).toEqual(["sector", "industry", "name"]);
  });

  it("renders no ⋮ at all when the group panel is disabled", () => {
    // The menu's only items are grouping ones, so without the panel it would
    // be an empty affordance.
    const view = renderGrid({ groupPanel: { enabled: false } });
    expect(menuButtons(view)).toEqual([]);
  });

  it("Group by this column appends the level and reports it", async () => {
    const onRowGroupsChange = vi.fn();
    const view = renderGrid({ onRowGroupsChange });

    openMenu(view.getByRole("button", { name: "Column menu for Industry" }));
    fireEvent.click(
      view.getByRole("menuitem", { name: "Group by this column" }),
    );

    expect(onRowGroupsChange).toHaveBeenCalledWith(["industry"]);
    await waitFor(() =>
      expect(
        view.container.querySelectorAll("[data-pretable-group-chip]"),
      ).toHaveLength(1),
    );
  });

  it("groups a second level onto the end of the existing list", () => {
    const onRowGroupsChange = vi.fn();
    const view = renderGrid({
      onRowGroupsChange,
      state: { rowGroups: ["sector"] },
    });

    openMenu(view.getByRole("button", { name: "Column menu for Industry" }));
    fireEvent.click(
      view.getByRole("menuitem", { name: "Group by this column" }),
    );

    expect(onRowGroupsChange).toHaveBeenCalledWith(["sector", "industry"]);
  });

  it("neither the derived group column nor a grouped column has a ⋮", () => {
    // With `hideGroupedColumns` at its default a grouped column loses its
    // header entirely, and the derived group column is deliberately excluded —
    // grouping the tree column by itself is meaningless.
    const view = renderGrid({ state: { rowGroups: ["sector"] } });
    expect(menuButtons(view)).toEqual(["industry", "name"]);
  });

  it("closes on a real pointerdown+click on its own button", () => {
    // The realistic sequence is pointerdown BEFORE click. ColumnMenu closes on
    // any outside pointerdown and the ⋮ sits outside the menu root, so an
    // unguarded pointerdown would close the menu and let the following click's
    // toggle() see no open menu and reopen it — a menu that can never be
    // dismissed by its own button. MenuButton's `onPointerDown`
    // stopPropagation is what prevents that; remove it and this fails.
    const view = renderGrid();
    const button = view.getByRole("button", { name: "Column menu for Sector" });

    openMenu(button);
    expect(view.getByRole("menu")).toBeTruthy();
    expect(button).toHaveAttribute("aria-expanded", "true");

    openMenu(button);
    expect(view.queryByRole("menu")).toBeNull();
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on an outside pointerdown", () => {
    const view = renderGrid();
    openMenu(view.getByRole("button", { name: "Column menu for Sector" }));
    expect(view.getByRole("menu")).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(view.queryByRole("menu")).toBeNull();
  });

  it("Escape closes it and returns focus to the ⋮", () => {
    const view = renderGrid();
    const button = view.getByRole("button", { name: "Column menu for Sector" });

    openMenu(button);
    fireEvent.keyDown(view.getByRole("menu"), { key: "Escape" });

    expect(view.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("clicking the ⋮ does not sort the column", () => {
    // Honest note on what this proves: it passes because of DOM STRUCTURE —
    // the overlay strip is a SIBLING of the header <button>, so a click on the
    // ⋮ has no sort handler to bubble into. Its negative control does not fire:
    // deleting MenuButton's `onClick` stopPropagation leaves this green (the
    // same is true of FunnelButton's, which is pre-existing). Keep the test as
    // the regression guard on that structure — nesting the strip inside the
    // header button is the mistake it catches — and do not read the click
    // guard as load-bearing. The POINTERDOWN guard is a different matter and is
    // load-bearing; see the dismissal test above.
    const onQueryChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="test-grid"
        columns={columns}
        getRowId={(row: Holding) => row.id}
        groupPanel={{ enabled: true }}
        query={{ filters: [], sort: [], rowGroups: [] }}
        onQueryChange={onQueryChange}
        overscan={0}
        rows={rows}
        viewportHeight={600}
      />,
    );

    openMenu(view.getByRole("button", { name: "Column menu for Sector" }));
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("opening the column menu closes an open filter dialog", () => {
    // One open-state for the whole header strip: the funnel's dialog and the ⋮
    // menu are mutually exclusive. Two independent hooks would leave both
    // popovers stacked, because each button stops its own pointerdown and so
    // never reaches the other's outside-click listener.
    const view = renderGrid();

    const funnel = view.getByRole("button", { name: "Filter Sector" });
    fireEvent.pointerDown(funnel);
    fireEvent.click(funnel);
    expect(view.getByRole("dialog", { name: "Filter Sector" })).toBeTruthy();

    openMenu(view.getByRole("button", { name: "Column menu for Sector" }));
    expect(view.queryByRole("dialog")).toBeNull();
    expect(view.getByRole("menu")).toBeTruthy();
  });
});
