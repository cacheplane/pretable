import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";

/**
 * ## What these tests can and cannot prove
 *
 * Both drag paths decide their drop zone by asking which RECTANGLE the pointer
 * is over. **jsdom has no layout engine** — every `getBoundingClientRect()`
 * returns zeros — so the rect comparison itself is untestable here, and a test
 * that stubbed rects to make it "pass" would only be re-asserting its own stub.
 *
 * So the hit test lives behind one seam, `hitTestGroupPanel`, and this file
 * mocks it. What is verified below is the **plumbing around** that seam:
 *
 * - a hit at pointerup groups (and does not reorder), a miss reorders (and does
 *   not group);
 * - the reported insertion index is what reaches `insertGroupLevel`;
 * - nothing commits before pointerup, and Escape/pointercancel commit nothing
 *   at all;
 * - a chip drag captures the pointer on the stable panel container.
 *
 * What is **not** verified here, and must be proven in Task 8's Playwright
 * spec: that the panel rect and the header rect are actually distinguished, and
 * that a header dropped on the header row reorders rather than groups. Right-pin
 * shipped measurably broken past 316 green jsdom tests in this repo; do not read
 * these as geometry coverage.
 */
const hit = vi.hoisted(() => ({
  /** What the mocked hit test reports for a pointer that is over the panel. */
  result: null as { insertIndex: number } | null,
}));

vi.mock("../group-panel/group-panel-hit-test", () => ({
  // The `panel` argument is still honoured, so "no panel is rendered" stays a
  // real code path: a disabled panel passes null and can never be hit.
  hitTestGroupPanel: (panel: HTMLElement | null) => (panel ? hit.result : null),
}));

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

/**
 * A consumer mirroring `onRowGroupsChange` into controlled `state.rowGroups` —
 * the documented pattern, and the only harness in which the DOM after a drop
 * reflects the drop.
 */
function MirroredGrid({
  groupPanelEnabled = true,
  initialRowGroups = [],
  onColumnOrderChange,
  onRowGroupsChange,
}: {
  groupPanelEnabled?: boolean;
  initialRowGroups?: string[];
  onColumnOrderChange?: (columnIds: readonly string[]) => void;
  onRowGroupsChange?: (rowGroups: string[]) => void;
}) {
  const [rowGroups, setRowGroups] = React.useState(initialRowGroups);

  return (
    <PretableSurface
      ariaLabel="drag-grid"
      columns={columns}
      getRowId={(row: Holding) => row.id}
      groupPanel={groupPanelEnabled ? { enabled: true } : undefined}
      onColumnOrderChange={onColumnOrderChange}
      onRowGroupsChange={(next) => {
        setRowGroups(next);
        onRowGroupsChange?.(next);
      }}
      overscan={0}
      rows={rows}
      state={{ rowGroups }}
      viewportHeight={400}
    />
  );
}

const chipIds = (view: { container: HTMLElement }) =>
  Array.from(view.container.querySelectorAll("[data-pretable-group-chip]")).map(
    (chip) => chip.getAttribute("data-pretable-column-id"),
  );

const header = (view: ReturnType<typeof render>, label: string) =>
  view.getByLabelText(`Sort ${label}`);

/** pointerdown + a move past the 5px threshold, leaving the drag in flight. */
function startDrag(element: Element, from = { x: 50, y: 10 }) {
  fireEvent.pointerDown(element, {
    button: 0,
    pointerId: 1,
    clientX: from.x,
    clientY: from.y,
  });
  fireEvent.pointerMove(element, {
    pointerId: 1,
    clientX: from.x + 40,
    clientY: from.y + 40,
  });
}

/**
 * A move to the release point and then the release — a real gesture always
 * reports the pointer's arrival before the button comes up, and the drop zone
 * is resolved from that last move.
 */
function endDrag(element: Element, at = { x: 90, y: 50 }) {
  fireEvent.pointerMove(element, {
    pointerId: 1,
    clientX: at.x,
    clientY: at.y,
  });
  fireEvent.pointerUp(element, {
    pointerId: 1,
    clientX: at.x,
    clientY: at.y,
  });
}

