import { afterEach, describe, expect, test } from "vitest";

import { getDensityHeights } from "../density";

afterEach(() => {
  document.documentElement.removeAttribute("style");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-theme");
  document.head.querySelectorAll("style[data-test]").forEach((el) => {
    el.remove();
  });
  document.body.replaceChildren();
});

/**
 * A theme's density block, as the shipped themes actually write it: a bare
 * `[data-density="…"]` selector, matching wherever the attribute is set.
 *
 * jsdom resolves selector-matched custom properties AND inherits them, which is
 * what makes the scoping tests below non-vacuous — the values asserted are
 * produced by the cascade, not written onto the element being read. What jsdom
 * cannot do is lay anything out; the pixels are pinned in
 * `apps/website/e2e/density-scope.spec.ts`.
 */
function installTheme(css: string): void {
  const style = document.createElement("style");
  style.setAttribute("data-test", "");
  style.textContent = css;
  document.head.append(style);
}

describe("getDensityHeights", () => {
  test("returns fallback values when no CSS variables are set", () => {
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(32);
    expect(heights.headerHeight).toBe(36);
  });

  test("reads numeric pixel values from --pretable-row-height and --pretable-header-height", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "48px");
    document.documentElement.style.setProperty(
      "--pretable-header-height",
      "52px",
    );
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(48);
    expect(heights.headerHeight).toBe(52);
  });

  test("falls back when only one variable is set", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "22px");
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(22);
    expect(heights.headerHeight).toBe(36); // fallback
  });

  test("falls back when value is not a px-suffixed number", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "auto");
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(32); // fallback when value can't be parsed
  });

  test("parses fractional pixel values", () => {
    document.documentElement.style.setProperty(
      "--pretable-row-height",
      "23.5px",
    );
    const heights = getDensityHeights();
    expect(heights.rowHeight).toBe(23.5);
  });
});

/**
 * `data-density` scopes to a wrapper the way `data-theme` does.
 *
 * It did not before: this function read `document.documentElement`
 * unconditionally, so a grid inside `<div data-density="compact">` PAINTED
 * compact — the tokens inherit — while every number JavaScript read came from
 * the root. Paint and measurement disagreed.
 *
 * Every fixture here states BOTH densities, root and wrapper, at different
 * values. A fixture that set only one could be satisfied by reading either
 * element, which is the mistake that makes a scoping test vacuous.
 */
describe("getDensityHeights scoping", () => {
  function scopedFixture(): { wrapper: HTMLElement; inner: HTMLElement } {
    installTheme(`
      :root { --pretable-row-height: 56px; --pretable-header-height: 60px; }
      [data-density="compact"] {
        --pretable-row-height: 24px;
        --pretable-header-height: 28px;
      }
    `);
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-density", "compact");
    const inner = document.createElement("div");
    wrapper.append(inner);
    document.body.append(wrapper);
    return { wrapper, inner };
  }

  test("resolves a wrapper-scoped density from an element inside it", () => {
    const { inner } = scopedFixture();
    expect(getDensityHeights(inner)).toEqual({
      rowHeight: 24,
      headerHeight: 28,
    });
  });

  test("the same call with no element still answers for the root", () => {
    // The old behaviour, and the contract for a caller that has no element:
    // the wrapper exists and is compact, and this must not see it.
    scopedFixture();
    expect(getDensityHeights()).toEqual({ rowHeight: 56, headerHeight: 60 });
  });

  test("an element outside the wrapper resolves the root, not the wrapper", () => {
    // Scoping has to be positional, not global. If the wrapper's declaration
    // leaked to every element the fix would be indistinguishable from moving
    // the bug.
    scopedFixture();
    const outside = document.createElement("div");
    document.body.append(outside);
    expect(getDensityHeights(outside)).toEqual({
      rowHeight: 56,
      headerHeight: 60,
    });
  });

  test("a root-level density still resolves through an element", () => {
    // The path every existing consumer is on: the attribute is on <html>, and
    // passing a deep element must give the same answer it always did.
    installTheme(`
      [data-density="spacious"] {
        --pretable-row-height: 56px;
        --pretable-header-height: 60px;
      }
    `);
    document.documentElement.setAttribute("data-density", "spacious");
    const inner = document.createElement("div");
    document.body.append(inner);
    expect(getDensityHeights(inner)).toEqual({
      rowHeight: 56,
      headerHeight: 60,
    });
    expect(getDensityHeights()).toEqual({ rowHeight: 56, headerHeight: 60 });
  });

  test("a root-level token override still resolves through an element", () => {
    // The other half of the old contract: a raw `--pretable-row-height` written
    // on <html>, with no density attribute anywhere.
    document.documentElement.style.setProperty("--pretable-row-height", "18px");
    const inner = document.createElement("div");
    document.body.append(inner);
    expect(getDensityHeights(inner).rowHeight).toBe(18);
    expect(getDensityHeights().rowHeight).toBe(18);
  });

  test("null falls back to the root, and neither path throws off-document", () => {
    document.documentElement.style.setProperty("--pretable-row-height", "18px");
    expect(getDensityHeights(null).rowHeight).toBe(18);
    // A detached element resolves nothing in jsdom, as in a browser; the
    // fallbacks answer rather than NaN reaching the virtualizer.
    expect(getDensityHeights(document.createElement("div"))).toEqual({
      rowHeight: 32,
      headerHeight: 36,
    });
  });
});
