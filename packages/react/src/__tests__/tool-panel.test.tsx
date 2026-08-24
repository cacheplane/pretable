// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../public_api";
import type { PretableColumn, PretableToolPanelConfig } from "../public_api";
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
