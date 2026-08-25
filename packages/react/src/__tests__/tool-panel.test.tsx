// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { GROUP_COLUMN_ID } from "@pretable/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROW_SELECT_COLUMN_ID } from "../constants";
import { PretableSurface } from "../public_api";
import type { PretableColumn, PretableToolPanelConfig } from "../public_api";
import type { PretableSurfaceGrid } from "../pretable-surface";
import { ToolPanel } from "../tool-panel";
import type {
  ToolPanelSectionDescriptor,
  ToolPanelSectionId,
} from "../tool-panel";

afterEach(() => {
  cleanup();
});

/* Task 7 builds the real columns section; the shell must not care what a
   section renders, so these tests exercise it with throwaway descriptors.
   The second id is outside today's closed union on purpose — the contract
   says the shell may not assume the union is closed at runtime. */
const FakeIcon = ({ className }: { className?: string }) => (
  <svg className={className} data-pretable-icon="" />
);

function makeSections(): ToolPanelSectionDescriptor[] {
  return [
    {
      id: "columns",
      icon: FakeIcon,
      label: "Columns",
      render: () => <div data-testid="fake-section" />,
    },
    {
      id: "filters" as ToolPanelSectionId,
      icon: FakeIcon,
      label: "Filters",
      render: () => <div data-testid="fake-filters-section" />,
    },
  ];
}

/** The shell is controlled; this harness plays the part of Task 6's surface. */
function Host({
  initial = null,
  onChange,
}: {
  initial?: ToolPanelSectionId | null;
  onChange?: (next: ToolPanelSectionId | null) => void;
}) {
  const [active, setActive] = useState<ToolPanelSectionId | null>(initial);
  return (
    <ToolPanel
      railLabel="Tool panel"
      sections={makeSections()}
      activeSection={active}
      onActiveSectionChange={(next) => {
        onChange?.(next);
        setActive(next);
      }}
    />
  );
}

