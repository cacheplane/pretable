import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableGrid } from "@pretable/core";

// jsdom has no layout: every element reports clientWidth 0. Right-pinning is
// expressed as a sticky `left` inset resolved against the scrollport's width
// (see getPinnedRightEdge), so the width has to be stubbed for the inline
// styles to be meaningful. NOTE: these assertions prove the *style shape* the
// surface emits — jsdom can never prove that the browser actually sticks. The
// stickiness itself is covered by the real-browser assertions in
// apps/website/e2e/smoke.spec.ts.
const VIEWPORT_WIDTH = 600;
let clientWidth = VIEWPORT_WIDTH;
let originalClientWidth: PropertyDescriptor | undefined;
let resizeCallbacks: ResizeObserverCallback[] = [];

beforeEach(() => {
  clientWidth = VIEWPORT_WIDTH;
  originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  resizeCallbacks = [];
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  if (originalClientWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidth,
    );
  }
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

type PinRow = {
  id: string;
  first: string;
  b: string;
  c: string;
  d: string;
  status: string;
  actions: string;
};

// Column order matters: right offsets accumulate from the LAST column
// backwards, so `actions` (last) sits at right: 0 and `status` is offset by
// the width of `actions`.
const RIGHT_LAST_WIDTH = 80; // actions
const RIGHT_PREV_WIDTH = 90; // status
const LEFT_WIDTH = 120; // first

const columns = [
  {
    id: "first",
    header: "First",
    pinned: "left" as const,
    widthPx: LEFT_WIDTH,
  },
  { id: "b", header: "B", widthPx: 100 },
  { id: "c", header: "C", widthPx: 100 },
  { id: "d", header: "D", widthPx: 100 },
  {
    id: "status",
    header: "Status",
    pinned: "right" as const,
    widthPx: RIGHT_PREV_WIDTH,
  },
  {
    id: "actions",
    header: "Actions",
    pinned: "right" as const,
    widthPx: RIGHT_LAST_WIDTH,
  },
];

const rows: PinRow[] = [
  {
    id: "r1",
    first: "one",
    b: "b1",
    c: "c1",
    d: "d1",
    status: "open",
    actions: "edit",
  },
  {
    id: "r2",
    first: "two",
    b: "b2",
    c: "c2",
    d: "d2",
    status: "closed",
    actions: "edit",
  },
];

function renderSurface() {
  return render(
    <PretableSurface
      ariaLabel="pin-grid"
      columns={columns}
      getRowId={(row: PinRow) => row.id}
      overscan={0}
      rows={rows}
      viewportHeight={200}
    />,
  );
}

function bodyCell(container: HTMLElement, columnId: string) {
  return container.querySelector<HTMLElement>(
    `[data-pretable-cell][data-pretable-column-id="${columnId}"]`,
  );
}

function headerCell(container: HTMLElement, columnId: string) {
  return container.querySelector<HTMLElement>(
    `[data-pretable-header-cell][data-pretable-column-id="${columnId}"]`,
  );
}

function resizeHandle(container: HTMLElement, columnId: string) {
  return container.querySelector<HTMLElement>(
    `[data-pretable-resize-handle][data-pretable-column-id="${columnId}"]`,
  );
}

function funnelSlot(container: HTMLElement, columnId: string) {
  return container.querySelector<HTMLElement>(
    `[data-pretable-filter-funnel][data-pretable-column-id="${columnId}"]`,
  )?.parentElement;
}

/**
 * The zero-width box both header overlays hang off. It is what carries the
 * pinned position; the overlays inside it are placed with fixed negative
 * offsets from the column's trailing edge (see getHeaderOverlayAnchorStyle).
 */
function overlayAnchor(container: HTMLElement, columnId: string) {
  return container.querySelector<HTMLElement>(
    `[data-pretable-header-overlays][data-pretable-column-id="${columnId}"]`,
  );
}

/**
 * The overlays never carry an inset of their own — they are always the same
 * two constants back from the anchor, whatever the column's pin state. Only
 * the anchor moves, which is what keeps the 4px strip on the trailing edge and
 * the 18px funnel 4px inside it at every scroll offset.
 */
function expectOverlayOffsets(container: HTMLElement, columnId: string) {
  expect(resizeHandle(container, columnId)).toHaveStyle({
    position: "absolute",
    left: "-4px",
    width: "4px",
  });
  expect(funnelSlot(container, columnId)).toHaveStyle({
    position: "absolute",
    left: "-22px",
  });
}

// Scrollport-relative x of each right-pinned column's trailing edge.
const ACTIONS_EDGE = VIEWPORT_WIDTH; // last right-pinned column: right = 0
const STATUS_EDGE = VIEWPORT_WIDTH - RIGHT_LAST_WIDTH;

/**
 * Right-pinned boxes must position from `left` only. A `right` inset would be
 * inert here: the row is a flex container whose unpinned cells are absolutely
 * positioned, so a sticky box's flow position is the row's leading edge and
 * `right` can only hold a box back, never push it forward.
 */
function expectPositionedFromLeft(el: HTMLElement | null | undefined) {
  expect(el).not.toBeNull();
  expect(el!.style.right).toBe("");
}

describe("right-pinned columns — surface sticky sites", () => {
  it("body cells of right-pinned columns are sticky at viewportWidth - right - width", () => {
    const { container } = renderSurface();

    const last = bodyCell(container, "actions");
    const prev = bodyCell(container, "status");

    expect(last).not.toBeNull();
    expect(last).toHaveAttribute("data-pretable-pinned", "right");
    expect(last).toHaveStyle({
      position: "sticky",
      left: `${ACTIONS_EDGE - RIGHT_LAST_WIDTH}px`,
    });
    expectPositionedFromLeft(last);

    expect(prev).toHaveAttribute("data-pretable-pinned", "right");
    expect(prev).toHaveStyle({
      position: "sticky",
      left: `${STATUS_EDGE - RIGHT_PREV_WIDTH}px`,
    });
    expectPositionedFromLeft(prev);
  });

  it("header buttons of right-pinned columns are sticky at the same inset as their cells", () => {
    const { container } = renderSurface();

    const last = headerCell(container, "actions");
    const prev = headerCell(container, "status");

    expect(last).toHaveAttribute("data-pretable-pinned", "right");
    expect(last).toHaveStyle({
      position: "sticky",
      left: `${ACTIONS_EDGE - RIGHT_LAST_WIDTH}px`,
    });
    expectPositionedFromLeft(last);

    expect(prev).toHaveAttribute("data-pretable-pinned", "right");
    expect(prev).toHaveStyle({
      position: "sticky",
      left: `${STATUS_EDGE - RIGHT_PREV_WIDTH}px`,
    });
    expectPositionedFromLeft(prev);
  });

  it("header overlays of right-pinned columns anchor on the column's trailing edge", () => {
    const { container } = renderSurface();

    // Both overlays hang off one zero-width anchor stuck on the column's
    // trailing edge: the 4px strip ends ON that edge, the 18px funnel 4px
    // inside it. Zero width is the load-bearing part — an anchor that took up
    // room in the header row's flex flow would push the next pinned column off
    // its own inset.
    expect(overlayAnchor(container, "actions")).toHaveStyle({
      position: "sticky",
      left: `${ACTIONS_EDGE}px`,
      width: "0px",
    });
    expectPositionedFromLeft(overlayAnchor(container, "actions"));
    expectOverlayOffsets(container, "actions");

    expect(overlayAnchor(container, "status")).toHaveStyle({
      position: "sticky",
      left: `${STATUS_EDGE}px`,
      width: "0px",
    });
    expectPositionedFromLeft(overlayAnchor(container, "status"));
    expectOverlayOffsets(container, "status");
  });

  it("right-pinned insets follow the scrollport width on scroll and on resize", () => {
    const { container } = renderSurface();

    const last = () => bodyCell(container, "actions");
    expect(last()).toHaveStyle({
      left: `${VIEWPORT_WIDTH - RIGHT_LAST_WIDTH}px`,
    });

    // The scroll handler re-reads clientWidth...
    clientWidth = 500;
    const viewport = container.querySelector<HTMLElement>(
      "[data-pretable-scroll-viewport]",
    )!;
    fireEvent.scroll(viewport);
    expect(last()).toHaveStyle({ left: `${500 - RIGHT_LAST_WIDTH}px` });

    // ...and so does the ResizeObserver, which is the only signal when the
    // container changes size without a scroll.
    clientWidth = 420;
    expect(resizeCallbacks.length).toBeGreaterThan(0);
    act(() => {
      for (const cb of resizeCallbacks) {
        cb([], {} as ResizeObserver);
      }
    });
    expect(last()).toHaveStyle({ left: `${420 - RIGHT_LAST_WIDTH}px` });
  });

  it("two right-pinned columns stack in column order", () => {
    const { container } = renderSurface();

    const pinnedRight = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-pretable-header-cell][data-pretable-pinned="right"]',
      ),
    ).map((el) => el.getAttribute("data-pretable-column-id"));

    expect(pinnedRight).toEqual(["status", "actions"]);
  });

  it("left- and right-pinned columns coexist on opposite edges", () => {
    const { container } = renderSurface();

    const leftHeader = headerCell(container, "first");
    expect(leftHeader).toHaveAttribute("data-pretable-pinned", "left");
    expect(leftHeader).toHaveStyle({ position: "sticky", left: "0px" });

    const leftBody = bodyCell(container, "first");
    expect(leftBody).toHaveAttribute("data-pretable-pinned", "left");
    expect(leftBody).toHaveStyle({ position: "sticky", left: "0px" });

    // A left-pinned column anchors its overlays the same way, on the trailing
    // edge of its own pinned box: pinned offset + width.
    expect(overlayAnchor(container, "first")).toHaveStyle({
      position: "sticky",
      left: `${LEFT_WIDTH}px`,
      width: "0px",
    });
    expectOverlayOffsets(container, "first");

    expect(bodyCell(container, "actions")).toHaveStyle({
      position: "sticky",
      left: `${ACTIONS_EDGE - RIGHT_LAST_WIDTH}px`,
    });
  });

  it("unpinned columns are unaffected", () => {
    const { container } = renderSurface();

    const header = headerCell(container, "c");
    expect(header).not.toHaveAttribute("data-pretable-pinned");
    expect(header).toHaveStyle({ position: "absolute" });

    const cell = bodyCell(container, "c");
    expect(cell).not.toHaveAttribute("data-pretable-pinned");
    expect(cell).toHaveStyle({ position: "absolute" });

    // An unpinned column's overlays ride the scrolling content: the anchor is
    // a plain absolute box on the column's trailing edge, with the same two
    // offsets inside it.
    expect(overlayAnchor(container, "c")).toHaveStyle({
      position: "absolute",
      left: "320px", // 120 (first) + 100 (b) + 100 (c)
      width: "0px",
    });
    expectOverlayOffsets(container, "c");
  });

  it("falls back to the plain cell style until the scrollport is measured", () => {
    // Pre-hydration (and whenever the surface is display:none) clientWidth is
    // 0. `viewportWidth - right` would then be a NEGATIVE left inset, parking
    // every right-pinned cell off-screen to the left, so the surface must emit
    // the plain non-sticky style instead and wait for a real measurement.
    clientWidth = 0;
    const { container } = renderSurface();

    for (const el of [
      bodyCell(container, "actions"),
      headerCell(container, "actions"),
      overlayAnchor(container, "actions"),
    ]) {
      expect(el).not.toBeNull();
      expect(el).toHaveStyle({ position: "absolute" });
      expect(el!.style.left.startsWith("-")).toBe(false);
    }
    // The overlays inside the anchor keep their fixed offsets either way —
    // they are relative to the anchor, so they never go off-screen on their
    // own.
    expectOverlayOffsets(container, "actions");

    // Once measured, the sticky inset appears.
    clientWidth = VIEWPORT_WIDTH;
    fireEvent.scroll(
      container.querySelector<HTMLElement>("[data-pretable-scroll-viewport]")!,
    );
    expect(bodyCell(container, "actions")).toHaveStyle({
      position: "sticky",
      left: `${VIEWPORT_WIDTH - RIGHT_LAST_WIDTH}px`,
    });
  });

  it("resizing a right-pinned column follows the pointer's direction", () => {
    const { container } = renderSurface();

    const handle = resizeHandle(container, "actions")!;
    const widthOf = (columnId: string) =>
      Number.parseFloat(headerCell(container, columnId)!.style.width);

    expect(widthOf("actions")).toBe(RIGHT_LAST_WIDTH);

    // A right-pinned column's trailing edge is anchored to the scrollport, so
    // its LEADING edge is the only one a drag can move — and it moves left as
    // the column grows. Dragging left must therefore GROW the column, so that
    // the edge the user sees move travels with the pointer.
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 470, pointerId: 1 });
    expect(widthOf("actions")).toBe(RIGHT_LAST_WIDTH + 30);

    // ...and dragging back to the right shrinks it again.
    fireEvent.pointerMove(handle, { clientX: 520, pointerId: 1 });
    expect(widthOf("actions")).toBe(RIGHT_LAST_WIDTH - 20);

    fireEvent.pointerUp(handle, { pointerId: 1 });
  });

  it("successive drags on a right-pinned column accumulate", () => {
    const { container } = renderSurface();

    const handle = resizeHandle(container, "actions")!;
    const widthOf = (columnId: string) =>
      Number.parseFloat(headerCell(container, columnId)!.style.width);

    // Right-pinned drags are inverted (leftward grows), but the start width
    // has to come from the committed width all the same.
    fireEvent.pointerDown(handle, { button: 0, clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 470, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 470, pointerId: 1 });
    expect(widthOf("actions")).toBe(RIGHT_LAST_WIDTH + 30);

    fireEvent.pointerDown(handle, { button: 0, clientX: 470, pointerId: 2 });
    fireEvent.pointerMove(handle, { clientX: 450, pointerId: 2 });
    fireEvent.pointerUp(handle, { clientX: 450, pointerId: 2 });
    expect(widthOf("actions")).toBe(RIGHT_LAST_WIDTH + 50);
  });

  it("resizing an unpinned column keeps the plain (non-inverted) direction", () => {
    const { container } = renderSurface();

    const handle = resizeHandle(container, "c")!;
    const widthOf = (columnId: string) =>
      Number.parseFloat(headerCell(container, columnId)!.style.width);

    // The unpinned handle sits on a trailing edge that really does move, so
    // dragging right grows the column, exactly as before.
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 2 });
    fireEvent.pointerMove(handle, { clientX: 340, pointerId: 2 });
    expect(widthOf("c")).toBe(140);

    fireEvent.pointerMove(handle, { clientX: 275, pointerId: 2 });
    expect(widthOf("c")).toBe(75);

    fireEvent.pointerUp(handle, { pointerId: 2 });
  });

  it("controlled state.columnPinned round-trips 'right' into the engine and into the DOM", () => {
    let capturedGrid: PretableGrid<PinRow> | null = null;
    const { container } = render(
      <PretableSurface
        ariaLabel="controlled-pin-grid"
        columns={[
          { id: "first", header: "First", widthPx: 120 },
          { id: "b", header: "B", widthPx: 100 },
          { id: "c", header: "C", widthPx: 100 },
          { id: "d", header: "D", widthPx: 100 },
          { id: "status", header: "Status", widthPx: 90 },
          { id: "actions", header: "Actions", widthPx: 80 },
        ]}
        getRowId={(row: PinRow) => row.id}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={rows}
        state={{ columnPinned: { actions: "right", first: "left", c: null } }}
        viewportHeight={200}
      />,
    );

    const cols = capturedGrid!.options.columns;
    expect(cols.find((col) => col.id === "actions")?.pinned).toBe("right");
    expect(cols.find((col) => col.id === "first")?.pinned).toBe("left");
    expect(cols.find((col) => col.id === "c")?.pinned).toBeUndefined();

    // Engine state alone is not the contract — the cells have to actually
    // render pinned. The prop columns carry no `pinned`, so this is the only
    // assertion that catches the surface reading pin state off the props.
    expect(bodyCell(container, "actions")).toHaveAttribute(
      "data-pretable-pinned",
      "right",
    );
    expect(bodyCell(container, "actions")).toHaveStyle({ position: "sticky" });
    expect(bodyCell(container, "first")).toHaveAttribute(
      "data-pretable-pinned",
      "left",
    );
    expect(bodyCell(container, "first")).toHaveStyle({ position: "sticky" });
    expect(bodyCell(container, "c")).not.toHaveAttribute(
      "data-pretable-pinned",
    );
  });
});

