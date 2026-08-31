import { expect, test } from "@playwright/test";

import { openDocsMenu, openDocsSearch } from "./helpers";

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

test("number formatting page renders its active nav entry", async ({
  page,
}) => {
  await page.goto("/docs/grid/number-formatting", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Number formatting",
  );
  const active = page.locator(
    'nav[aria-label="Docs sections"] a[aria-current="page"]',
  );
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute("href", "/docs/grid/number-formatting");
});

test("date formatting page renders the canonical public contract", async ({
  page,
}) => {
  await page.goto("/docs/grid/date-formatting", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Date formatting",
  );
  await expect(
    page.getByText("YYYY-MM-DD | null", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("PretableDateFormatOptions", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("isValidDateValue", { exact: true }).first(),
  ).toBeVisible();
  const active = page.locator(
    'nav[aria-label="Docs sections"] a[aria-current="page"]',
  );
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute("href", "/docs/grid/date-formatting");
});

test("row grouping page renders its nav entry and live example", async ({
  page,
}) => {
  await page.goto("/docs/grid/grouping", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Row grouping",
  );
  const active = page.locator(
    'nav[aria-label="Docs sections"] a[aria-current="page"]',
  );
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute("href", "/docs/grid/grouping");

  // The <Example> island is a client component; the grid inside it only exists
  // once that has hydrated and mounted, so this asserts the whole path.
  const grid = page.getByRole("treegrid", {
    name: "Positions grouped by desk",
  });
  await expect(grid).toBeVisible();
  await expect(
    page.getByRole("listbox", { name: "Grouping levels" }),
  ).toBeVisible();
  await expect(page.locator("[data-pretable-group-row]").first()).toBeVisible();
});

test("Copy as Markdown button is visible", async ({ page }) => {
  await page.goto("/docs/grid/pretable-component", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByRole("button", { name: /copy as markdown/i }),
  ).toBeVisible();
});

test("keyboard shortcut opens search palette and focuses input", async ({
  page,
}) => {
  await page.goto("/docs");
  await openDocsSearch(page);
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
  await openDocsMenu(page);
});
