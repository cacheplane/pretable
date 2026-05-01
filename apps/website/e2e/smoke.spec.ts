import { expect, test } from "@playwright/test";

test("landing page renders hero, playground, and resolves docs", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("pretable");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /fastest data grid for react/i,
    }),
  ).toBeVisible();
  await expect(page.locator("#grid")).toBeVisible();
  await expect(page.locator('[data-testid="pitch-grid-chrome"]')).toBeVisible({
    timeout: 10_000,
  });

  const docsResponse = await page.goto("/docs", {
    waitUntil: "domcontentloaded",
  });
  expect(docsResponse?.status()).toBe(200);
});
