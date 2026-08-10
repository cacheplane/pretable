import { describe, expect, it } from "vitest";

import { hitTestGroupPanel } from "../group-panel/group-panel-hit-test";

/**
 * ## Scope of this file — read before adding to it
 *
 * These tests feed `hitTestGroupPanel` **hand-written rectangles**. They cover
 * the predicate's own arithmetic: which side of an edge counts as inside, that
 * a zero-size panel is excluded, and how chip midpoints become an insertion
 * index.
 *
 * They do **not** prove the drop-zone disambiguation works, because they never
 * ask the browser where anything is — jsdom lays nothing out, so a real panel
 * and a real header both report a zero rect at the origin. That the panel's
 * rect and the header's rect are actually distinguishable is Task 8's
 * Playwright assertion and only Task 8's.
 */

function stubElement(rect: Partial<DOMRect>, chips: Partial<DOMRect>[] = []) {
  const asRect = (r: Partial<DOMRect>) =>
    ({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      ...r,
    }) as DOMRect;

  return {
    getBoundingClientRect: () => asRect(rect),
    querySelectorAll: () =>
      chips.map((chip) => ({ getBoundingClientRect: () => asRect(chip) })),
  } as unknown as HTMLElement;
}

const panel = stubElement({
  left: 0,
  top: 0,
  right: 300,
  bottom: 36,
  width: 300,
  height: 36,
});

describe("hitTestGroupPanel", () => {
  it("misses when there is no panel at all", () => {
    expect(hitTestGroupPanel(null, 10, 10)).toBeNull();
  });

  it("hits well inside the rect and misses well outside it", () => {
    expect(hitTestGroupPanel(panel, 150, 18)).not.toBeNull();
    // Below the strip — this is the header, which must stay a reorder target.
    expect(hitTestGroupPanel(panel, 150, 80)).toBeNull();
    expect(hitTestGroupPanel(panel, 400, 18)).toBeNull();
    expect(hitTestGroupPanel(panel, -1, 18)).toBeNull();
    expect(hitTestGroupPanel(panel, 150, -1)).toBeNull();
  });

  /**
   * The rect is half-open — `[left, right) × [top, bottom)`. Every probe below
   * sits ON a boundary coordinate or one pixel either side of it, which is the
   * only way this file can distinguish `<` from `<=`: with all four
   * comparisons flipped, a suite whose probes are all in the interior passes
   * unchanged.
   *
   * `bottom` is the load-bearing one. The panel and the scroll viewport abut,
   * so `panel.bottom === header.top` exactly, and the header must own that
   * coordinate — otherwise one row of pixels aimed at the header groups the
   * column instead of reordering it.
   */
  describe("edge semantics", () => {
    it.each([
      { name: "left edge is inside", x: 0, y: 18, hit: true },
      { name: "one pixel left of it is not", x: -1, y: 18, hit: false },
      {
        name: "one pixel inside the right edge is inside",
        x: 299,
        y: 18,
        hit: true,
      },
      { name: "the right edge itself is not", x: 300, y: 18, hit: false },
      { name: "top edge is inside", x: 150, y: 0, hit: true },
      { name: "one pixel above it is not", x: 150, y: -1, hit: false },
      {
        name: "one pixel inside the bottom edge is inside",
        x: 150,
        y: 35,
        hit: true,
      },
      {
        name: "the bottom edge belongs to the header, not the panel",
        x: 150,
        y: 36,
        hit: false,
      },
    ])("$name", ({ x, y, hit }) => {
      const result = hitTestGroupPanel(panel, x, y);
      if (hit) {
        expect(result).not.toBeNull();
      } else {
        expect(result).toBeNull();
      }
    });

    it("the top-left corner is inside and the bottom-right corner is not", () => {
      expect(hitTestGroupPanel(panel, 0, 0)).not.toBeNull();
      expect(hitTestGroupPanel(panel, 300, 36)).toBeNull();
    });
  });

  it("excludes a zero-size panel rather than merely hiding it", () => {
    // A collapsed panel still occupies a point in the document. If it stayed a
    // live target it would silently swallow drops aimed at the header.
    const collapsed = stubElement({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    });

    expect(hitTestGroupPanel(collapsed, 0, 0)).toBeNull();
  });

  it("counts the chip midpoints the pointer has passed", () => {
    const chips = [
      { left: 0, right: 100, width: 100 },
      { left: 100, right: 200, width: 100 },
    ];
    const withChips = (x: number) =>
      hitTestGroupPanel(
        stubElement(
          { left: 0, top: 0, right: 300, bottom: 36, width: 300, height: 36 },
          chips,
        ),
        x,
        18,
      )?.insertIndex;

    expect(withChips(10)).toBe(0); // before chip 0's midpoint
    expect(withChips(60)).toBe(1); // past chip 0, before chip 1
    expect(withChips(160)).toBe(2); // past both — append
  });
});
