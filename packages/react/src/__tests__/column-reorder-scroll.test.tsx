import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";

// jsdom has no layout: elements report clientWidth 0 and ignore scrollLeft
// writes. Both are stubbed so the reorder gesture — which reads the scrollport
// to convert client x into the space columns are laid out in — has something
// real to read. These assertions prove the coordinate math; that the browser
// actually sticks and scrolls is covered in apps/website/e2e/smoke.spec.ts.
const VIEWPORT_WIDTH = 400;
let clientWidth = VIEWPORT_WIDTH;
let scrollLeft = 0;
let originalClientWidth: PropertyDescriptor | undefined;
let originalScrollLeft: PropertyDescriptor | undefined;

beforeEach(() => {
  clientWidth = VIEWPORT_WIDTH;
  scrollLeft = 0;
  originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  originalScrollLeft = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollLeft",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  Object.defineProperty(Element.prototype, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (next: number) => {
      scrollLeft = next;
    },
  });
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
  if (originalScrollLeft) {
    Object.defineProperty(Element.prototype, "scrollLeft", originalScrollLeft);
  }
});

type Row = {
  id: string;
  pin: string;
  b: string;
  c: string;
  d: string;
  note: string;
};

// Content layout, 800px wide inside a 400px scrollport:
//   pin  [   0…100)  left-pinned  — sticky at viewport x 0
//   b    [ 100…300)
//   c    [ 300…500)
//   d    [ 500…700)
//   note [ 700…800)  right-pinned — sticky at viewport x 300
const columns = [
  { id: "pin", header: "Pin", widthPx: 100, pinned: "left" as const },
  { id: "b", header: "B", widthPx: 200 },
  { id: "c", header: "C", widthPx: 200 },
  { id: "d", header: "D", widthPx: 200 },
  { id: "note", header: "Note", widthPx: 100, pinned: "right" as const },
];

const rows: Row[] = [
  { id: "r1", pin: "p1", b: "b1", c: "c1", d: "d1", note: "n1" },
  { id: "r2", pin: "p2", b: "b2", c: "c2", d: "d2", note: "n2" },
];

function renderSurface(
  onColumnOrderChange?: (order: readonly string[]) => void,
  onColumnPinnedChange?: (
    pinned: Partial<Record<string, "left" | "right" | null>>,
  ) => void,
) {
  return render(
    <PretableSurface<Row>
      ariaLabel="scroll-reorder-grid"
      columns={columns}
      getRowId={(row: Row) => row.id}
      onColumnOrderChange={onColumnOrderChange}
      onColumnPinnedChange={onColumnPinnedChange}
      overscan={0}
      rows={rows}
      viewportHeight={200}
    />,
  );
}

/**
 * Scroll the grid sideways the way a browser does: move the scrollport, then
 * let the surface re-plan off the scroll event. Columns that scroll out of the
 * window stop rendering, so which headers exist depends on this running first.
 */
function scrollTo(view: ReturnType<typeof render>, next: number) {
  const viewport = view.container.querySelector<HTMLElement>(
    "[data-pretable-scroll-viewport]",
  );
  expect(viewport).not.toBeNull();
  scrollLeft = next;
  if (viewport) fireEvent.scroll(viewport);
}

function dragHeaderTo(
  view: ReturnType<typeof render>,
  label: string,
  clientX: number,
) {
  const header = view.getByLabelText(`Sort ${label}`) as HTMLButtonElement;
  fireEvent.pointerDown(header, {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 10,
  });
  fireEvent.pointerMove(header, { pointerId: 1, clientX, clientY: 10 });
  return header;
}

function indicatorLeft(view: ReturnType<typeof render>) {
  const indicator = view.container.querySelector<HTMLElement>(
    "[data-pretable-reorder-drop-indicator]",
  );
  expect(indicator).not.toBeNull();
  return indicator?.style.left;
}

// At scrollLeft 300 the scrollport shows, left to right:
//   pin  sticky at viewport   0…100
//   c    content 300 → viewport   0…200 (its head runs under the pinned strip)
//   d    content 500 → viewport 200…400
//   note sticky at viewport 300…400
// "b" has scrolled out of the window entirely and no longer renders.
const SCROLLED = 300;

