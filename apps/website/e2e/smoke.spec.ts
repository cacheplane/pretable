import { expect, test } from "@playwright/test";

test("landing renders grid + control bar + drawer handle; drawer opens", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("pretable");

  await expect(page.locator("[data-pretable-scroll-viewport]")).toBeVisible({
    timeout: 10_000,
  });

  await expect(page.locator("[data-testid='drawer-handle']")).toBeVisible();

  // Click handle → drawer opens
  await page.locator("[data-testid='drawer-handle']").click();
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");
  await expect(page.getByText(/built in bend, or\./i)).toBeVisible();

  // /docs still resolves
  const docsResponse = await page.goto("/docs", {
    waitUntil: "domcontentloaded",
  });
  expect(docsResponse?.status()).toBe(200);
});

test("docs brand link returns to drawer when it was last open", async ({
  page,
}) => {
  await page.goto("/");
  // Open the drawer via the bottom handle.
  await page.getByTestId("drawer-handle").click();
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");

  // Navigate to /docs via the in-drawer /docs link.
  await page
    .getByRole("link", { name: /\/docs/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/docs/);

  // Click brand → should land back on / with drawer open.
  await page.getByRole("link", { name: /pretable\.ai/i }).click();
  await expect(page).toHaveURL(/\/#receipts$/);
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "open");
});

test("docs brand link goes to bare grid when drawer was never opened", async ({
  page,
}) => {
  await page.goto("/docs");
  await page.getByRole("link", { name: /pretable\.ai/i }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("html")).toHaveAttribute("data-drawer", "closed");
});

test("hero grid row-select checkbox column is visible and clickable", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-pretable-scroll-viewport]")).toBeVisible({
    timeout: 10_000,
  });

  // Header checkbox is rendered.
  const headerCheckbox = page.locator("[data-pretable-row-select-all]").first();
  await expect(headerCheckbox).toBeVisible();
  await expect(headerCheckbox).toHaveAttribute(
    "aria-checked",
    /true|false|mixed/,
  );

  // At least one body checkbox is rendered.
  const bodyCheckbox = page.locator("[data-pretable-row-select]").first();
  await expect(bodyCheckbox).toBeVisible();

  // Clicking it changes its aria-checked state.
  const initialState = await bodyCheckbox.getAttribute("aria-checked");
  await bodyCheckbox.click();
  await expect(bodyCheckbox).not.toHaveAttribute(
    "aria-checked",
    initialState ?? "false",
  );
});
