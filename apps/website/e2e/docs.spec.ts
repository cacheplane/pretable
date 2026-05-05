import { expect, test } from "@playwright/test";

test("docs page renders sidebar, content, TOC", async ({ page }) => {
  await page.goto("/docs/grid/pretable-component");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Pretable",
  );
  await expect(
    page.getByRole("link", { name: /Pretable.*component/ }).first(),
  ).toHaveAttribute("aria-current", "page");
});

test("Copy as Markdown button is present", async ({ page }) => {
  await page.goto("/docs/grid/pretable-component");
  await expect(
    page.getByRole("button", { name: /copy as markdown/i }),
  ).toBeVisible();
});

test("Cmd+K opens search palette", async ({ page }) => {
  await page.goto("/docs");
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("/docs/<slug>.md returns markdown", async ({ request }) => {
  const r = await request.get("/docs/grid/pretable-component.md");
  expect(r.headers()["content-type"]).toMatch(/text\/markdown/);
  expect(await r.text()).toMatch(/^# /);
});

test("/llms.txt returns index", async ({ request }) => {
  const r = await request.get("/llms.txt");
  expect(r.status()).toBe(200);
  expect(await r.text()).toMatch(/^# Pretable Docs/);
});

test("/llms-full.txt returns full corpus", async ({ request }) => {
  const r = await request.get("/llms-full.txt");
  expect(r.status()).toBe(200);
  expect(await r.text()).toMatch(/# /);
});

test("mobile drawer toggles", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/docs");
  await page.getByRole("button", { name: /menu/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("Link rel=llms-txt header on /docs/*", async ({ request }) => {
  const r = await request.get("/docs", { maxRedirects: 0 });
  const link = r.headers()["link"];
  expect(link ?? "").toMatch(/<\/llms\.txt>;\s*rel="llms-txt"/);
});