// ---------------------------------------------------------------------------
// Pin state applied through the ENGINE only (controlled state.columnPinned or
// an imperative grid.setColumnPinned). The prop `columns` array never catches
// up — mergeColumnsFromProps only re-runs on an id-list change and gives
// engine state precedence — so every render site has to read the planned
// column, not the prop column.
// ---------------------------------------------------------------------------

const UNPINNED_COLUMNS = [
  { id: "first", header: "First", widthPx: 120 },
  { id: "b", header: "B", widthPx: 100 },
  { id: "c", header: "C", widthPx: 100 },
  { id: "d", header: "D", widthPx: 100 },
  { id: "status", header: "Status", widthPx: 90 },
  { id: "actions", header: "Actions", widthPx: 80 },
];

describe("pin state applied through the engine only", () => {
  it("right pin via controlled state.columnPinned renders a sticky, marked body cell", () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="engine-right-pin"
        columns={UNPINNED_COLUMNS}
        getRowId={(row: PinRow) => row.id}
        overscan={0}
        rows={rows}
        state={{ columnPinned: { actions: "right" } }}
        viewportHeight={200}
      />,
    );

    const cell = bodyCell(container, "actions");
    // Without the attribute the pinned-cell CSS in @pretable/ui never applies,
    // so the cell renders transparent and scrolled rows show through it.
    expect(cell).toHaveAttribute("data-pretable-pinned", "right");
    expect(cell).toHaveStyle({
      position: "sticky",
      left: `${VIEWPORT_WIDTH - RIGHT_LAST_WIDTH}px`,
    });
    expectPositionedFromLeft(cell);
  });

  it("left pin via controlled state.columnPinned sticks header and body at the planned offset", () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="engine-left-pin"
        columns={UNPINNED_COLUMNS}
        getRowId={(row: PinRow) => row.id}
        overscan={0}
        rows={rows}
        state={{ columnPinned: { first: "left", b: "left" } }}
        viewportHeight={200}
      />,
    );

    for (const [columnId, left] of [
      ["first", 0],
      ["b", 120],
    ] as const) {
      const header = headerCell(container, columnId);
      expect(header).toHaveAttribute("data-pretable-pinned", "left");
      expect(header).toHaveStyle({ position: "sticky", left: `${left}px` });

      const cell = bodyCell(container, columnId);
      expect(cell).toHaveAttribute("data-pretable-pinned", "left");
      expect(cell).toHaveStyle({ position: "sticky", left: `${left}px` });
    }
  });

  it("unpinning a prop-pinned column through the engine drops the sticky style and the attribute", () => {
    let capturedGrid: PretableGrid<PinRow> | null = null;
    const { container } = render(
      <PretableSurface
        ariaLabel="engine-unpin"
        columns={columns}
        getRowId={(row: PinRow) => row.id}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={rows}
        viewportHeight={200}
      />,
    );

    expect(bodyCell(container, "actions")).toHaveAttribute(
      "data-pretable-pinned",
      "right",
    );

    act(() => {
      capturedGrid!.setColumnPinned("actions", null);
    });

    // A stale attribute would give a normally-scrolling column the pinned
    // background, z-index and leading divider.
    const cell = bodyCell(container, "actions");
    expect(cell).not.toHaveAttribute("data-pretable-pinned");
    expect(cell).not.toHaveStyle({ position: "sticky" });
    expect(headerCell(container, "actions")).not.toHaveAttribute(
      "data-pretable-pinned",
    );
  });

  it("left-pin offsets follow engine widths, not the prop widths", () => {
    let capturedGrid: PretableGrid<PinRow> | null = null;
    const { container } = render(
      <PretableSurface
        ariaLabel="engine-left-pin-widths"
        columns={[
          {
            id: "first",
            header: "First",
            pinned: "left" as const,
            widthPx: 120,
          },
          { id: "b", header: "B", pinned: "left" as const, widthPx: 100 },
          { id: "c", header: "C", widthPx: 100 },
          { id: "d", header: "D", widthPx: 100 },
          { id: "status", header: "Status", widthPx: 90 },
          { id: "actions", header: "Actions", widthPx: 80 },
        ]}
        getRowId={(row: PinRow) => row.id}
        onGridReady={(g) => {
          capturedGrid = g;
        }}
        overscan={0}
        rows={rows}
        viewportHeight={200}
      />,
    );

    expect(bodyCell(container, "b")).toHaveStyle({ left: "120px" });

    act(() => {
      capturedGrid!.setColumnWidth("first", 200);
    });

    // The prop column still says 120; the engine says 200. The second
    // left-pinned column must sit flush against the resized first one.
    expect(headerCell(container, "b")).toHaveStyle({
      position: "sticky",
      left: "200px",
    });
    expect(bodyCell(container, "b")).toHaveStyle({
      position: "sticky",
      left: "200px",
    });
  });
});

