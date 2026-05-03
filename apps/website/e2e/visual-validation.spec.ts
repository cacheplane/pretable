import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "iphone-se", width: 320, height: 568 },
  { name: "iphone-14", width: 390, height: 844 },
  { name: "ipad-portrait", width: 768, height: 1024 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "desktop", width: 1920, height: 1080 },
] as const;

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
    await expect(
      page.locator("[data-pretable-scroll-viewport]"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("[data-testid='drawer-handle']")).toBeVisible();

    // Top control bar visible
    await expect(page.locator("[role='toolbar']")).toBeVisible();

    // Wait 3 seconds to let the rAF loop run
    await page.waitForTimeout(3_000);

    // Capture cold-load screenshot
    await page.screenshot({
      path: testInfo.outputPath(`cold-${vp.name}.png`),
      fullPage: false,
    });

    // Open drawer
    await page.locator("[data-testid='drawer-handle']").click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-drawer",
      "open",
      { timeout: 2_000 },
    );

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