describe("ToolPanel shell", () => {
  it("renders one rail tab per descriptor with role=tab and the label as accessible name", () => {
    const { getByRole, getAllByRole } = render(<Host />);
    expect(getByRole("tablist")).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    const tabs = getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(getByRole("tab", { name: "Columns" })).toBeInTheDocument();
    expect(getByRole("tab", { name: "Filters" })).toBeInTheDocument();
    for (const tab of tabs) {
      expect(tab).toHaveAttribute("data-pretable-tool-tab");
      expect(tab).toHaveAttribute("data-pretable-section");
    }
  });

  it("renders no pane while activeSection is null, and opens one on tab click wired via aria-controls/aria-labelledby", () => {
    const { container, getByRole, queryByRole, getByTestId } = render(<Host />);
    expect(queryByRole("tabpanel")).toBeNull();
    expect(container.querySelector("[data-pretable-tool-pane]")).toBeNull();

    const tab = getByRole("tab", { name: "Columns" });
    fireEvent.click(tab);

    const pane = getByRole("tabpanel");
    expect(pane).toHaveAttribute("data-pretable-tool-pane");
    expect(pane.id).toBe(tab.getAttribute("aria-controls"));
    expect(pane.getAttribute("aria-labelledby")).toBe(tab.id);
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(getByRole("tab", { name: "Filters" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    // The section container the CSS pins, holding the descriptor's output.
    expect(pane.querySelector("[data-pretable-tool-section]")).not.toBeNull();
    expect(getByTestId("fake-section")).toBeInTheDocument();
  });

  it("clicking the active tab closes the pane and reports null", () => {
    const onChange = vi.fn();
    const { getByRole, queryByRole } = render(
      <Host initial={"columns"} onChange={onChange} />,
    );
    expect(getByRole("tabpanel")).toBeInTheDocument();

    fireEvent.click(getByRole("tab", { name: "Columns" }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(queryByRole("tabpanel")).toBeNull();
  });

  it("ArrowDown moves DOM focus to the next tab without following activation", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <Host initial={"columns"} onChange={onChange} />,
    );
    const columnsTab = getByRole("tab", { name: "Columns" });
    const filtersTab = getByRole("tab", { name: "Filters" });

    columnsTab.focus();
    fireEvent.keyDown(columnsTab, { key: "ArrowDown" });

    expect(filtersTab).toHaveFocus();
    // Focus moved; activation did not.
    expect(columnsTab).toHaveAttribute("aria-selected", "true");
    expect(filtersTab).toHaveAttribute("aria-selected", "false");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(filtersTab, { key: "ArrowUp" });
    expect(columnsTab).toHaveFocus();
  });

  it("keeps the rail a single tab stop: exactly one tab has tabIndex 0, before and after arrowing", () => {
    const { getAllByRole, getByRole } = render(<Host initial={"columns"} />);
    const zeroStops = () => getAllByRole("tab").filter((t) => t.tabIndex === 0);
    expect(zeroStops()).toHaveLength(1);
    expect(zeroStops()[0]).toBe(getByRole("tab", { name: "Columns" }));

    const columnsTab = getByRole("tab", { name: "Columns" });
    columnsTab.focus();
    fireEvent.keyDown(columnsTab, { key: "ArrowDown" });
    expect(zeroStops()).toHaveLength(1);
  });

  it("resets the tab stop to the active tab when focus leaves the rail mid-browse", () => {
    const { getByRole } = render(
      <div>
        <Host initial={"columns"} />
        <button type="button">outside</button>
      </div>,
    );
    const columnsTab = getByRole("tab", { name: "Columns" });
    const filtersTab = getByRole("tab", { name: "Filters" });

    columnsTab.focus();
    fireEvent.keyDown(columnsTab, { key: "ArrowDown" });
    expect(filtersTab).toHaveFocus();
    expect(filtersTab.tabIndex).toBe(0);

    // Abandon the browse: focus something outside the rail.
    getByRole("button", { name: "outside" }).focus();
    fireEvent.blur(filtersTab, {
      relatedTarget: getByRole("button", { name: "outside" }),
    });

    // A returning Tab lands on the ACTIVE tab, not where the browse stopped.
    expect(columnsTab.tabIndex).toBe(0);
    expect(filtersTab.tabIndex).toBe(-1);
  });

  it("Escape inside the pane returns focus to the active rail tab", () => {
    const { getByRole, getByTestId } = render(<Host initial={"columns"} />);
    const inner = getByTestId("fake-section");
    inner.focus?.();
    fireEvent.keyDown(inner, { key: "Escape" });
    expect(getByRole("tab", { name: "Columns" })).toHaveFocus();
    // Escape closes nothing — it is a focus hand-back, not a dismissal.
    expect(getByRole("tabpanel")).toBeInTheDocument();
  });
});

/* ---- Task 6: the panel on the surface ---------------------------------- */

type SurfaceRow = { id: string; name: string; amount: number };

const surfaceColumns: PretableColumn<SurfaceRow>[] = [
  { id: "name", header: "Name" },
  { id: "amount", header: "Amount" },
];
const surfaceRows: SurfaceRow[] = [
  { id: "r1", name: "Alpha", amount: 1 },
  { id: "r2", name: "Beta", amount: 2 },
];

function renderSurface(toolPanel?: boolean | PretableToolPanelConfig) {
  return render(
    <PretableSurface
      ariaLabel="Tool panel grid"
      columns={surfaceColumns}
      rows={surfaceRows}
      getRowId={(r: SurfaceRow) => r.id}
      viewportHeight={300}
      {...(toolPanel === undefined ? {} : { toolPanel })}
    />,
  );
}

describe("tool panel on the surface", () => {
  it("is on by default: no toolPanel prop renders the rail with no open pane", () => {
    const { container } = renderSurface();
    expect(container.querySelector("[data-pretable-tool-rail]")).not.toBeNull();
    expect(
      container.querySelector(
        '[data-pretable-tool-tab][data-pretable-section="columns"]',
      ),
    ).not.toBeNull();
    expect(container.querySelector("[data-pretable-tool-pane]")).toBeNull();
  });

  it("toolPanel={false} renders neither rail nor pane", () => {
    const { container } = renderSurface(false);
    expect(container.querySelector("[data-pretable-tool-rail]")).toBeNull();
    expect(container.querySelector("[data-pretable-tool-pane]")).toBeNull();
  });

  it("names the tablist so the rail has an accessible name", () => {
    const { getByRole } = renderSurface();
    expect(getByRole("tablist", { name: "Tool panel" })).toBeInTheDocument();
  });

  it("uncontrolled: defaultActiveSection opens the pane at mount and tab clicks toggle it", () => {
    const { container, getByRole } = renderSurface({
      defaultActiveSection: "columns",
    });
    expect(container.querySelector("[data-pretable-tool-pane]")).not.toBeNull();

    fireEvent.click(getByRole("tab", { name: "Columns" }));
    expect(container.querySelector("[data-pretable-tool-pane]")).toBeNull();

    fireEvent.click(getByRole("tab", { name: "Columns" }));
    expect(container.querySelector("[data-pretable-tool-pane]")).not.toBeNull();
  });

  it("controlled: activeSection pins the pane; a tab click reports but does not mutate", () => {
    const onActiveSectionChange = vi.fn();
    const controlled = (active: ToolPanelSectionId | null) => (
      <PretableSurface
        ariaLabel="Controlled tool panel grid"
        columns={surfaceColumns}
        rows={surfaceRows}
        getRowId={(r: SurfaceRow) => r.id}
        viewportHeight={300}
        toolPanel={{ activeSection: active, onActiveSectionChange }}
      />
    );
    const { container, getByRole, rerender } = render(controlled(null));
    expect(container.querySelector("[data-pretable-tool-pane]")).toBeNull();

    // The click reports the intent…
    fireEvent.click(getByRole("tab", { name: "Columns" }));
    expect(onActiveSectionChange).toHaveBeenLastCalledWith("columns");
    // …but the DOM holds until the prop moves.
    expect(container.querySelector("[data-pretable-tool-pane]")).toBeNull();

    rerender(controlled("columns"));
    expect(container.querySelector("[data-pretable-tool-pane]")).not.toBeNull();

    // And closing under control is the same one-way street.
    fireEvent.click(getByRole("tab", { name: "Columns" }));
    expect(onActiveSectionChange).toHaveBeenLastCalledWith(null);
    expect(container.querySelector("[data-pretable-tool-pane]")).not.toBeNull();
    rerender(controlled(null));
    expect(container.querySelector("[data-pretable-tool-pane]")).toBeNull();
  });

  it("composes with the group panel: the panel wrapper lands inside the tool layout's grid area", () => {
    // Task 6 shipped both wrappers but no test rendered them together; the
    // group-panel wrapper must stack INSIDE the grid area so the pane and
    // rail dock beside the whole vertical stack, panel included.
    const { container } = render(
      <PretableSurface
        ariaLabel="Composed grid"
        columns={surfaceColumns}
        rows={surfaceRows}
        getRowId={(r: SurfaceRow) => r.id}
        groupPanel={{ enabled: true }}
        viewportHeight={300}
      />,
    );
    const gridArea = container.querySelector("[data-pretable-tool-grid-area]");
    expect(gridArea).not.toBeNull();
    expect(
      gridArea?.querySelector("[data-pretable-group-panel-wrapper]"),
    ).not.toBeNull();
  });

  it("keeps the rail and pane inside the card wrapper so the chrome wraps them", () => {
    const { container } = renderSurface({ defaultActiveSection: "columns" });
    const layout = container.querySelector("[data-pretable-tool-layout]");
    expect(layout).not.toBeNull();
    // Visual order inside the row: [grid area][pane][rail].
    const children = [...(layout as HTMLElement).children];
    expect(children[0]?.hasAttribute("data-pretable-tool-grid-area")).toBe(
      true,
    );
    expect(children[1]?.hasAttribute("data-pretable-tool-pane")).toBe(true);
    expect(children[2]?.hasAttribute("data-pretable-tool-rail")).toBe(true);
    // The scroll viewport (and its hydration signal) lives in the grid area.
    expect(
      children[0]?.querySelector("[data-pretable-scroll-viewport]"),
    ).not.toBeNull();
  });
});

/* ---- Task 7: the columns section --------------------------------------- */

type SectionRow = {
  id: string;
  a: string;
  b: string;
  c: string;
  d: string;
};

const sectionRows: SectionRow[] = [
  { id: "r1", a: "1", b: "2", c: "3", d: "4" },
];
const sectionColumns: PretableColumn<SectionRow>[] = [
  { id: "a", header: "Alpha", pinned: "left" },
  { id: "b", header: "Bravo" },
  { id: "c", header: "Charlie" },
  { id: "d", header: "Delta", pinned: "right" },
];

type SectionGrid = PretableSurfaceGrid<
  SectionRow,
  string,
  readonly PretableColumn<SectionRow>[]
>;

function mountColumnsSection(options?: {
  columns?: PretableColumn<SectionRow>[];
  withRowSelect?: boolean;
  rowGroups?: string[];
  open?: boolean;
}) {
  let captured: SectionGrid | null = null;
  const shared = {
    ariaLabel: "Columns section grid",
    columns: options?.columns ?? sectionColumns,
    getRowId: (r: SectionRow) => r.id,
    onGridReady: (g: unknown) => {
      captured = g as SectionGrid;
    },
    rows: sectionRows,
    toolPanel: {
      defaultActiveSection: options?.open === false ? null : "columns",
    } as const,
    viewportHeight: 300,
    ...(options?.withRowSelect
      ? { rowSelectionColumn: { enabled: true as const } }
      : {}),
  };
  // Rendered as two literal JSX branches: `query` controlled-or-absent is a
  // props UNION, and a conditional spread widens every member to `| undefined`
  // — which the union's "absent" arm rejects.
  const view = options?.rowGroups
    ? render(
        <PretableSurface<SectionRow>
          {...shared}
          onQueryChange={() => {}}
          query={{
            filters: [],
            sort: [],
            rowGroups: options.rowGroups.map((columnId) => ({ columnId })),
          }}
        />,
      )
    : render(<PretableSurface<SectionRow> {...shared} />);
  const rows = () =>
    Array.from(
      view.container.querySelectorAll("[data-pretable-tool-column-row]"),
    ) as HTMLElement[];
  return {
    view,
    grid: captured as unknown as SectionGrid,
    rows,
    rowByLabel: (label: string) =>
      rows().find(
        (row) =>
          row.querySelector("[data-pretable-tool-column-label]")
            ?.textContent === label,
      ),
    rowLabels: () =>
      rows().map(
        (row) =>
          row.querySelector("[data-pretable-tool-column-label]")?.textContent,
      ),
    groupLabels: () =>
      Array.from(
        view.container.querySelectorAll("[data-pretable-tool-group-label]"),
      ).map((el) => el.textContent),
    /** Group label + row label texts in DOM order — the subgrouping proof. */
    listSequence: () =>
      Array.from(
        view.container.querySelectorAll(
          "[data-pretable-tool-group-label], [data-pretable-tool-column-label]",
        ),
      ).map((el) => el.textContent),
    toggleFor: (label: string) =>
      rows()
        .find(
          (row) =>
            row.querySelector("[data-pretable-tool-column-label]")
              ?.textContent === label,
        )
        ?.querySelector("button[data-pretable-tool-column-toggle]") as
        HTMLButtonElement | undefined,
    search: () =>
      view.container.querySelector(
        "[data-pretable-tool-search]",
      ) as HTMLInputElement,
    reset: () =>
      view.container.querySelector(
        "[data-pretable-tool-reset]",
      ) as HTMLButtonElement,
    drawnHeaderIds: () =>
      Array.from(
        view.container.querySelectorAll(
          "[data-pretable-header-cell][data-pretable-column-id]",
        ),
      ).map((el) => el.getAttribute("data-pretable-column-id")),
    engineLayout: () =>
      captured!.getState().columnLayout.map((entry) => ({
        id: entry.id,
        pinned: entry.pinned ?? null,
        hidden: entry.hidden === true,
      })),
  };
}

describe("columns section", () => {
  it("lists every layout column in layout order, subgrouped by pin state, hidden rows present and marked", () => {
    const h = mountColumnsSection();
    // Layout order is the drawn order: [left][unpinned][right].
    expect(h.rowLabels()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(h.listSequence()).toEqual([
      "Pinned left",
      "Alpha",
      "Columns",
      "Bravo",
      "Charlie",
      "Pinned right",
      "Delta",
    ]);
    // Full row anatomy: grip, toggle, label, kebab — grip and kebab inert.
    const row = h.rowByLabel("Bravo")!;
    expect(row.querySelector("[data-pretable-tool-row-grip]")).not.toBeNull();
    expect(
      row.querySelector("button[data-pretable-tool-column-toggle]"),
    ).not.toBeNull();
    const kebab = row.querySelector(
      "button[data-pretable-tool-row-menu-button]",
    );
    expect(kebab).not.toBeNull();
    expect(kebab?.getAttribute("aria-expanded")).not.toBe("true");

    // A hidden column stays listed at its position, unchecked and marked.
    act(() => h.grid.setColumnVisible("b", false));
    expect(h.rowLabels()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    const hiddenRow = h.rowByLabel("Bravo")!;
    expect(hiddenRow.getAttribute("data-pretable-column-hidden")).toBe("true");
    expect(h.toggleFor("Bravo")).toHaveAttribute("aria-checked", "false");
    expect(h.toggleFor("Alpha")).toHaveAttribute("aria-checked", "true");
    expect(
      h.rowByLabel("Alpha")!.hasAttribute("data-pretable-column-hidden"),
    ).toBe(false);
  });

  it("excludes the derived group column and the selection column while the engine still draws them", async () => {
    const h = mountColumnsSection({ withRowSelect: true, rowGroups: ["c"] });
    await waitFor(() => {
      // Non-vacuous: both synthetic columns really are in the engine layout.
      const ids = h.engineLayout().map((entry) => entry.id);
      expect(ids).toContain(GROUP_COLUMN_ID);
      expect(ids).toContain(ROW_SELECT_COLUMN_ID);
    });
    // Grouped-away "c" leaves the layout entirely under the default
    // hideGroupedColumns, so the panel lists the remaining schema columns.
    expect(h.rowLabels()).toEqual(["Alpha", "Bravo", "Delta"]);
  });

  it("unchecking hides the column in the grid; the row stays, dimmed", () => {
    const h = mountColumnsSection();
    expect(h.drawnHeaderIds()).toEqual(["a", "b", "c", "d"]);

    fireEvent.click(h.toggleFor("Bravo")!);

    // The engine records the hide…
    expect(h.engineLayout()).toContainEqual({
      id: "b",
      pinned: null,
      hidden: true,
    });
    // …the drawn grid loses the column…
    expect(h.drawnHeaderIds()).toEqual(["a", "c", "d"]);
    // …and the panel keeps the row, dimmed and unchecked.
    const row = h.rowByLabel("Bravo")!;
    expect(row.getAttribute("data-pretable-column-hidden")).toBe("true");
    expect(h.toggleFor("Bravo")).toHaveAttribute("aria-checked", "false");

    // Re-checking restores the column at its old position.
    fireEvent.click(h.toggleFor("Bravo")!);
    expect(h.drawnHeaderIds()).toEqual(["a", "b", "c", "d"]);
    expect(
      h.rowByLabel("Bravo")!.hasAttribute("data-pretable-column-hidden"),
    ).toBe(false);
  });

  it("search narrows rows case-insensitively and hides emptied subgroup labels", () => {
    const h = mountColumnsSection();
    fireEvent.change(h.search(), { target: { value: "RA" } });
    expect(h.rowLabels()).toEqual(["Bravo"]);
    expect(h.groupLabels()).toEqual(["Columns"]);

    fireEvent.change(h.search(), { target: { value: "delta" } });
    expect(h.rowLabels()).toEqual(["Delta"]);
    expect(h.groupLabels()).toEqual(["Pinned right"]);

    fireEvent.change(h.search(), { target: { value: "" } });
    expect(h.rowLabels()).toEqual(["Alpha", "Bravo", "Charlie", "Delta"]);
    expect(h.groupLabels()).toEqual(["Pinned left", "Columns", "Pinned right"]);
  });

  it("reset after hide+pin+reorder restores the initial layout on the engine", () => {
    const h = mountColumnsSection();
    act(() => {
      h.grid.setColumnVisible("b", false);
      h.grid.setColumnPinned("c", "left");
      h.grid.setColumnOrder(["d", "c", "b", "a"]);
    });
    // Sanity: the layout really moved before reset.
    expect(h.engineLayout()).not.toEqual([
      { id: "a", pinned: "left", hidden: false },
      { id: "b", pinned: null, hidden: false },
      { id: "c", pinned: null, hidden: false },
      { id: "d", pinned: "right", hidden: false },
    ]);

    fireEvent.click(h.reset());

    expect(h.engineLayout()).toEqual([
      { id: "a", pinned: "left", hidden: false },
      { id: "b", pinned: null, hidden: false },
      { id: "c", pinned: null, hidden: false },
      { id: "d", pinned: "right", hidden: false },
    ]);
  });

  it("reset replays the layout captured at SURFACE mount, even when the pane opened later", () => {
    // The pane starts closed, the layout is mutated, THEN the pane opens: a
    // section-mount capture would treat the mutated layout as the baseline.
    const h = mountColumnsSection({ open: false });
    act(() => {
      h.grid.setColumnVisible("b", false);
      h.grid.setColumnPinned("c", "left");
    });

    fireEvent.click(h.view.getByRole("tab", { name: "Columns" }));
    fireEvent.click(h.reset());

    expect(h.engineLayout()).toEqual([
      { id: "a", pinned: "left", hidden: false },
      { id: "b", pinned: null, hidden: false },
      { id: "c", pinned: null, hidden: false },
      { id: "d", pinned: "right", hidden: false },
    ]);
  });
});
