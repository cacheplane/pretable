import { expect, test } from "@playwright/test";

test("docs page renders sidebar with active state", async ({ page }) => {
  await page.goto("/docs/grid/pretable-component", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Pretable",
  );
  // Sidebar nav scopes the aria-current locator so we don't pick up other
  // page elements (e.g. the mobile drawer also rendering a current link).
  const active = page.locator(
    'nav[aria-label="Docs sections"] a[aria-current="page"]',
  );
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute("href", "/docs/grid/pretable-component");
});

test("Copy as Markdown button is visible", async ({ page }) => {
  await page.goto("/docs/grid/pretable-component", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: /copy as markdown/i }),
  ).toBeVisible();
});

test("Cmd+K opens search palette and focuses input", async ({ page }) => {
  await page.goto("/docs", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("combobox")).toBeFocused();
});

test("/docs/<slug>.md returns markdown content", async ({ request }) => {
  const r = await request.get("/docs/grid/pretable-component.md");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toMatch(/text\/markdown/);
  expect(await r.text()).toMatch(/^# /);
});

test("/llms.txt and /llms-full.txt return content", async ({ request }) => {
  const a = await request.get("/llms.txt");
  expect(a.status()).toBe(200);
  expect(await a.text()).toMatch(/^# Pretable Docs/);
  const b = await request.get("/llms-full.txt");
  expect(b.status()).toBe(200);
  expect((await b.text()).length).toBeGreaterThan(500);
});

test("HTTP Link rel=llms-txt header on /docs/*", async ({ request }) => {
  const r = await request.get("/docs/grid", { maxRedirects: 0 });
  const link = r.headers()["link"] ?? "";
  expect(link).toMatch(/<\/llms\.txt>;\s*rel="llms-txt"/);
});

test("mobile menu drawer opens on small viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/docs", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /menu/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