/**
 * jsdom does not implement pointer capture at all, so it is installed here as a
 * recorder. This is how "the capture is taken on the panel container, never on
 * a chip" is pinned: jsdom cannot exhibit the failure it prevents (it never
 * retargets events, so a capture on a re-rendered chip looks fine here), so the
 * rule is enforced structurally instead.
 */
const captures: Array<{ element: Element; pointerId: number }> = [];
let originalSetCapture: unknown;
let originalReleaseCapture: unknown;

beforeEach(() => {
  hit.result = null;
  captures.length = 0;
  originalSetCapture = Element.prototype.setPointerCapture;
  originalReleaseCapture = Element.prototype.releasePointerCapture;
  Element.prototype.setPointerCapture = function (pointerId: number) {
    captures.push({ element: this, pointerId });
  };
  Element.prototype.releasePointerCapture = function () {};
});

afterEach(() => {
  Element.prototype.setPointerCapture =
    originalSetCapture as typeof Element.prototype.setPointerCapture;
  Element.prototype.releasePointerCapture =
    originalReleaseCapture as typeof Element.prototype.releasePointerCapture;
  cleanup();
});

describe("header → panel drag", () => {
  it("a header released over the panel groups by that column", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(<MirroredGrid onRowGroupsChange={onRowGroupsChange} />);

    startDrag(header(view, "Name"));
    hit.result = { insertIndex: 0 };
    endDrag(header(view, "Name"));

    expect(onRowGroupsChange).toHaveBeenCalledWith(["name"]);
    expect(chipIds(view)).toEqual(["name"]);
  });

  it("a grouping drop does not also reorder the column", () => {
    const onColumnOrderChange = vi.fn();
    const view = render(
      <MirroredGrid onColumnOrderChange={onColumnOrderChange} />,
    );

    startDrag(header(view, "Name"));
    hit.result = { insertIndex: 0 };
    endDrag(header(view, "Name"));

    expect(onColumnOrderChange).not.toHaveBeenCalled();
  });

  it("a header released over neither zone reorders and does not group", () => {
    const onColumnOrderChange = vi.fn();
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        onColumnOrderChange={onColumnOrderChange}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );

    startDrag(header(view, "Sector"));
    hit.result = null;
    endDrag(header(view, "Sector"), { x: 260, y: 10 });

    expect(onRowGroupsChange).not.toHaveBeenCalled();
    expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
  });

  it("the drop position decides which grouping level the column lands at", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );

    startDrag(header(view, "Industry"));
    hit.result = { insertIndex: 0 };
    endDrag(header(view, "Industry"));

    expect(onRowGroupsChange).toHaveBeenCalledWith(["industry", "sector"]);
  });

  it("nothing is committed until pointerup", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(<MirroredGrid onRowGroupsChange={onRowGroupsChange} />);

    hit.result = { insertIndex: 0 };
    startDrag(header(view, "Name"));
    fireEvent.pointerMove(header(view, "Name"), {
      pointerId: 1,
      clientX: 120,
      clientY: 60,
    });

    // The pointer has been sitting over the panel for two moves.
    expect(onRowGroupsChange).not.toHaveBeenCalled();
  });

  it("Escape mid-drag over the panel commits nothing", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(<MirroredGrid onRowGroupsChange={onRowGroupsChange} />);

    hit.result = { insertIndex: 0 };
    startDrag(header(view, "Name"));
    fireEvent.keyDown(header(view, "Name"), { key: "Escape" });
    endDrag(header(view, "Name"));

    expect(onRowGroupsChange).not.toHaveBeenCalled();
    expect(chipIds(view)).toEqual([]);
  });

  it("pointercancel mid-drag over the panel commits nothing", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(<MirroredGrid onRowGroupsChange={onRowGroupsChange} />);

    hit.result = { insertIndex: 0 };
    startDrag(header(view, "Name"));
    fireEvent.pointerCancel(header(view, "Name"), { pointerId: 1 });
    endDrag(header(view, "Name"));

    expect(onRowGroupsChange).not.toHaveBeenCalled();
  });

  it("a disabled panel is never a drop target", () => {
    const onColumnOrderChange = vi.fn();
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        groupPanelEnabled={false}
        onColumnOrderChange={onColumnOrderChange}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );

    // The hit test reports a hit for anything that is passed a panel — with no
    // panel rendered there is nothing to pass, so the drop must reorder.
    hit.result = { insertIndex: 0 };
    startDrag(header(view, "Name"));
    endDrag(header(view, "Name"));

    expect(onRowGroupsChange).not.toHaveBeenCalled();
    expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
  });

  it("marks the panel as the live drop target while the pointer is over it", () => {
    const view = render(<MirroredGrid />);

    hit.result = { insertIndex: 0 };
    startDrag(header(view, "Name"));

    expect(
      view.container.querySelector("[data-pretable-group-panel]"),
    ).toHaveAttribute("data-pretable-group-panel-active");
  });
});

