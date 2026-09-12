import { expect, test, type Page } from "@playwright/test";

async function openOrders(page: Page) {
  await page.goto("/docs/grid/selection", { waitUntil: "domcontentloaded" });
  const example = page.locator("figure").filter({
    has: page.locator('a[href="/examples/controlled-row-selection.md"]'),
  });
  await example.scrollIntoViewIfNeeded();
  await expect(
    example.locator("[data-pretable-hydrated]").first(),
  ).toHaveAttribute("data-pretable-hydrated", "true", { timeout: 20_000 });
  return example;
}

test("controlled order selection supports individual choices, symbolic all, exclusions, and clearing", async ({
  page,
}) => {
  const example = await openOrders(page);
  const boxes = example.locator("[data-pretable-row-select]");
  const all = example.locator("[data-pretable-row-select-all]");
  const status = example.getByRole("status", { name: "Order selection" });
  await expect(status).toContainText("0 of 3");
  await expect(
    example.getByRole("button", { name: "Mark shipped" }),
  ).toBeDisabled();
  await boxes.nth(0).click();
  await expect(status).toContainText("1 of 3");
  await expect(all).toHaveAttribute("aria-checked", "mixed");
  await example.getByRole("button", { name: "Select all orders" }).click();
  await expect(status).toContainText("3 of 3");
  for (const box of await boxes.all()) await expect(box).toBeChecked();
  await boxes.nth(1).click();
  await expect(status).toContainText("2 of 3");
  await expect(boxes.nth(1)).not.toBeChecked();
  await example.getByRole("button", { name: "Clear selection" }).click();
  await expect(status).toContainText("0 of 3");
  for (const box of await boxes.all()) await expect(box).not.toBeChecked();
  await all.click();
  await expect(status).toContainText("3 of 3");
  await all.click();
  await expect(status).toContainText("0 of 3");
});

test("bulk shipping updates only selected orders and clears the controlled selection", async ({
  page,
}) => {
  const example = await openOrders(page);
  const boxes = example.locator("[data-pretable-row-select]");
  const statuses = example.locator(
    '[data-pretable-cell][data-pretable-column-id="status"]',
  );
  await example.getByRole("button", { name: "Select all orders" }).click();
  await boxes.nth(1).click();
  await example.getByRole("button", { name: "Mark shipped" }).click();
  await expect(statuses).toHaveText(["Shipped", "Open", "Shipped"]);
  await expect(
    example.getByRole("status", { name: "Order selection" }),
  ).toContainText("0 of 3");
  await expect(
    example.getByRole("button", { name: "Mark shipped" }),
  ).toBeDisabled();
  await boxes.nth(1).click();
  await example.getByRole("button", { name: "Mark shipped" }).click();
  await expect(statuses).toHaveText(["Shipped", "Shipped", "Shipped"]);
});

test("controlled selection source is available and controls fit a mobile page", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const example = await openOrders(page);
  await expect(
    example.getByRole("button", { name: "Select all orders" }),
  ).toBeVisible();
  await example.getByRole("button", { name: "Select all orders" }).click();
  await expect(
    example.getByRole("status", { name: "Order selection" }),
  ).toContainText("3 of 3");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const statusCell = example
    .locator('[data-pretable-cell][data-pretable-column-id="status"]')
    .first();
  const cellBox = await statusCell.boundingBox();
  expect(cellBox).not.toBeNull();
  expect(cellBox!.x + cellBox!.width).toBeLessThanOrEqual(390);
  const response = await request.get("/examples/controlled-row-selection.md");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("describeRowSelection");
});
