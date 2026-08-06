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

  it("resize handles of right-pinned columns stick to the column's trailing edge", () => {
    const { container } = renderSurface();

    // The handle is a 4px strip whose RIGHT edge sits on the column's trailing
    // edge — the same `- 4` as the left form, measured back from the pinned
    // trailing edge instead of `pinnedOffset + width`.
    expect(resizeHandle(container, "actions")).toHaveStyle({
      position: "sticky",
      left: `${ACTIONS_EDGE - 4}px`,
    });
    expectPositionedFromLeft(resizeHandle(container, "actions"));

    expect(resizeHandle(container, "status")).toHaveStyle({
      position: "sticky",
      left: `${STATUS_EDGE - 4}px`,
    });
    expectPositionedFromLeft(resizeHandle(container, "status"));
  });

  it("filter-funnel slots of right-pinned columns sit just inside the resize strip", () => {
    const { container } = renderSurface();

    // The 18px funnel sits immediately left of the 4px resize strip, so its
    // leading edge is 22px inside the column's trailing edge.
    expect(funnelSlot(container, "actions")).toHaveStyle({
      position: "sticky",
      left: `${ACTIONS_EDGE - 22}px`,
    });
    expectPositionedFromLeft(funnelSlot(container, "actions"));

    expect(funnelSlot(container, "status")).toHaveStyle({
      position: "sticky",
      left: `${STATUS_EDGE - 22}px`,
    });
    expectPositionedFromLeft(funnelSlot(container, "status"));
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

    // Left-side overlay geometry is untouched: leading edge + width - N.
    expect(resizeHandle(container, "first")).toHaveStyle({
      position: "sticky",
      left: `${LEFT_WIDTH - 4}px`,
    });
    expect(funnelSlot(container, "first")).toHaveStyle({
      position: "sticky",
      left: `${LEFT_WIDTH - 22}px`,
    });

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

    expect(resizeHandle(container, "c")).toHaveStyle({ position: "absolute" });
    expect(funnelSlot(container, "c")).toHaveStyle({ position: "absolute" });
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
      resizeHandle(container, "actions"),
      funnelSlot(container, "actions"),
    ]) {
      expect(el).not.toBeNull();
      expect(el).toHaveStyle({ position: "absolute" });
      expect(el!.style.left.startsWith("-")).toBe(false);
    }

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

  it("controlled state.columnPinned round-trips 'right' into the engine", () => {
    let capturedGrid: PretableGrid<PinRow> | null = null;
    render(
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
  });
});