// ---------------------------------------------------------------------------
// The UNMEASURED scrollport. `viewportWidth` starts at 0 and is only corrected
// by a layout effect, and the surface passes `viewportWidth || undefined` down,
// so the first committed render — and every SSR render, where the effect never
// runs — takes the renderer's no-viewportWidth column plan. This describe
// deliberately drops the 600px `clientWidth` stub the rest of the file relies
// on (0 is what unstubbed jsdom reports) so that path is the one under test.
// ---------------------------------------------------------------------------

describe("left pins before the scrollport is measured", () => {
  beforeEach(() => {
    clientWidth = 0;
  });

  it("sticks a prop-declared left pin at its pinned-group offset, not its declaration offset", () => {
    // `b` is left-pinned but declared SECOND. A left pin is rendered flush
    // against the scrollport's leading edge, so its sticky inset is its offset
    // within the left-pinned group (0 — it is the only one), never the 150px
    // of scrollable content that happens to precede it in the columns prop.
    // Only a prop-declared pin can hit this: setColumnPinned and controlled
    // state.columnPinned both relocate the column to the leading region.
    const { container } = render(
      <PretableSurface
        ariaLabel="unmeasured-left-pin"
        columns={[
          { id: "a", header: "A", widthPx: 150 },
          { id: "b", header: "B", pinned: "left" as const, widthPx: 100 },
        ]}
        getRowId={(row: PinRow) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={200}
      />,
    );

    const header = headerCell(container, "b");
    expect(header).toHaveAttribute("data-pretable-pinned", "left");
    expect(header).toHaveStyle({ position: "sticky", left: "0px" });

    const cell = bodyCell(container, "b");
    expect(cell).toHaveAttribute("data-pretable-pinned", "left");
    expect(cell).toHaveStyle({ position: "sticky", left: "0px" });

    // The overlay chrome rides on the same offset: leading edge + width.
    expect(overlayAnchor(container, "b")).toHaveStyle({
      position: "sticky",
      left: "100px",
      width: "0px",
    });
    expectOverlayOffsets(container, "b");
  });
});

// ---------------------------------------------------------------------------
// Left-pinned header overlays. The header row is a flex container whose
// unpinned cells are absolutely positioned, so its in-flow items are exactly
// the sticky ones — the left-pinned header cells, in order. An overlay placed
// after its own pinned header cell therefore has a FLOW position of
// `pinnedOffset + width`, past every inset it could want, and a sticky `left`
// inset can only push a box further right, never pull it back: at scrollLeft 0
// such an overlay is stranded on its flow position and overhangs the next
// column (by 4px for the resize strip, 22px for the funnel), snapping into
// place only once the row has scrolled.
//
// jsdom has no layout and can never reproduce that; these assertions pin the
// shape that makes it impossible — the sticky inset lives on a zero-width
// anchor whose target IS its flow position, and the overlays carry only fixed
// offsets from it. The geometry itself is measured in a real browser at
// scrollLeft 0, mid and max by apps/website/e2e/smoke.spec.ts.
// ---------------------------------------------------------------------------

describe("left-pinned header overlays", () => {
  const LEAD_WIDTH = 120;

  function renderLeftPinned() {
    return render(
      <PretableSurface
        ariaLabel="left-pin-overlays"
        columns={[
          {
            id: "first",
            header: "First",
            pinned: "left" as const,
            widthPx: LEAD_WIDTH,
          },
          { id: "b", header: "B", widthPx: 100 },
          { id: "c", header: "C", widthPx: 100 },
        ]}
        getRowId={(row: PinRow) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={200}
      />,
    );
  }

  it("puts the sticky inset on a zero-width anchor at the column's trailing edge", () => {
    const { container } = renderLeftPinned();

    // The anchor's inset equals the summed width of the left-pinned group
    // through this column — which is also where the header row's flex flow
    // puts it, so the inset asks for no shift at scrollLeft 0 and clamps at
    // every offset after that.
    expect(overlayAnchor(container, "first")).toHaveStyle({
      position: "sticky",
      left: `${LEAD_WIDTH}px`,
      width: "0px",
    });
    expectPositionedFromLeft(overlayAnchor(container, "first"));
  });

  it("gives the overlays no inset of their own — only offsets from the anchor", () => {
    const { container } = renderLeftPinned();

    // An inset on the overlays themselves is what the browser could not honor.
    // They must be plain absolute boxes inside the anchor.
    expectOverlayOffsets(container, "first");
    expect(resizeHandle(container, "first")).not.toHaveStyle({
      position: "sticky",
    });
    expect(funnelSlot(container, "first")).not.toHaveStyle({
      position: "sticky",
    });
  });

  it("tracks a resize: the anchor follows the drag, the offsets do not move", () => {
    const { container } = renderLeftPinned();

    const handle = resizeHandle(container, "first")!;
    fireEvent.pointerDown(handle, { button: 0, clientX: 120, pointerId: 7 });
    fireEvent.pointerMove(handle, { clientX: 180, pointerId: 7 });

    expect(overlayAnchor(container, "first")).toHaveStyle({
      left: `${LEAD_WIDTH + 60}px`,
    });
    expectOverlayOffsets(container, "first");

    fireEvent.pointerUp(handle, { pointerId: 7 });
  });
});