const chipFor = (view: { container: HTMLElement }, columnId: string) =>
  view.container.querySelector(
    `[data-pretable-group-chip][data-pretable-column-id="${columnId}"]`,
  )!;

const panelOf = (view: { container: HTMLElement }) =>
  view.container.querySelector("[data-pretable-group-panel]")!;

/**
 * Chip drags bind pointerdown to the chip and everything after it to the
 * document, so these fire the tail of the gesture at `document` — which is
 * also what a real browser does once the pointer leaves the chip's box.
 */
function dragChip(chip: Element, to: { x: number; y: number }) {
  fireEvent.pointerDown(chip, {
    button: 0,
    pointerId: 7,
    clientX: 10,
    clientY: 10,
  });
  fireEvent.pointerMove(document, { pointerId: 7, clientX: 40, clientY: 12 });
  fireEvent.pointerMove(document, {
    pointerId: 7,
    clientX: to.x,
    clientY: to.y,
  });
}

function dropChip(to: { x: number; y: number }) {
  fireEvent.pointerUp(document, {
    pointerId: 7,
    clientX: to.x,
    clientY: to.y,
  });
}

describe("chip reorder by drag", () => {
  it("dragging a chip past the next one reorders and reports the new list", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );

    hit.result = { insertIndex: 2 };
    dragChip(chipFor(view, "sector"), { x: 180, y: 18 });
    dropChip({ x: 180, y: 18 });

    expect(onRowGroupsChange).toHaveBeenCalledWith(["industry", "sector"]);
    expect(chipIds(view)).toEqual(["industry", "sector"]);
  });

  it("captures the pointer on the panel container, never on the chip", () => {
    // Chips are re-keyed and re-inserted as the insertion index moves, and a
    // capture on a node React replaces is lost mid-gesture. The container is
    // the only stable element in the strip. jsdom cannot reproduce that
    // failure — it never retargets captured events — so the rule is pinned
    // structurally here and exercised for real in Task 8's Playwright spec.
    const view = render(
      <MirroredGrid initialRowGroups={["sector", "industry"]} />,
    );

    dragChip(chipFor(view, "sector"), { x: 180, y: 18 });

    expect(captures).toHaveLength(1);
    expect(captures[0].element).toBe(panelOf(view));
    expect(captures[0].pointerId).toBe(7);
  });

  it("releasing outside the panel is a no-op, not a removal", () => {
    // ag-grid ungroups the moment the pointer leaves the panel, before release
    // and with no undo. We deliberately do not.
    //
    // The SECOND chip is the one dragged out on purpose. Dragging the first out
    // makes this test vacuous: a "no hit" that leaked through as index 0 would
    // put the first chip back where it already was, so the assertion would hold
    // whether or not the miss was honoured. Its negative control does not fire
    // that way round — measured.
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );

    hit.result = null;
    dragChip(chipFor(view, "industry"), { x: 180, y: 400 });
    dropChip({ x: 180, y: 400 });

    expect(onRowGroupsChange).not.toHaveBeenCalled();
    expect(chipIds(view)).toEqual(["sector", "industry"]);
  });

  it("leaving the panel mid-drag commits nothing on its own", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );

    hit.result = { insertIndex: 2 };
    dragChip(chipFor(view, "sector"), { x: 180, y: 18 });
    hit.result = null;
    fireEvent.pointerMove(document, {
      pointerId: 7,
      clientX: 180,
      clientY: 400,
    });

    expect(onRowGroupsChange).not.toHaveBeenCalled();
    expect(chipIds(view)).toEqual(["sector", "industry"]);
  });

  it("Escape mid-drag restores the original order", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );

    hit.result = { insertIndex: 2 };
    dragChip(chipFor(view, "sector"), { x: 180, y: 18 });
    fireEvent.keyDown(document, { key: "Escape" });
    dropChip({ x: 180, y: 18 });

    expect(onRowGroupsChange).not.toHaveBeenCalled();
    expect(chipIds(view)).toEqual(["sector", "industry"]);
  });

  it("pointercancel mid-drag restores the original order", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );

    hit.result = { insertIndex: 2 };
    dragChip(chipFor(view, "sector"), { x: 180, y: 18 });
    fireEvent.pointerCancel(document, { pointerId: 7 });
    dropChip({ x: 180, y: 18 });

    expect(onRowGroupsChange).not.toHaveBeenCalled();
    expect(chipIds(view)).toEqual(["sector", "industry"]);
  });

  it("a press that never passes the threshold is not a drag", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );

    hit.result = { insertIndex: 2 };
    const chip = chipFor(view, "sector");
    fireEvent.pointerDown(chip, {
      button: 0,
      pointerId: 7,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(document, { pointerId: 7, clientX: 12, clientY: 11 });
    dropChip({ x: 12, y: 11 });

    expect(onRowGroupsChange).not.toHaveBeenCalled();
  });

  it("the ✕ still removes rather than starting a drag", () => {
    const onRowGroupsChange = vi.fn();
    const view = render(
      <MirroredGrid
        initialRowGroups={["sector", "industry"]}
        onRowGroupsChange={onRowGroupsChange}
      />,
    );
    const remove = chipFor(view, "sector").querySelector(
      "[data-pretable-chip-remove]",
    )!;

    fireEvent.pointerDown(remove, { button: 0, pointerId: 7 });
    fireEvent.click(remove);

    expect(captures).toHaveLength(0);
    expect(onRowGroupsChange).toHaveBeenCalledWith(["industry"]);
  });

  /**
   * The indicator is rendered from two separate call sites: one inside the
   * chip loop for every position BETWEEN chips, and one after the loop for the
   * append position. Only exercising `insertIndex: rowGroups.length` proves the
   * trailing one — the in-loop render could be deleted outright and an
   * append-only test would stay green. So all three positions are probed, and
   * the indicator's position among the panel's children must equal the
   * insertion index exactly: with N chips before it, index N is where it goes.
   */
  it.each([
    { insertIndex: 0, name: "before both chips" },
    { insertIndex: 1, name: "between the two chips" },
    { insertIndex: 2, name: "after both chips — the append case" },
  ])(
    "shows a gap indicator $name (insertIndex $insertIndex)",
    ({ insertIndex }) => {
      const view = render(
        <MirroredGrid initialRowGroups={["sector", "industry"]} />,
      );

      hit.result = { insertIndex };
      dragChip(chipFor(view, "sector"), { x: 180, y: 18 });

      const indicators = panelOf(view).querySelectorAll(
        "[data-pretable-chip-drop-indicator]",
      );
      expect(indicators).toHaveLength(1);

      const nodes = Array.from(panelOf(view).children);
      // Two chips plus exactly one indicator.
      expect(nodes).toHaveLength(3);
      expect(nodes.indexOf(indicators[0]!)).toBe(insertIndex);
    },
  );

  it("draws no indicator while no drop is pending", () => {
    const view = render(
      <MirroredGrid initialRowGroups={["sector", "industry"]} />,
    );

    hit.result = null;
    dragChip(chipFor(view, "sector"), { x: 180, y: 400 });

    expect(
      panelOf(view).querySelector("[data-pretable-chip-drop-indicator]"),
    ).toBeNull();
  });

  it("marks the chip being dragged", () => {
    const view = render(
      <MirroredGrid initialRowGroups={["sector", "industry"]} />,
    );

    hit.result = { insertIndex: 2 };
    dragChip(chipFor(view, "sector"), { x: 180, y: 18 });

    expect(chipFor(view, "sector")).toHaveAttribute(
      "data-pretable-chip-dragging",
    );
    expect(chipFor(view, "industry")).not.toHaveAttribute(
      "data-pretable-chip-dragging",
    );
  });
});
