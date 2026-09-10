import { expect, test, type Page } from "@playwright/test";

async function actionExample(page: Page, id: string) {
  await page.goto("/docs/grid/components", { waitUntil: "domcontentloaded" });
  const figure = page.locator("figure").filter({
    has: page.locator(`a[href="/examples/${id}.md"]`),
  });
  await figure.scrollIntoViewIfNeeded();
  await figure.getByRole("tab", { name: "Preview", exact: true }).click();
  await figure
    .getByRole("tabpanel", { name: "Preview", exact: true })
    .scrollIntoViewIfNeeded();
  return figure;
}

test("Button applies and resets a saved view with disabled action states", async ({
  page,
}) => {
  const figure = await actionExample(page, "kit-button");
  const apply = figure.getByRole("button", { name: "Apply saved view" });
  const reset = figure.getByRole("button", { name: "Reset view", exact: true });
  const status = figure.getByRole("status");

  await expect(apply).toBeEnabled();
  await expect(reset).toBeDisabled();
  await expect(status).toHaveText("Current view: All orders");
  await expect(apply).toHaveAttribute("data-pretable-variant", "ghost");
  await expect(reset).toHaveAttribute("data-pretable-variant", "link");

  await apply.click();
  await expect(status).toHaveText("Current view: Open orders");
  await expect(apply).toBeDisabled();
  await expect(reset).toBeEnabled();

  await reset.focus();
  await page.keyboard.press("Enter");
  await expect(status).toHaveText("Current view: All orders");
  await expect(apply).toBeEnabled();
  await expect(reset).toBeDisabled();
});

test("IconButton toggles its pressed state with mouse, Enter, and Space", async ({
  page,
}) => {
  const figure = await actionExample(page, "kit-icon-button");
  const pin = figure.getByRole("button", { name: "Pin view", exact: true });
  const status = figure.getByRole("status");

  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await expect(pin.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(status).toHaveText("View is not pinned.");
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(status).toHaveText("View pinned to quick access.");

  await pin.focus();
  await page.keyboard.press("Enter");
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await expect(status).toHaveText("View is not pinned.");
  await page.keyboard.press("Space");
  await expect(pin).toHaveAttribute("aria-pressed", "true");
  await expect(pin).toHaveAccessibleName("Pin view");
  await expect(status).toHaveText("View pinned to quick access.");
});
