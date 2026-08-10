import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GROUP_PANEL_HEIGHT } from "../constants";
import { PretableSurface } from "../pretable-surface";
import { GroupPanel } from "../group-panel/GroupPanel";
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

  it("the panel consumes exactly its own height from viewportHeight", () => {
    // The component must occupy exactly `viewportHeight` either way, so a
    // consumer's layout does not shift when they enable the panel. The numbers
    // are asserted exactly, not as `< 400`: any reservation at all satisfies an
    // inequality, so it would still pass if the panel reserved one pixel for
    // itself and then drew 36 — which is precisely how this goes wrong.
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
    const strip = panel(panelled) as HTMLElement;

    expect(strip.style.height).toBe(`${GROUP_PANEL_HEIGHT}px`);
    expect(vp.style.height).toBe(`${400 - GROUP_PANEL_HEIGHT}px`);
    // …and the two together are still exactly `viewportHeight`, with the
    // wrapper claiming no more than that.
    expect(
      parseInt(vp.style.height, 10) + parseInt(strip.style.height, 10),
    ).toBe(400);
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

/**
 * A consumer mirroring `onRowGroupsChange` back into controlled
 * `state.rowGroups` — the documented pattern, and the only harness in which a
 * SECOND keystroke means anything: a statically controlled `state.rowGroups`
 * is re-asserted after every change, so a repeated Shift+Arrow would keep
 * moving the same level out of the same slot.
 */
function MirroredGrid({
  initialRowGroups,
  onRowGroupsChange,
}: {
  initialRowGroups: string[];
  onRowGroupsChange?: (rowGroups: string[]) => void;
}) {
  const [rowGroups, setRowGroups] = React.useState(initialRowGroups);

  return (
    <Grid
      groupPanel={{ enabled: true }}
      onRowGroupsChange={(next) => {
        setRowGroups(next);
        onRowGroupsChange?.(next);
      }}
      state={{ rowGroups }}
    />
  );
}

const chipIds = (view: { container: HTMLElement }) =>
  Array.from(view.container.querySelectorAll("[data-pretable-group-chip]")).map(
    (chip) => chip.getAttribute("data-pretable-column-id"),
  );

const activeChipId = () =>
  document.activeElement?.getAttribute("data-pretable-column-id") ?? null;

type GroupingFocusIntent = {
  target: "chip" | "header";
  columnId: string;
};

function renderPanelContract(rowGroups: readonly string[]) {
  const onChange =
    vi.fn<(next: readonly string[], intent?: GroupingFocusIntent) => void>();
  const view = render(
    <GroupPanel
      height={40}
      labelForColumn={(columnId) => columnId}
      onChange={onChange}
      rowGroups={rowGroups}
    />,
  );
  return { ...view, onChange };
}

describe("group panel — focus intent contract", () => {
  it("requests the moved chip after a keyboard reorder", () => {
    const view = renderPanelContract(["sector", "industry"]);
    const chip = view.getAllByRole("option")[0];

    fireEvent.keyDown(chip, { key: "ArrowRight", shiftKey: true });

    expect(view.onChange).toHaveBeenCalledWith(["industry", "sector"], {
      target: "chip",
      columnId: "sector",
    });
  });

  it.each([
    {
      name: "Delete on a middle chip requests its successor",
      rowGroups: ["sector", "industry", "name"],
      index: 1,
      key: "Delete",
      expectedGroups: ["sector", "name"],
      expectedIntent: { target: "chip", columnId: "name" },
    },
    {
      name: "Backspace on an end chip requests its predecessor",
      rowGroups: ["sector", "industry", "name"],
      index: 2,
      key: "Backspace",
      expectedGroups: ["sector", "industry"],
      expectedIntent: { target: "chip", columnId: "industry" },
    },
    {
      name: "Delete on the final chip requests the removed column header",
      rowGroups: ["sector"],
      index: 0,
      key: "Delete",
      expectedGroups: [],
      expectedIntent: { target: "header", columnId: "sector" },
    },
  ])("$name", ({ rowGroups, index, key, expectedGroups, expectedIntent }) => {
    const view = renderPanelContract(rowGroups);

    fireEvent.keyDown(view.getAllByRole("option")[index]!, { key });

    expect(view.onChange).toHaveBeenCalledWith(expectedGroups, expectedIntent);
  });

  it.each([
    {
      name: "a middle chip remove button requests its successor",
      rowGroups: ["sector", "industry", "name"],
      index: 1,
      expectedGroups: ["sector", "name"],
      expectedIntent: { target: "chip", columnId: "name" },
    },
    {
      name: "an end chip remove button requests its predecessor",
      rowGroups: ["sector", "industry", "name"],
      index: 2,
      expectedGroups: ["sector", "industry"],
      expectedIntent: { target: "chip", columnId: "industry" },
    },
    {
      name: "the final chip remove button requests the removed column header",
      rowGroups: ["sector"],
      index: 0,
      expectedGroups: [],
      expectedIntent: { target: "header", columnId: "sector" },
    },
  ])("$name", ({ rowGroups, index, expectedGroups, expectedIntent }) => {
    const view = renderPanelContract(rowGroups);
    const removeButton = view
      .getAllByRole("option")
      [index]!.querySelector("[data-pretable-chip-remove]")!;

    fireEvent.click(removeButton);

    expect(view.onChange).toHaveBeenCalledWith(expectedGroups, expectedIntent);
  });

  it("requests the dragged chip after a drag reorder", () => {
    const view = renderPanelContract(["sector", "industry"]);
    const panel = view.container.querySelector<HTMLElement>(
      "[data-pretable-group-panel]",
    )!;
    const chips = view.getAllByRole("option");
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 240, 40),
    );
    vi.spyOn(chips[0]!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 40),
    );
    vi.spyOn(chips[1]!, "getBoundingClientRect").mockReturnValue(
      new DOMRect(100, 0, 100, 40),
    );

    fireEvent.pointerDown(chips[0]!, {
      button: 0,
      pointerId: 7,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(document, {
      pointerId: 7,
      clientX: 190,
      clientY: 20,
    });
    fireEvent.pointerUp(document, {
      pointerId: 7,
      clientX: 190,
      clientY: 20,
    });

    expect(view.onChange).toHaveBeenCalledWith(["industry", "sector"], {
      target: "chip",
      columnId: "sector",
    });
  });
});

describe("group panel — keyboard model", () => {
  it("arrow keys move focus between chips without wrapping", () => {
    const view = render(
      <MirroredGrid initialRowGroups={["sector", "industry"]} />,
    );
    const chips = view.getAllByRole("option");
    chips[0].focus();

    fireEvent.keyDown(chips[0], { key: "ArrowRight" });
    expect(activeChipId()).toBe("industry");

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(activeChipId()).toBe("sector");

    // The ends are walls, not wraps.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(activeChipId()).toBe("sector");
  });

  it("gives the focused chip the tab stop and takes it from the others", () => {
    const view = render(
      <MirroredGrid initialRowGroups={["sector", "industry"]} />,
    );
    const chips = view.getAllByRole("option");

    expect(chips[0]).toHaveAttribute("tabindex", "0");
    expect(chips[1]).toHaveAttribute("tabindex", "-1");

    chips[0].focus();
    fireEvent.keyDown(chips[0], { key: "ArrowRight" });

    expect(view.getAllByRole("option")[0]).toHaveAttribute("tabindex", "-1");
    expect(view.getAllByRole("option")[1]).toHaveAttribute("tabindex", "0");
  });

  it("Shift+arrow moves the focused grouping level", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );
    const chips = view.getAllByRole("option");
    chips[0].focus();

    fireEvent.keyDown(chips[0], { key: "ArrowRight", shiftKey: true });

    expect(onRowGroupsChange).toHaveBeenCalledWith(["industry", "sector"]);
    expect(chipIds(view)).toEqual(["industry", "sector"]);
  });

  it("Shift+ArrowLeft on the first chip is a no-op, not a wrap", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );
    const chips = view.getAllByRole("option");
    chips[0].focus();

    fireEvent.keyDown(chips[0], { key: "ArrowLeft", shiftKey: true });

    expect(onRowGroupsChange).not.toHaveBeenCalled();
    expect(chipIds(view)).toEqual(["sector", "industry"]);
  });

  it("focus follows the moved chip, so a repeated Shift+ArrowRight walks it along", () => {
    // CAVEAT: jsdom does NOT drop focus when React re-inserts a keyed node to
    // reorder it, but browsers do — so the `refocusRef` layout effect in
    // GroupPanel cannot be proven necessary here (its negative control does
    // not fire on this test, only on the removal one below). What IS proven
    // here is the rest of the chain: the move commits, the roving tab stop
    // travels with the chip, and a second keystroke on the still-focused chip
    // moves the SAME level again rather than whatever now sits at index 0.
    // The real-browser proof belongs in the Playwright spec.
    const view = render(
      <MirroredGrid initialRowGroups={["sector", "industry", "name"]} />,
    );
    const chips = view.getAllByRole("option");
    chips[0].focus();

    fireEvent.keyDown(chips[0], { key: "ArrowRight", shiftKey: true });
    expect(chipIds(view)).toEqual(["industry", "sector", "name"]);
    expect(activeChipId()).toBe("sector");
    expect(view.getAllByRole("option")[1]).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(document.activeElement!, {
      key: "ArrowRight",
      shiftKey: true,
    });
    expect(chipIds(view)).toEqual(["industry", "name", "sector"]);
    expect(activeChipId()).toBe("sector");
    expect(view.getAllByRole("option")[2]).toHaveAttribute("tabindex", "0");
  });

  it("Delete removes the focused level", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );
    const chips = view.getAllByRole("option");
    chips[0].focus();

    fireEvent.keyDown(chips[0], { key: "Delete" });

    expect(onRowGroupsChange).toHaveBeenCalledWith(["industry"]);
    expect(chipIds(view)).toEqual(["industry"]);
  });

  it("Backspace removes the focused level too", () => {
    const view = render(
      <MirroredGrid initialRowGroups={["sector", "industry"]} />,
    );
    const chips = view.getAllByRole("option");
    chips[1].focus();

    fireEvent.keyDown(chips[1], { key: "Backspace" });

    expect(chipIds(view)).toEqual(["sector"]);
  });

  it("Delete on the last remaining chip empties the panel and flips the role back", () => {
    const view = render(<MirroredGrid initialRowGroups={["sector"]} />);
    const chip = view.getAllByRole("option")[0];
    chip.focus();

    fireEvent.keyDown(chip, { key: "Delete" });

    expect(view.queryAllByRole("option")).toHaveLength(0);
    expect(panel(view)).toHaveAttribute("role", "presentation");
    expect(
      view.container.querySelector("[data-pretable-group-panel-empty]"),
    ).not.toBeNull();
  });

  it("leaves focus on a chip after a removal, so the strip stays keyboard-usable", () => {
    const view = render(
      <MirroredGrid initialRowGroups={["sector", "industry", "name"]} />,
    );
    const chips = view.getAllByRole("option");
    chips[1].focus();

    fireEvent.keyDown(chips[1], { key: "Delete" });

    expect(chipIds(view)).toEqual(["sector", "name"]);
    expect(activeChipId()).toBe("name");
  });
});
