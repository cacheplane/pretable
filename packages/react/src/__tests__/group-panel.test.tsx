import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  state?: PretableSurfaceState;
  viewportHeight?: number;
}

function Grid({
  groupPanel,
  onRowGroupsChange,
  state,
  viewportHeight,
}: GridProps) {
  return (
    <PretableSurface
      ariaLabel="test-grid"
      columns={columns}
      getRowId={(row: Holding) => row.id}
      groupPanel={groupPanel}
      onRowGroupsChange={onRowGroupsChange}
      overscan={0}
      rows={rows}
      state={state}
      viewportHeight={viewportHeight ?? 600}
    />
  );
}

const renderGrid = (props: GridProps = {}) => render(<Grid {...props} />);

const panel = (view: { container: HTMLElement }) =>
  view.container.querySelector("[data-pretable-group-panel]")!;

describe("group panel — wrapper and height accounting", () => {
  it("without groupPanel, the root is still the scroll viewport", () => {
    const view = renderGrid();
    const root = view.container.firstElementChild!;
    expect(root).toHaveAttribute("data-pretable-scroll-viewport");
  });

  it("with groupPanel, the viewport is wrapped and keeps every attribute", () => {
    const view = renderGrid({ groupPanel: { enabled: true } });
    const root = view.container.firstElementChild!;
    expect(root).toHaveAttribute("data-pretable-group-panel-wrapper");
    const viewport = root.querySelector("[data-pretable-scroll-viewport]")!;
    expect(viewport).toHaveAttribute("role", "grid");
    expect(viewport).toHaveAttribute("aria-label", "test-grid");
  });

  it("the panel consumes from viewportHeight rather than adding to it", () => {
    // The component must occupy exactly `viewportHeight` either way, so a
    // consumer's layout does not shift when they enable the panel.
    const plain = renderGrid({ viewportHeight: 400 });
    const plainVp = plain.container.querySelector(
      "[data-pretable-scroll-viewport]",
    ) as HTMLElement;
    expect(plainVp.style.height).toBe("400px");

    cleanup();
    const panelled = renderGrid({
      viewportHeight: 400,
      groupPanel: { enabled: true },
    });
    const wrapper = panelled.container.firstElementChild as HTMLElement;
    const vp = panelled.container.querySelector(
      "[data-pretable-scroll-viewport]",
    ) as HTMLElement;
    expect(parseInt(vp.style.height, 10)).toBeLessThan(400);
    // …and the total is still exactly `viewportHeight`.
    expect(wrapper.style.height).toBe("400px");
  });
});

describe("group panel — chips", () => {
  it("is role=presentation when empty and role=listbox when it has chips", () => {
    // A listbox with zero options fails axe, which is why this flips rather
    // than being statically `listbox`.
    const view = renderGrid({ groupPanel: { enabled: true } });
    expect(panel(view)).toHaveAttribute("role", "presentation");

    view.rerender(
      <Grid groupPanel={{ enabled: true }} state={{ rowGroups: ["sector"] }} />,
    );
    expect(panel(view)).toHaveAttribute("role", "listbox");
  });

  it("shows the empty message only when ungrouped", () => {
    const view = renderGrid({
      groupPanel: { enabled: true, emptyMessage: "Drop here" },
    });
    expect(view.getByText("Drop here")).toBeInTheDocument();

    view.rerender(
      <Grid
        groupPanel={{ enabled: true, emptyMessage: "Drop here" }}
        state={{ rowGroups: ["sector"] }}
      />,
    );
    expect(view.queryByText("Drop here")).toBeNull();
  });

  it("falls back to a default empty message", () => {
    const view = renderGrid({ groupPanel: { enabled: true } });

    expect(
      view.container.querySelector("[data-pretable-group-panel-empty]"),
    ).toHaveTextContent("Drag a column here to group by it");
  });

  it("projects rowGroups in order, labelled by column header", () => {
    const view = renderGrid({
      groupPanel: { enabled: true },
      state: { rowGroups: ["industry", "sector"] },
    });
    const chips = view.container.querySelectorAll("[data-pretable-group-chip]");

    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveTextContent("Industry");
    expect(chips[1]).toHaveTextContent("Sector");
    expect(chips[0]).toHaveAttribute("data-pretable-column-id", "industry");
  });

  it("chips carry position in the set for screen readers", () => {
    const view = renderGrid({
      groupPanel: { enabled: true },
      state: { rowGroups: ["sector", "industry"] },
    });
    const chips = view.getAllByRole("option");

    expect(chips).toHaveLength(2);
    expect(chips[0]).toHaveAttribute("aria-posinset", "1");
    expect(chips[0]).toHaveAttribute("aria-setsize", "2");
    expect(chips[1]).toHaveAttribute("aria-posinset", "2");
  });

  it("names the chip on its option root and hides the duplicate visible text", () => {
    const view = renderGrid({
      groupPanel: { enabled: true },
      state: { rowGroups: ["sector", "industry"] },
    });
    const chip = view.getAllByRole("option")[0];

    // The name carries the position and the key hints, neither of which is in
    // the visible text — and the visible text is hidden so it is not read
    // twice.
    expect(chip.getAttribute("aria-label")).toContain("Sector");
    expect(chip.getAttribute("aria-label")).toContain("1 of 2");
    expect(chip.querySelector("[data-pretable-chip-label]")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("gives every chip a handle and a remove button", () => {
    const view = renderGrid({
      groupPanel: { enabled: true },
      state: { rowGroups: ["sector"] },
    });
    const chip = view.getAllByRole("option")[0];

    expect(chip.querySelector("[data-pretable-chip-handle]")).not.toBeNull();
    expect(chip.querySelector("[data-pretable-chip-remove]")).toHaveAttribute(
      "aria-label",
      "Remove Sector from grouping",
    );
  });

  it("the ✕ removes that level and reports the new list", () => {
    const onRowGroupsChange = vi.fn();
    const view = renderGrid({
      groupPanel: { enabled: true },
      state: { rowGroups: ["sector", "industry"] },
      onRowGroupsChange,
    });
    fireEvent.click(
      view
        .getAllByRole("option")[0]
        .querySelector("[data-pretable-chip-remove]")!,
    );

    expect(onRowGroupsChange).toHaveBeenCalledWith(["industry"]);
  });

  it("does not fire onRowGroupsChange for programmatic grouping", () => {
    const onRowGroupsChange = vi.fn();
    const view = renderGrid({
      groupPanel: { enabled: true },
      onRowGroupsChange,
    });

    view.rerender(
      <Grid
        groupPanel={{ enabled: true }}
        onRowGroupsChange={onRowGroupsChange}
        state={{ rowGroups: ["sector"] }}
      />,
    );

    expect(view.getAllByRole("option")).toHaveLength(1);
    expect(onRowGroupsChange).not.toHaveBeenCalled();
  });
});
