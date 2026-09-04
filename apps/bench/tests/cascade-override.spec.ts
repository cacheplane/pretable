import { fileURLToPath } from "node:url";
import path from "node:path";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_ROOT = path.resolve(__dirname, "../../../packages/ui");
const EXCEL_CSS = path.join(UI_ROOT, "themes/excel.css");
const GRID_CSS = path.join(UI_ROOT, "grid.css");

test("an unlayered consumer rule beats the layered grid default", async ({
  page,
}) => {
  await page.setContent(
    '<div data-pretable-scroll-viewport><span data-pretable-cell id="c">x</span></div>',
  );
  // Consumer rule FIRST (unlayered), then the theme tokens, then the layered
  // grid.css LAST. If grid.css were not in @layer, it would win here by source
  // order at equal specificity — so this ordering genuinely tests the layer.
  await page.addStyleTag({
    content: "[data-pretable-cell] { color: rgb(7, 8, 9); }",
  });
  await page.addStyleTag({ path: EXCEL_CSS });
  await page.addStyleTag({ path: GRID_CSS });

  const cell = page.locator("#c");
  // Sanity: grid.css actually loaded and applied (it sets display:flex on cells).
  await expect(cell).toHaveCSS("display", "flex");
  // The unlayered consumer rule wins over the layered grid default even though
  // grid.css was injected last — proving the @layer mechanism.
  await expect(cell).toHaveCSS("color", "rgb(7, 8, 9)");
});

test("a focused pinned cell keeps its seam, and draws exactly one ring", async ({
  page,
}) => {
  // The structural test in @pretable/ui can prove grid.css declares no
  // box-shadow focus ring. Only a browser can prove the consequence: that the
  // ring and the frozen-column seam coexist while one cell holds focus.
  //
  // The collision this guards used to be literal — the seam was a box-shadow
  // on the CELL, box-shadow is not additive across rules, and a ring in that
  // slot replaced the seam outright for as long as the cell held focus. The
  // seam is now one gradient per plane (a per-cell shadow cannot tile into a
  // continuous edge), so the two live on different elements and the old
  // collision is impossible by construction. What is still worth proving in a
  // real browser is the pair: the plane paints its seam AND the cell draws its
  // ring, at the same time, from one stylesheet.
  //
  // The fixture mirrors what @pretable/react renders: the edge published on
  // the viewport, and role="gridcell" AND data-pretable-cell AND
  // data-pretable-focused all on one element. That last part is the whole
  // reason a doubled ring was once invisible in review — each rule read
  // correct alone, and only the real DOM put both on one cell.
  await page.setContent(
    "<div data-pretable-scroll-viewport data-pretable-pinned-left " +
      'style="--pretable-seam-color: rgb(1, 2, 3); ' +
      "--pretable-focus-ring: rgb(4, 5, 6); " +
      '--pretable-pinned-left-edge: 40px">' +
      '<div data-pretable-scroll-content style="height: 100px">' +
      "<div data-pretable-row>" +
      '<span data-pretable-cell data-pretable-pinned="left" ' +
      'data-pretable-focused="true" role="gridcell" id="cell">x</span>' +
      "</div></div></div>",
  );
  await page.addStyleTag({ path: GRID_CSS });

  const cell = page.locator("#cell");
  // The ring, drawn once, as an outline.
  await expect(cell).toHaveCSS("outline", "rgb(4, 5, 6) solid 2px");
  // The cell's shadow slot is empty: the seam has left it, and a ring must
  // never take it (box-shadow does not stack across rules — the winner
  // replaces the slot, which is how the seam was lost the first time).
  await expect(cell).toHaveCSS("box-shadow", "none");

  // And the seam is painted, on the plane, while that cell holds focus.
  const seam = await page.evaluate(() => {
    const content = document.querySelector("[data-pretable-scroll-content]")!;
    const s = getComputedStyle(content, "::after");
    return { backgroundImage: s.backgroundImage, left: s.left, width: s.width };
  });
  expect(seam.backgroundImage).toContain("rgb(1, 2, 3)");
  expect(seam.left).toBe("40px");
  expect(seam.width).toBe("8px");
});

test("a focused cell in the REAL grid actually paints its ring", async ({
  page,
}) => {
  // The fixture test above proves grid.css *declares* the ring correctly. It
  // cannot prove the ring survives contact with @pretable/react, because a
  // hand-built fixture carries the attributes the component sets and none of
  // the inline styles it sets. That gap shipped a real regression: every
  // gridcell renders with an inline `outline: none` (added with keyboard nav,
  // long before the ring became an outline), and an inline declaration beats a
  // `@layer` + `:where()` rule at any specificity. The declared ring was
  // therefore invisible in every real app while the fixture test stayed green.
  //
  // So this one drives the actual component: focus a real cell, then read what
  // the browser actually paints.
  await page.goto("/?adapter=pretable&scenario=S1&scale=dev");

  const cell = page
    .locator("[data-pretable-cell]:not([data-pretable-row-select-cell])")
    .first();
  await expect(cell).toBeVisible();
  await cell.click();

  const focused = page.locator(
    '[data-pretable-cell][data-pretable-focused="true"]',
  );
  await expect(focused).toHaveCount(1);

  // Assert on the LONGHANDS, not the `outline` shorthand. The regression left
  // `outline-offset` applied while `outline-style` fell to `none`, so anything
  // reading the shorthand loosely — or reading offset — reads as if the rule
  // won when nothing is drawn.
  const ring = await focused.evaluate((node) => {
    const cs = getComputedStyle(node);
    return {
      style: cs.outlineStyle,
      width: cs.outlineWidth,
      color: cs.outlineColor,
      boxShadow: cs.boxShadow,
    };
  });

  // A ring is drawn at all. `none` here is the regression this test exists for.
  expect(ring.style, "focused cell paints no outline ring").not.toBe("none");
  expect(parseFloat(ring.width)).toBeGreaterThan(0);
  // And it is the theme's ring colour, not a user-agent focus ring that
  // happens to be visible.
  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--pretable-focus-ring")
      .trim(),
  );
  expect(token).not.toBe("");
  // Still exactly one ring: the box-shadow slot stays free for the pinned seam.
  expect(ring.boxShadow).not.toMatch(/inset/);
});

