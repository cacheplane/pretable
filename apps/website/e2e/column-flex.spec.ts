import { expect, test } from "@playwright/test";

import { scrollViewportTo, waitForGridReady } from "./helpers";

/**
 * The "Fill the viewport" section claims a row with flex columns ends exactly
 * on the viewport edge. That is a pixel claim, so it is asserted on the drawn
 * header cells of the real example at two page widths.
 *
 * Demos mount lazily when their figure scrolls into view, so the figure is
 * scrolled to before waiting on the grid — otherwise it never appears.
 *
 * Why this is a browser test and not a jsdom one: jsdom lays nothing out, so
 * every `getBoundingClientRect().width` is 0 and the sum is vacuously wrong —
 * it could never distinguish a row that ends on the edge from one that does
 * not. The jsdom half — that `distributeFlexWidths` hands the drawn columns the
 * right numbers — is `packages/react/src/__tests__/flex-columns.test.tsx`.
 */

const PAGE = "/docs/grid/column-layout";
const SCOPE = '[data-example-id="column-flex"]';

for (const width of [1280, 900]) {
  test(`flex columns end on the viewport edge at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await page.locator(SCOPE).scrollIntoViewIfNeeded();
    await waitForGridReady(page, SCOPE);
    const viewport = page
      .locator(`${SCOPE} [data-pretable-scroll-viewport]`)
      .first();
    const clientWidth = await viewport.evaluate((el) => el.clientWidth);
    const cells = viewport.locator("[data-pretable-header-cell]");
    // All four columns fit in the drawn header at both widths (no
    // virtualization clipping, no row-select cell, no pinned columns), so the
    // sum of the drawn cells is the full row.
    await expect(cells).toHaveCount(4);
    const widths = await cells.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    const total = widths.reduce((a, b) => a + b, 0);
    // Within a pixel, not exact: a fractional device pixel ratio rounds the
    // drawn width.
    expect(Math.abs(total - clientWidth)).toBeLessThanOrEqual(1);
  });
}

/**
 * The hero's AI Analyst column flexes with `minWidthPx: 320`. At phone width
 * the fixed columns alone exceed the viewport, so there is nothing to share;
 * the floor must still hold there rather than the column falling back to the
 * default wrapped width. The column sits far to the right, so the scrollport
 * is scrolled to its end first — the header row is column-virtualized and the
 * cell may not be drawn at scrollLeft 0.
 */
test("hero analyst column keeps its 320px floor at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForGridReady(page);
  const viewport = page.locator("[data-pretable-scroll-viewport]").first();
  await scrollViewportTo(viewport, "end");
  const analyst = viewport.locator(
    '[data-pretable-header-cell][data-pretable-column-id="analyst"]',
  );
  await expect(analyst).toHaveCount(1);
  const width = await analyst.evaluate(
    (el) => el.getBoundingClientRect().width,
  );
  // Within a pixel, not exact: a fractional device pixel ratio rounds the
  // drawn width.
  expect(width).toBeGreaterThanOrEqual(320 - 1);
});
