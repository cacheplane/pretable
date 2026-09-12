import { expect, test, type Locator, type Page } from "@playwright/test";

async function openInventory(page: Page) {
  await page.goto("/docs/grid/paste", { waitUntil: "domcontentloaded" });
  const example = page
    .locator("figure")
    .filter({ has: page.locator('a[href="/examples/paste-validation.md"]') });
  await example.scrollIntoViewIfNeeded();
  await expect(
    example.locator("[data-pretable-hydrated]").first(),
  ).toHaveAttribute("data-pretable-hydrated", "true", { timeout: 20_000 });
  return example;
}

async function pasteSample(page: Page, example: Locator, browserName: string) {
  const sample = await example
    .getByRole("textbox", { name: "Quantities to paste" })
    .inputValue();
  await example
    .locator(
      '[data-pretable-row-id="item-1"] [data-pretable-cell][data-pretable-column-id="quantity"]',
    )
    .click();
  if (browserName === "chromium") {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.evaluate(
      async (text) => navigator.clipboard.writeText(text),
      sample,
    );
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+v" : "Control+v",
    );
  } else {
    // WebKit has no Playwright clipboard permission: exercise its real paste
    // listener and validation pipeline with clipboard data on a DOM event.
    await page.evaluate((text) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: () => text },
      });
      document.activeElement!.dispatchEvent(event);
    }, sample);
  }
}

test("mixed paste applies valid quantities, preserves rejected rows, and supports correction and reset", async ({
  page,
  browserName,
}) => {
  const example = await openInventory(page);
  const quantities = example.locator(
    '[data-pretable-cell][data-pretable-column-id="quantity"]',
  );
  const status = example.getByRole("status", { name: "Paste result" });
  await expect(quantities).toHaveText(["10", "20", "30"]);
  await pasteSample(page, example, browserName);
  await expect(status).toHaveText("1 accepted · 2 rejected.");
  await expect(quantities).toHaveText(["24", "20", "30"]);
  const rejected = example.getByRole("list", { name: "Rejected quantities" });
  await expect(rejected).toContainText("Pens");
  await expect(rejected).toContainText("Quantity must be zero or greater");
  await expect(rejected).toContainText("Folders");
  await expect(rejected).toContainText("Not a number");
  await example.getByRole("button", { name: "Use corrected values" }).click();
  // Choosing a sample never applies it; the user must still paste into the grid.
  await expect(quantities).toHaveText(["24", "20", "30"]);
  await pasteSample(page, example, browserName);
  await expect(status).toHaveText("3 accepted · 0 rejected.");
  await expect(quantities).toHaveText(["24", "25", "30"]);
  await expect(rejected).toHaveCount(0);
  await example.getByRole("button", { name: "Reset example" }).click();
  await expect(quantities).toHaveText(["10", "20", "30"]);
  await expect(status).toHaveText("No paste yet.");
  await expect(
    example.getByRole("textbox", { name: "Quantities to paste" }),
  ).toHaveValue("24\n-5\nabc");
});

test("paste validation source is complete and rejection feedback fits mobile", async ({
  page,
  request,
  browserName,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const example = await openInventory(page);
  await pasteSample(page, example, browserName);
  await expect(
    example.getByRole("status", { name: "Paste result" }),
  ).toHaveText("1 accepted · 2 rejected.");
  await expect(
    example.getByRole("list", { name: "Rejected quantities" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const feedbackBox = await example
    .getByRole("list", { name: "Rejected quantities" })
    .boundingBox();
  const exampleBox = await example.boundingBox();
  expect(feedbackBox).not.toBeNull();
  expect(exampleBox).not.toBeNull();
  expect(feedbackBox!.y + feedbackBox!.height).toBeLessThanOrEqual(
    exampleBox!.y + exampleBox!.height,
  );
  const response = await request.get("/examples/paste-validation.md");
  expect(response.ok()).toBe(true);
  const source = await response.text();
  expect(source).toContain("onPaste=");
  expect(source).toContain("Quantity must be zero or greater");
});
