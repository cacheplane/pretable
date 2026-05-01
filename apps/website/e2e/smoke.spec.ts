import { expect, test } from "@playwright/test";

// Smoke asserts STRUCTURE, not COPY. Hero text and section names change
// often during marketing iteration; they shouldn't break a deploy. Locking
// down specific phrases ("first-class feature") wedged this on PR #38's
// landing rewrite even though the page rendered correctly. Assert the
// load-bearing elements: title, an h1 with real text, the #grid section,
// the live playground chrome, and a working /docs route.

test("landing page renders hero, playground, and resolves docs", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page).toHaveTitle("pretable");

  const h1 = page.locator("h1").first();
  await expect(h1).toBeVisible();
  expect((await h1.textContent())?.trim().length ?? 0).toBeGreaterThan(10);

  await expect(page.locator("#grid")).toBeVisible();
  await expect(page.locator('[data-testid="pitch-grid-chrome"]')).toBeVisible({
    timeout: 10_000,
  });

  const docsResponse = await page.goto("/docs", {
    waitUntil: "domcontentloaded",
  });
  expect(docsResponse?.status()).toBe(200);
});