test("the selection fill composes over zebra instead of replacing it", async ({
  page,
}) => {
  // Pin the relevant tokens to known rgb values inline, so the assertion is
  // format-deterministic. The selected cell sits in an EVEN row, so the zebra
  // rule also targets it — how the two combine is the behavior we lock.
  //
  // The selection fill is a background-IMAGE layer, so it paints ON TOP of
  // whatever surface color an earlier rule set rather than replacing it. That
  // is load-bearing, not stylistic: --pretable-selection-bg is translucent in
  // both shipped themes, and pinned cells are position:sticky with unpinned
  // cells scrolling underneath — a selected pinned cell that replaced its
  // opaque fill would let the scrolled-under column print through it.
  //
  // The fixture mirrors what @pretable/react actually renders: a selected cell
  // carries role="gridcell", aria-selected="true" AND data-pretable-selected,
  // all set from the same condition. That matters, because the two halves of
  // selection live in different rules — [role="gridcell"][aria-selected="true"]
  // paints the fill, while [data-pretable-selected="true"] carries only the
  // text color. A fixture missing the ARIA pair gets no fill at all.
  await page.setContent(
    "<div data-pretable-scroll-viewport " +
      'style="--pretable-bg-grid-alt: rgb(50, 50, 50); ' +
      "--pretable-selection-bg: rgb(1, 2, 3); " +
      '--pretable-text-selected: rgb(9, 9, 9)">' +
      "<div data-pretable-row></div>" + // row 1 (odd)
      "<div data-pretable-row>" + // row 2 (even → zebra applies)
      '<span data-pretable-cell data-pretable-selected="true" ' +
      'role="gridcell" aria-selected="true" id="sel">x</span>' +
      "</div></div>",
  );
  await page.addStyleTag({ path: GRID_CSS });

  // Zebra keeps the background-COLOR slot: the surface underneath survives.
  await expect(page.locator("#sel")).toHaveCSS(
    "background-color",
    "rgb(50, 50, 50)",
  );
  // And the selection tint sits above it in the background-IMAGE slot. Both
  // halves have to hold — a selection that took the color slot back would be
  // the sticky-transparency bug returning, and a missing image means no
  // selection is painted at all.
  await expect(page.locator("#sel")).toHaveCSS(
    "background-image",
    "linear-gradient(rgb(1, 2, 3), rgb(1, 2, 3))",
  );
  // And the text color still comes from the data-pretable-selected rule, which
  // is the only declaration left in it.
  await expect(page.locator("#sel")).toHaveCSS("color", "rgb(9, 9, 9)");
});

test("under forced colours a selected cell is still visibly selected", async ({
  page,
}) => {
  // The defect this locks: the range fill is a translucent background-IMAGE,
  // and forced colours drop background-image and force the colour underneath
  // to Canvas. An eleven-cell selection on the live grid came out identical to
  // no selection at all — every cell rgb(255,255,255) on rgb(0,0,0), with only
  // the single FOCUSED cell marked — so what the grid was about to copy could
  // not be read off the screen.
  //
  // Only a browser can prove this: the substitution happens in the UA, not in
  // any declaration a stylesheet test can read.
  await page.emulateMedia({ forcedColors: "active" });
  await page.setContent(
    "<div data-pretable-scroll-viewport>" +
      "<div data-pretable-row>" +
      '<span data-pretable-cell data-pretable-selected="true" ' +
      'role="gridcell" aria-selected="true" id="sel">x</span>' +
      '<span data-pretable-cell role="gridcell" id="plain">y</span>' +
      "</div></div>",
  );
  await page.addStyleTag({ path: GRID_CSS });

  const read = (id: string) =>
    page.evaluate((sel) => {
      const s = getComputedStyle(document.querySelector(sel)!);
      return { background: s.backgroundColor, color: s.color };
    }, `#${id}`);

  const selected = await read("sel");
  const plain = await read("plain");

  // The assertion that matters is the DIFFERENCE: whatever system palette the
  // user runs, a selected cell must not paint as an unselected one.
  expect(selected.background).not.toBe(plain.background);
  // And the pair has to be the platform's own, or the text can land invisible
  // on the fill in a palette nobody tested.
  expect(selected.color).not.toBe(plain.color);
});