describe("column reorder under horizontal scroll", () => {
  it("drops the column where the cursor is, not where it would be unscrolled", () => {
    const onColumnOrderChange = vi.fn();
    const view = renderSurface(onColumnOrderChange);
    scrollTo(view, SCROLLED);

    // Viewport x 340 is inside the sticky "note", left of its midpoint (350) →
    // "c" lands between "d" and "note". Measured against *content* offsets the
    // same point reads as "c" itself and the drag is a no-op.
    const header = dragHeaderTo(view, "C", 340);
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 340, clientY: 10 });

    expect(onColumnOrderChange).toHaveBeenCalledTimes(1);
    expect(onColumnOrderChange.mock.calls[0]?.[0]).toEqual([
      "pin",
      "b",
      "d",
      "c",
      "note",
    ]);
  });

  it("draws the indicator at the scroll-adjusted content offset", () => {
    const view = renderSurface();
    scrollTo(view, SCROLLED);

    const header = dragHeaderTo(view, "C", 250);
    // Viewport x 250 is inside "d", whose content offset is 500 — the
    // indicator lives in content space, so that is where it must be drawn even
    // though the cursor is at viewport 250.
    expect(indicatorLeft(view)).toBe("500px");

    fireEvent.pointerUp(header, { pointerId: 1, clientX: 250, clientY: 10 });
  });

  it("hit-tests the left-pinned strip where it is seen, not where it scrolled to", () => {
    const onColumnOrderChange = vi.fn();
    const view = renderSurface(onColumnOrderChange);
    scrollTo(view, SCROLLED);

    // "pin" is sticky at viewport x 0…100 whatever the scroll offset, so a
    // cursor at viewport x 20 is inside it — and the indicator, which scrolls
    // with the content, has to be pushed out by scrollLeft to line up with it.
    const header = dragHeaderTo(view, "D", 20);
    expect(indicatorLeft(view)).toBe("300px");

    fireEvent.pointerUp(header, { pointerId: 1, clientX: 20, clientY: 10 });
    expect(onColumnOrderChange.mock.calls[0]?.[0]).toEqual([
      "d",
      "pin",
      "b",
      "c",
      "note",
    ]);
  });

  it("hit-tests the right-pinned strip at the scrollport's trailing edge", () => {
    const view = renderSurface();
    scrollTo(view, SCROLLED);

    // "note" is sticky at viewport x 300…400; x 310 is inside it, left of its
    // midpoint (350). Its content offset is 700, but while scrolled it is
    // *seen* at content 600 — that is where the indicator belongs.
    const header = dragHeaderTo(view, "C", 310);
    expect(indicatorLeft(view)).toBe("600px");

    fireEvent.pointerUp(header, { pointerId: 1, clientX: 310, clientY: 10 });
  });

  it("takes the right pin when dropped in the trailing half of that strip", () => {
    const onColumnOrderChange = vi.fn();
    const onColumnPinnedChange = vi.fn();
    const view = renderSurface(onColumnOrderChange, onColumnPinnedChange);
    scrollTo(view, SCROLLED);

    const header = dragHeaderTo(view, "C", 390);
    fireEvent.pointerUp(header, { pointerId: 1, clientX: 390, clientY: 10 });

    expect(onColumnOrderChange).toHaveBeenCalledWith([
      "pin",
      "b",
      "d",
      "note",
      "c",
    ]);
    expect(onColumnPinnedChange).toHaveBeenCalledWith(
      expect.objectContaining({ c: "right", note: "right" }),
    );
  });

  it("still resolves drops with no horizontal scroll", () => {
    const onColumnOrderChange = vi.fn();
    const view = renderSurface(onColumnOrderChange);

    // Unscrolled, "note" is sticky at viewport x 300…400 and x 310 is left of
    // its midpoint, so "b" lands last among the unpinned columns. With no
    // scroll to correct for, the indicator sits on the strip itself (300).
    const header = dragHeaderTo(view, "B", 310);
    expect(indicatorLeft(view)).toBe("300px");

    fireEvent.pointerUp(header, { pointerId: 1, clientX: 310, clientY: 10 });
    expect(onColumnOrderChange.mock.calls[0]?.[0]).toEqual([
      "pin",
      "c",
      "d",
      "b",
      "note",
    ]);
  });
});
