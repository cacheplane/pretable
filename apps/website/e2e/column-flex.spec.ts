import { expect, test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The "Fill the viewport" section claims a row with flex columns ends exactly
 * on the viewport edge. That is a pixel claim, so it is asserted on the drawn
 * header cells of the real example at two page widths.
 *
 * Demos mount lazily when their figure scrolls into view, so the figure is
 * scrolled to before waiting on the grid — otherwise it never appears.
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
    expect(Math.abs(total - clientWidth)).toBeLessThanOrEqual(1);
  });
}
