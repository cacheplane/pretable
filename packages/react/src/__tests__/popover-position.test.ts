import { afterEach, describe, expect, it } from "vitest";

import { menuPopoverStyle, popoverStyle } from "../overlay/popover-position";

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
    writable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
    writable: true,
  });
}

/** Minimal DOMRect stand-in — popoverStyle only reads these four edges. */
function rect(
  top: number,
  left: number,
  bottom: number,
  right: number,
): DOMRect {
  return {
    top,
    left,
    bottom,
    right,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  setViewport(originalWidth, originalHeight);
});

describe("popoverStyle", () => {
  it("opens downward, anchored by top, when there is room below", () => {
    setViewport(1024, 768);
    const style = popoverStyle(rect(100, 200, 120, 300));

    expect(style.top).toBe(124); // rect.bottom + GAP
    expect(style.bottom).toBeUndefined();
    expect(style.left).toBe(200);
    expect(style.position).toBe("fixed");
  });

  it("flips upward, anchored by bottom, when there is no room below", () => {
    setViewport(1024, 768);
    // Anchor near the viewport bottom: ~28px below, ~700px above.
    const style = popoverStyle(rect(720, 200, 740, 300));

    expect(style.top).toBeUndefined();
    // Distance from the viewport bottom edge to the anchor's top, plus GAP.
    expect(style.bottom).toBe(768 - 720 + 4);
    expect(style.left).toBe(200);
  });

  it("stays downward when neither side has room (below is the larger side)", () => {
    setViewport(1024, 240);
    // Anchor mid-viewport in a very short window: 108 usable below, 96 above.
    const style = popoverStyle(rect(108, 200, 120, 300));

    expect(style.top).toBe(124);
    expect(style.bottom).toBeUndefined();
  });

  it("stays downward when there is no room on either side and above is smaller", () => {
    setViewport(1024, 200);
    const style = popoverStyle(rect(20, 200, 40, 300));

    expect(style.top).toBe(44);
    expect(style.bottom).toBeUndefined();
  });

  it("clamps horizontally against the right edge", () => {
    setViewport(400, 768);
    const style = popoverStyle(rect(100, 380, 120, 400));

    // vw - WIDTH - MARGIN = 400 - 240 - 8
    expect(style.left).toBe(152);
  });

  it("never clamps past the left margin on a narrow viewport", () => {
    setViewport(200, 768);
    const style = popoverStyle(rect(100, 10, 120, 60));

    expect(style.left).toBe(8);
  });

  it("does not set maxHeight (CSS owns the popover's own height cap)", () => {
    setViewport(1024, 768);
    expect(popoverStyle(rect(720, 200, 740, 300)).maxHeight).toBeUndefined();
    expect(popoverStyle(rect(100, 200, 120, 300)).maxHeight).toBeUndefined();
  });
});

describe("menuPopoverStyle", () => {
  it("sizes to its content instead of the dialog's fixed column", () => {
    setViewport(1024, 768);
    const style = menuPopoverStyle(rect(100, 200, 120, 300));

    // The defect this exists for: a four-item pin menu drawn 240px wide.
    expect(style.width).toBe("max-content");
    expect(style.maxWidth).toBe(240);
    expect(popoverStyle(rect(100, 200, 120, 300)).width).toBe(240);
  });

  it("keeps a floor, so a one-word menu is still menu-shaped", () => {
    setViewport(1024, 768);
    expect(menuPopoverStyle(rect(100, 200, 120, 300)).minWidth).toBe(160);
  });

  it("places itself exactly as a dialog does", () => {
    setViewport(1024, 768);
    const anchor = rect(100, 200, 120, 300);
    const { width, minWidth, maxWidth, ...placement } =
      menuPopoverStyle(anchor);
    const { width: dialogWidth, ...dialogPlacement } = popoverStyle(anchor);

    expect(placement).toEqual(dialogPlacement);
    expect(dialogWidth).toBe(240);
    expect(width).toBe("max-content");
    expect(minWidth).toBe(160);
    expect(maxWidth).toBe(240);
  });

  it("clamps against the widest it could be, never past the right edge", () => {
    setViewport(400, 768);
    // Same clamp as the dialog: a content-sized menu can only be narrower,
    // so the bound holds without measuring the rendered menu.
    expect(menuPopoverStyle(rect(100, 380, 120, 400)).left).toBe(152);
  });

  it("flips upward when there is no room below", () => {
    setViewport(1024, 768);
    const style = menuPopoverStyle(rect(720, 200, 740, 300));

    expect(style.top).toBeUndefined();
    expect(style.bottom).toBe(768 - 720 + 4);
  });
});
