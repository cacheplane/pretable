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
  await page.addStyleTag({ path: EXCEL_CSS }); // unlayered tokens
  await page.addStyleTag({ path: GRID_CSS }); // layered grid rules (:where)

  const cell = page.locator("#c");
  // Sanity: the layered default applied a non-empty color from the theme.
  const defaultColor = await cell.evaluate((el) => getComputedStyle(el).color);
  expect(defaultColor).not.toBe("");

  // A bare unlayered consumer rule (specificity (0,1,0)) must win over the
  // layered, :where()-flattened (0,0,0) default purely via layer order.
  await page.addStyleTag({
    content: "[data-pretable-cell] { color: rgb(7, 8, 9); }",
  });
  await expect(cell).toHaveCSS("color", "rgb(7, 8, 9)");
});

test("selected background wins over zebra via source order", async ({
  page,
}) => {
  // Pin the relevant tokens to known rgb values inline, so the assertion is
  // format-deterministic. The selected cell sits in an EVEN row, so the zebra
  // rule also targets it — proving selected wins is the behavior we locked.
  await page.setContent(
    "<div data-pretable-scroll-viewport " +
      'style="--pretable-bg-grid-alt: rgb(50, 50, 50); --pretable-bg-selected: rgb(1, 2, 3)">' +
      "<div data-pretable-row></div>" + // row 1 (odd)
      "<div data-pretable-row>" + // row 2 (even → zebra applies)
      '<span data-pretable-cell data-selected="true" id="sel">x</span>' +
      "</div></div>",
  );
  await page.addStyleTag({ path: GRID_CSS });

  // Both zebra (rgb 50,50,50) and selected (rgb 1,2,3) match #sel; selected
  // must win because its rule comes later in source order at equal (0,0,0).
  await expect(page.locator("#sel")).toHaveCSS(
    "background-color",
    "rgb(1, 2, 3)",
  );
});
