import { expect, test, type Page } from "@playwright/test";

import { waitForGridReady } from "./helpers";

async function openEditingExample(page: Page) {
  await page.goto("/docs/grid/editing", { waitUntil: "domcontentloaded" });
  const example = page.locator("figure").first();
  await example.scrollIntoViewIfNeeded();
  await waitForGridReady(page, "figure:first-of-type");
  return example;
}

// The factory and surface unit tests count callback admission under deferred
// promises. These exercise the remaining real-browser boundary: native field
// keys, error recovery, and controlled rows reconciling a completed save.
test("a rejected save can be corrected and committed through controlled rows", async ({
  page,
}) => {
  const example = await openEditingExample(page);
  const cell = example.locator(
    '[data-pretable-row-id="s1"] [data-pretable-column-id="quantity"]',
  );
  await cell.click();
  await page.keyboard.press("F2");
  const editor = example.getByRole("textbox", {
    name: "Quantity",
    exact: true,
  });
  await expect(editor).toBeFocused();
  await editor.fill("-1");
  await editor.press("Enter");
  await expect(example.locator("[data-pretable-edit-error]")).toHaveText(
    "Quantity can't go negative",
  );
  await expect(editor).toHaveValue("-1");
  await expect(editor).toBeEditable();

  await editor.fill("25");
  await editor.press("Enter");
  await expect(editor).toHaveCount(0);
  await expect(cell).toHaveText("25");
  await expect(example.locator("[data-pretable-edit-error]")).toHaveCount(0);
});

test("a boolean keyboard toggle survives asynchronous save and rows reconciliation", async ({
  page,
}) => {
  const example = await openEditingExample(page);
  const checkbox = example
    .locator('[data-pretable-row-id="s1"] [data-pretable-column-id="inStock"]')
    .getByRole("checkbox");
  await expect(checkbox).toBeChecked();
  await checkbox.focus();
  await checkbox.press("Space");
  await expect(checkbox).not.toBeChecked();
  await expect(checkbox).toBeEnabled();
  await expect(example.locator("[data-pretable-edit-status]")).toHaveCount(0);
});
