import { expect, test, type Page } from "@playwright/test";

import { openDrawer, waitForGridReady } from "./helpers";

const VIEWPORTS = [
  { name: "iphone-se", width: 320, height: 568 },
  { name: "iphone-14", width: 390, height: 844 },
  { name: "ipad-portrait", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

/**
 * The hero legend is the homepage's only statement of what the grid can do —
 * editing, selection, clipboard, filtering, grouping. Assert its box is inside
 * the bezel's, at every viewport.
 *
 * `toBeVisible()` cannot stand in for this. The bezel is `overflow: hidden`, so
 * a legend laid out past its bottom edge is still attached, still non-empty and
 * still has a non-zero box — Playwright calls that visible while a human sees
 * nothing. The strip shipped that way and stayed that way for two months: at
 * 1280x800 it sat at y=691..716 under a bezel ending at y=692, because
 * `viewportHeight` was measured off the element that has to hold BOTH the grid
 * and the legend, so the grid was handed the whole height and the legend was
 * pushed out of frame. Every one of the five viewports below was clipped.
 */
async function expectLegendInsideBezel(page: Page, where: string) {
  await waitForGridReady(page);
  const bezel = await page.getByTestId("hero-bezel").boundingBox();
  const legend = await page.getByTestId("hero-legend").boundingBox();
  if (!bezel) throw new Error(`${where}: hero bezel has no box`);
  if (!legend) throw new Error(`${where}: hero legend has no box`);
  const detail =
    `${where}: legend ${JSON.stringify(legend)} ` +
    `vs bezel ${JSON.stringify(bezel)}`;
  expect(legend.height, detail).toBeGreaterThan(0);
  expect(legend.y, detail).toBeGreaterThanOrEqual(bezel.y);
  // Half a pixel of slop: fractional device pixel ratios round the two boxes
  // independently, and the legend is meant to end flush against the bezel's
  // inner edge.
  expect(legend.y + legend.height, detail).toBeLessThanOrEqual(
    bezel.y + bezel.height + 0.5,
  );
  expect(legend.x, detail).toBeGreaterThanOrEqual(bezel.x - 0.5);
  expect(legend.x + legend.width, detail).toBeLessThanOrEqual(
    bezel.x + bezel.width + 0.5,
  );
  // In frame is not the same as on top. On a short viewport the grid is held at
  // FALLBACK_VIEWPORT_HEIGHT and overflows the pane above; the pane clips it,
  // but a box test alone would not notice if it painted over the strip instead.
  const topmost = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return "missing";
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + 4, r.top + r.height / 2);
    return hit?.closest(sel) ? "legend" : (hit?.tagName ?? "none");
  }, '[data-testid="hero-legend"]');
  expect(topmost, `${detail} — covered by ${topmost}`).toBe("legend");
}

async function captureConsoleErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  return errors;
}

for (const vp of VIEWPORTS) {
  test(`${vp.name} (${vp.width}x${vp.height}): cold load + drawer open`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const errors = await captureConsoleErrors(page);

    await page.goto("/", { waitUntil: "domcontentloaded" });

    // Cold-load assertions
    await expect(page.locator("[data-pretable-scroll-viewport]")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("[data-testid='drawer-handle']")).toBeVisible();

    // Top control bar visible
    await expect(page.locator("[role='toolbar']")).toBeVisible();

    // Wait 3 seconds to let the rAF loop run
    await page.waitForTimeout(3_000);

    // The affordance legend is actually in frame, not clipped by the bezel.
    await expectLegendInsideBezel(page, vp.name);

    // Capture cold-load screenshot
    await page.screenshot({
      path: testInfo.outputPath(`cold-${vp.name}.png`),
      fullPage: false,
    });

    // Open drawer
    await openDrawer(page);

    // Wait for slide animation
    await page.waitForTimeout(500);

    // Drawer assertions
    await expect(page.getByText(/built in bend, or\./i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /show the grid/i }),
    ).toBeVisible();

    // Capture open-drawer screenshot
    await page.screenshot({
      path: testInfo.outputPath(`drawer-open-${vp.name}.png`),
      fullPage: false,
    });

    // Close drawer via "Show the grid" button
    await page.getByRole("button", { name: /show the grid/i }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-drawer",
      "closed",
      { timeout: 2_000 },
    );

    // Final error check
    expect(
      errors,
      `Console errors at ${vp.name}:\n${errors.join("\n")}`,
    ).toEqual([]);
  });
}

test("docs route resolves with NavBar", async ({ page }) => {
  const errors = await captureConsoleErrors(page);
  const response = await page.goto("/docs", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("link", { name: /pretable\.ai/i })).toBeVisible();
  expect(errors).toEqual([]);
});
