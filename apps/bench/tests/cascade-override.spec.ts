import { fileURLToPath } from "node:url";
import path from "node:path";
import { expect, test } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_SRC = path.resolve(__dirname, "../../../packages/ui/src");
const EXCEL_CSS = path.join(UI_SRC, "themes/excel.css");
const GRID_CSS = path.join(UI_SRC, "grid.css");

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
