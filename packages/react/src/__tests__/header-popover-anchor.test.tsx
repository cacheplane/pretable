// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";

// ---------------------------------------------------------------------------
// The popover follows its anchor; it does not flee on hearing a scroll.
//
// What jsdom CAN prove, and what it cannot:
//
// CAN — the decision. `useHeaderPopover` reads two rects and either writes a
// new position or closes, and both rects are things a test can hand it. Every
// branch of that decision is exercised below against rects we choose, which is
// stricter than a browser test can be: a browser will not scroll an anchor to
// an arbitrary offset on demand.
//
// CANNOT — that a real scroll produces those rects, that the listener is
// reached at all through a real engine's scroll pipeline, or that the popover
// lands where the user sees it. jsdom has no layout and no scrolling: every
// element reports 0x0 and `window.scrollBy` moves nothing. That half is
// asserted in apps/website/e2e/grid-header-popover-scroll.spec.ts, in both
// engines, and only there.
//
// The stubs below are therefore the POINT of this file rather than a
// concession — but they are also why it cannot stand alone.
// ---------------------------------------------------------------------------

type Bug = { id: string; title: string; count: number };

const columns: PretableColumn<Bug>[] = [
  { id: "title", header: "Title", widthPx: 200, type: "text" },
  { id: "count", header: "Count", widthPx: 120, type: "number" },
];

const rows: Bug[] = [
  { id: "b1", title: "alpha", count: 3 },
  { id: "b2", title: "beta", count: 7 },
];

function rectAt(top: number, left = 100, width = 20, height = 20): DOMRect {
  return {
    top,
    left,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Mount, give the grid a layout jsdom cannot, and open the Title filter.
 *
 * `moveAnchorTo` is what a scroll would have done: it rewrites the funnel's
 * rect and fires the scroll event, in that order, exactly as a browser would
 * present it to the listener.
 */
function open() {
  const view = render(
    <PretableSurface<Bug>
      ariaLabel="popover anchor"
      columns={columns}
      getRowId={(row) => row.id}
      rows={rows}
      viewportHeight={300}
    />,
  );

  // The grid's own scroll viewport clips the header, so the hook measures it
  // too. Give it a generous box: this test is about the WINDOW moving, and a
  // 0x0 clip would report every anchor as clipped away.
  const clip = view.container.querySelector<HTMLElement>(
    "[data-pretable-scroll-viewport]",
  )!;
  clip.getBoundingClientRect = () => rectAt(0, 0, 800, 600);

  const funnel = view.container.querySelector<HTMLElement>(
    "[data-pretable-filter-funnel]",
  )!;
  let anchor = rectAt(200);
  funnel.getBoundingClientRect = () => anchor;

  fireEvent.click(funnel);
  const dialog = () => screen.queryByRole("dialog", { name: /Filter/ });
  expect(dialog()).not.toBeNull();

  const moveAnchorTo = (top: number) => {
    anchor = rectAt(top);
    fireEvent.scroll(window);
  };

  return { view, funnel, dialog, moveAnchorTo };
}

afterEach(cleanup);

describe("a header popover tracks its anchor", () => {
  test("a scroll that moves the anchor repositions the popover", () => {
    const { dialog, moveAnchorTo } = open();

    // `popoverStyle` opens the popover below the anchor, so its `top` is the
    // anchor's `bottom` plus the gap. Read the offset rather than hard-coding
    // the gap — the gap is that module's business, and following it is this
    // module's.
    const gap = Number.parseFloat(dialog()!.style.top) - 220;

    moveAnchorTo(140);

    expect(dialog()).not.toBeNull();
    expect(Number.parseFloat(dialog()!.style.top)).toBe(160 + gap);
  });

  test("a scroll that leaves the anchor alone repositions nothing", () => {
    const { dialog, moveAnchorTo } = open();
    const before = dialog()!.style.top;

    // The grid's own vertical body scroll, under a sticky header: the event
    // fires, the anchor has not moved.
    moveAnchorTo(200);

    expect(dialog()).not.toBeNull();
    expect(dialog()!.style.top).toBe(before);
  });

  test("an anchor scrolled off the top of the viewport closes the popover", () => {
    const { dialog, moveAnchorTo } = open();

    // Fully above the fold: `bottom` is negative, so nothing of the anchor is
    // on screen any more and a popover pointing at it points at nothing.
    moveAnchorTo(-40);

    expect(dialog()).toBeNull();
  });

  test("an anchor scrolled off the bottom of the viewport closes the popover", () => {
    const { dialog, moveAnchorTo } = open();

    moveAnchorTo(window.innerHeight + 10);

    expect(dialog()).toBeNull();
  });

  test("an anchor removed from the document closes the popover", () => {
    const { funnel, dialog } = open();

    funnel.remove();
    fireEvent.scroll(window);

    expect(dialog()).toBeNull();
  });

  test("Escape still closes it", () => {
    const { dialog } = open();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(dialog()).toBeNull();
  });

  test("an outside pointerdown still closes it", () => {
    const { dialog } = open();

    fireEvent.pointerDown(document.body);

    expect(dialog()).toBeNull();
  });
});
