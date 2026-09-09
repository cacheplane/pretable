import { expect, test, type Page } from "@playwright/test";

const grid = (page: Page) =>
  page.getByRole("grid", {
    name: "Inventory with custom editors",
    exact: true,
  });
const cell = (page: Page, column: string) =>
  grid(page).locator(
    `[data-pretable-row-id="notebook"] [data-pretable-column-id="${column}"]`,
  );
const field = (page: Page) => grid(page).locator(".pretable-cell-editor");

async function edit(page: Page, column: string) {
  await cell(page, column).click();
  await page.keyboard.press("F2");
  await expect(field(page)).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/docs/grid/components");
  // Previews mount when their figure enters the viewport.
  await page
    .locator("figure")
    .filter({
      has: page
        .getByRole("link", { name: ".md", exact: true })
        .and(page.locator('[href="/examples/components-editors.md"]')),
    })
    .scrollIntoViewIfNeeded();
  await grid(page).scrollIntoViewIfNeeded();
  await expect(grid(page)).toHaveAttribute("data-pretable-hydrated", "true");
});

test("custom editor controls retain focus, steppers, saving errors and corrected retry", async ({
  page,
}) => {
  await edit(page, "quantity");
  await expect(field(page)).toHaveClass(/app-editor-input/);
  const increment = grid(page).getByRole("button", {
    name: "Increment",
    exact: true,
  });
  await expect(increment).toHaveClass(/app-editor-icon-button/);
  await increment.click();
  await expect(field(page)).toHaveValue("5");
  await expect(field(page)).toBeFocused();
  await field(page).fill("-1");
  await field(page).press("Enter");
  await expect(field(page)).toHaveAttribute("aria-busy", "true");
  await expect(field(page)).toHaveAttribute("aria-invalid", "true");
  await expect(
    grid(page).locator("[data-pretable-edit-error]"),
  ).toHaveAttribute("title", "Quantity must be zero or greater");
  await expect(field(page)).toHaveValue("-1");
  await field(page).fill("7");
  await field(page).press("Enter");
  await expect(field(page)).toHaveCount(0);
  await expect(cell(page, "quantity")).toHaveText("7");
});

test("replacement input cancels and textarea preserves multiline editing", async ({
  page,
}) => {
  await edit(page, "name");
  await field(page).fill("Unsaved name");
  await field(page).press("Escape");
  await expect(cell(page, "name")).toHaveText("Notebook");
  await edit(page, "notes");
  await expect(field(page)).toHaveClass(/app-editor-textarea/);
  await field(page).fill("First line");
  await field(page).press("End");
  await field(page).press("Enter");
  await page.keyboard.type("Second line");
  await expect(field(page)).toHaveValue("First line\nSecond line");
  await field(page).press("Control+Enter");
  await expect(field(page)).toHaveCount(0);
  await edit(page, "notes");
  await expect(field(page)).toHaveValue("First line\nSecond line");
});
